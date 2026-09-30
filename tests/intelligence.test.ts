import { mkdtemp, mkdir, writeFile, rm, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { inspectRepository } from "../src/application/repoIntelligence.js";
import { searchRepository } from "../src/application/repoSearch.js";
import { MemoryService, memoryPrompt } from "../src/application/memoryService.js";
const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});
async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "claudex-intelligence-"));
  dirs.push(root);
  await mkdir(path.join(root, "src"));
  await writeFile(
    path.join(root, "package.json"),
    JSON.stringify({ main: "src/main.ts", dependencies: { express: "5" } }),
  );
  await writeFile(
    path.join(root, "src/main.ts"),
    'import { greet } from "./greet.js";\nexport function start() { return greet(); }',
  );
  await writeFile(path.join(root, "src/greet.ts"), 'export function greet() { return "hello"; }');
  await writeFile(path.join(root, ".env"), "SECRET=hidden");
  await mkdir(path.join(root, "node_modules"));
  await writeFile(path.join(root, "node_modules/private.js"), "SECRET=hidden");
  return root;
}
describe("repository intelligence", () => {
  it("resolves local imports, symbols and entry points without indexing secrets or dependencies", async () => {
    const result = await inspectRepository(await fixture());
    expect(result.graph.edges).toContainEqual({ from: "src/main.ts", to: "src/greet.ts" });
    expect(result.entryPoints).toContain("src/main.ts");
    expect(result.files.map((file) => file.file)).not.toContain(".env");
    expect(result.dependencies).toEqual({ express: "5" });
  });
  it("does not follow linked directories outside the project and bounds large files", async () => {
    const root = await fixture();
    const outside = await fixture();
    await writeFile(path.join(outside, "secret.txt"), "outside-only-marker");
    await symlink(outside, path.join(root, "linked"), "junction");
    await writeFile(path.join(root, "huge.txt"), "x".repeat(300000));
    const result = await inspectRepository(root);
    expect(result.truncated).toBe(true);
    expect(
      result.files.some((file) => file.file.startsWith("linked/") || file.file === "huge.txt"),
    ).toBe(false);
    expect((await searchRepository(root, "outside-only-marker")).matches).toEqual([]);
  });
  it("returns ranked real lines and zero confidence for absent text", async () => {
    const root = await fixture();
    const result = await searchRepository(root, "greet");
    expect(result.matches[0]).toMatchObject({ file: "src/greet.ts", line: 1 });
    expect(result.confidence).toBeGreaterThan(0);
    expect(await searchRepository(root, "SECRET")).toMatchObject({ matches: [], confidence: 0 });
    await expect(searchRepository(root, " ")).rejects.toThrow();
  });
});
describe("project memory", () => {
  it("bounds prompt context without cutting serialized entries", () => {
    const entries = Array.from({ length: 20 }, (_, index) => ({
      id: `id-${index}`,
      projectId: "p",
      kind: "decision" as const,
      text: "x".repeat(4000),
      createdAt: 0,
    }));
    const prompt = memoryPrompt(entries);
    expect(prompt.length).toBeLessThan(16200);
    expect(JSON.parse(prompt.slice(prompt.indexOf("[")))).toHaveLength(3);
  });
  it("serializes concurrent writes, persists edits and injects bounded context", async () => {
    const root = await fixture();
    const service = new MemoryService(root);
    const entries = await Promise.all([
      service.add("project", "decision", "Use JSON"),
      service.add("project", "convention", "ESM only"),
    ]);
    expect(await service.list("project")).toHaveLength(2);
    expect(memoryPrompt(await service.list("project"))).toContain("ESM only");
    await service.update("project", entries[0].id, "architecture", "Local service");
    expect((await new MemoryService(root).list("project"))[0].text).toBe("Local service");
    await service.remove("project", entries[1].id);
    expect(await service.list("project")).toHaveLength(1);
    await expect(service.list("../outside")).rejects.toThrow();
    await expect(service.add("project", "decision", " ")).rejects.toThrow();
  });
});
