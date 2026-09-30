import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it, vi } from "vitest";
const pending = vi.hoisted(() => ({ release: () => {}, calls: 0 }));
vi.mock("../src/application/missionService.ts", () => ({
  MissionService: class {
    async run() {
      pending.calls++;
      await new Promise<void>((resolve) => {
        pending.release = resolve;
      });
    }
  },
}));
import { ChatService } from "../src/app/chat.ts";
import { ProjectRegistry } from "../src/app/projects.ts";
import type { OrchestratorConfig } from "../src/config.ts";
import type { JevClient } from "../src/jev.ts";

it("claims a conversation before asynchronous work so duplicate sends cannot start two missions", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "claudex-chat-lock-"));
  const registry = new ProjectRegistry(dir);
  await registry.load();
  const project = await registry.create("fixture", dir);
  const id = project.conversations[0]!.id;
  const chat = new ChatService(
    registry,
    {} as JevClient,
    { dataDir: dir } as OrchestratorConfig,
    dir,
  );
  const first = chat.send(project.id, id, "first");
  try {
    expect(chat.isRunning(id)).toBe(true);
    await expect(chat.send(project.id, id, "duplicate")).rejects.toThrow("already running");
  } finally {
    await new Promise((resolve) => setTimeout(resolve, 20));
    pending.release();
    await first;
    await registry.flush();
    await rm(dir, { recursive: true, force: true });
  }
  expect(pending.calls).toBe(1);
});
