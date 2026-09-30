import { describe, it, expect, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { ProjectRegistry, SCHEMA_VERSION } from "../src/app/projects.ts";

const dirs: string[] = [];

async function makeDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "claudex-test-"));
  dirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("ProjectRegistry", () => {
  it("creates a project with one conversation", async () => {
    const reg = new ProjectRegistry(await makeDir());
    await reg.load();
    const project = await reg.create("demo", "C:/x");
    expect(project.conversations).toHaveLength(1);
    expect(project.activeConversationId).toBe(project.conversations[0]?.id);
  });

  it("manages conversations and persists atomically", async () => {
    const dir = await makeDir();
    const reg = new ProjectRegistry(dir);
    await reg.load();
    const project = await reg.create("demo", "C:/x");
    const second = await reg.createConversation(project.id, "second");
    expect(second).toBeDefined();
    await reg.addMessage(project.id, second!.id, {
      id: "1",
      at: Date.now(),
      role: "user",
      text: "hi",
    });
    await reg.flush();

    const reloaded = new ProjectRegistry(dir);
    await reloaded.load();
    const reloadedProject = reloaded.get(project.id);
    expect(reloadedProject?.conversations).toHaveLength(2);
    expect(reloadedProject?.activeConversationId).toBe(second!.id);
    expect(reloadedProject?.conversations.find((c) => c.id === second!.id)?.messages).toHaveLength(
      1,
    );
  });

  it("deletes a conversation and picks a new active one", async () => {
    const reg = new ProjectRegistry(await makeDir());
    await reg.load();
    const project = await reg.create("demo", "C:/x");
    const first = project.conversations[0]!.id;
    const second = (await reg.createConversation(project.id, "second"))!.id;
    await reg.deleteConversation(project.id, second);
    expect(reg.get(project.id)?.activeConversationId).toBe(first);
  });

  it("migrates v1 projects into a conversation", async () => {
    const dir = await makeDir();
    await writeFile(
      path.join(dir, "projects.json"),
      JSON.stringify([
        {
          id: "p1",
          name: "old",
          rootPath: "C:/old",
          createdAt: 1,
          messages: [{ id: "m", at: 1, role: "user", text: "hello" }],
          branch: "claudex/old",
          claudeSessionId: "sess-1",
        },
      ]),
      "utf8",
    );
    const reg = new ProjectRegistry(dir);
    await reg.load();
    const project = reg.get("p1");
    expect(project?.conversations).toHaveLength(1);
    expect(project?.conversations[0]?.messages).toHaveLength(1);
    expect(project?.conversations[0]?.branch).toBe("claudex/old");
    expect(project?.conversations[0]?.claudeSessionId).toBe("sess-1");
  });

  it("backs up v2 exactly, defaults autonomy and persists a selected mode", async () => {
    const dir = await makeDir();
    const raw = JSON.stringify({
      schemaVersion: 2,
      projects: [
        {
          id: "p",
          name: "old",
          rootPath: "C:/old",
          conversations: [
            { id: "m", name: "mission", createdAt: 1, messages: [], claudeSessionId: "session" },
          ],
        },
      ],
    });
    await writeFile(path.join(dir, "projects.json"), raw);
    const registry = new ProjectRegistry(dir);
    await registry.load();
    await registry.flush();
    expect(await readFile(path.join(dir, "projects.schema-2.backup.json"), "utf8")).toBe(raw);
    expect(registry.getConversation("p", "m")?.autonomy).toBe("autonomous");
    await registry.updateConversation("p", "m", { autonomy: "manual" });
    await registry.flush();
    const reloaded = new ProjectRegistry(dir);
    await reloaded.load();
    expect(reloaded.summaries(new Set())[0].conversations[0].autonomy).toBe("manual");
    expect(reloaded.getConversation("p", "m")?.claudeSessionId).toBe("session");
  });
  it("preserves corrupted and future-schema files instead of overwriting them", async () => {
    for (const raw of [
      "{broken",
      JSON.stringify({ schemaVersion: 99, projects: [] }),
      JSON.stringify({
        schemaVersion: 3,
        projects: [{ id: "p", conversations: [{ id: "m", autonomy: "invalid" }] }],
      }),
    ]) {
      const dir = await makeDir();
      await writeFile(path.join(dir, "projects.json"), raw);
      const registry = new ProjectRegistry(dir);
      await expect(registry.load()).rejects.toThrow();
      await registry.flush();
      expect(await readFile(path.join(dir, "projects.json"), "utf8")).toBe(raw);
    }
  });
  it("keeps the schema version current", () => {
    expect(SCHEMA_VERSION).toBe(3);
  });
});
