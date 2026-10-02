import { expect, it } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { scanFolder, changedFiles, memoryContext } from "../src/application/projectMemory.js";
it("allows older shared history to be retrieved even when it does not fit the initial context", () => {
  const memory = Array.from({ length: 150 }, (_, index) => ({
    at: index,
    agent: "agent",
    request: `request-${index}`,
    result: "details ".repeat(400),
    status: "completed",
    changes: [`file-${index}`],
  }));
  expect(memoryContext(memory)).not.toContain('"request":"request-0"');
  expect(memoryContext(memory, { before: 2 })).toContain('"request":"request-0"');
  expect(memoryContext(memory, { search: "file-0" })).toContain('"request":"request-0"');
});
it("detects edits, additions and deletions without Git while ignoring dependencies", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "claudex-memory-"));
  try {
    await writeFile(path.join(dir, "old.txt"), "before");
    const before = await scanFolder(dir);
    await rm(path.join(dir, "old.txt"));
    await writeFile(path.join(dir, "new.txt"), "after");
    await mkdir(path.join(dir, "node_modules"));
    await writeFile(path.join(dir, "node_modules", "ignored.txt"), "ignored");
    expect(changedFiles(before, await scanFolder(dir)).sort()).toEqual(["new.txt", "old.txt"]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
