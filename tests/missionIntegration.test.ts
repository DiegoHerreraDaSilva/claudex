import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/agents/claude.js", () => ({
  CLAUDE_TOOLS: { planner: ["Read"], implementer: ["Read", "Write"], reviewer: ["Read"] },
  runClaudeAgent: async (options: {
    worktreePath: string;
    model: string;
    prompt: string;
    outputSchema?: object;
  }) => {
    if (!options.outputSchema) await writeFile(path.join(options.worktreePath, "result.txt"), "ok");
    return {
      sessionId: "session",
      durationMs: 1,
      usage: { inputTokens: 2, outputTokens: 1 },
      result: options.outputSchema
        ? JSON.stringify({
            approved: !options.prompt.includes("reject-review"),
            summary: "review verdict",
            findings: [],
          })
        : "done",
    };
  },
}));

import { ChatService } from "../src/app/chat.ts";
import { GIT_IDENTITY, runGit } from "../src/app/git.ts";
import { ProjectRegistry } from "../src/app/projects.ts";
import { EventStore } from "../src/infrastructure/persistence/eventStore.ts";
import type { OrchestratorConfig } from "../src/config.ts";
import type { JevClient } from "../src/jev.ts";
import { createAppServer } from "../src/server/appServer.ts";

const dirs: string[] = [];
async function fixture() {
  const dir = await mkdtemp(path.join(tmpdir(), "claudex-phase3-"));
  dirs.push(dir);
  await runGit(dir, ["init"]);
  await writeFile(path.join(dir, "README.md"), "fixture");
  await runGit(dir, ["add", "."]);
  await runGit(dir, [...GIT_IDENTITY, "commit", "-m", "initial"]);
  const dataDir = path.join(dir, ".data");
  await writeFile(path.join(dir, ".gitignore"), ".data/\n");
  const registry = new ProjectRegistry(dataDir);
  await registry.load();
  const project = await registry.create("fixture", dir);
  const conversationId = project.conversations[0]!.id;
  const config: OrchestratorConfig = {
    projectRoot: dir,
    dataDir,
    worktreesDir: path.join(dataDir, "worktrees"),
    logsDir: path.join(dataDir, "logs"),
    agentTimeoutMs: 1000,
    typesafeApiKey: "",
    typesafeBaseUrl: "",
    jevModel: "",
    jevCacheTtlMs: 0,
    wsPort: 0,
    maxParallelTasks: 1,
    defaultPlannerModel: "opus",
    defaultSimpleModel: "sonnet",
    defaultComplexModel: "gpt-6-sol",
  };
  const jev = {
    routeTask: async () => ({ route: "implement", confidence: 1, source: "heuristic" }),
    reviewDiff: async () => ({ approved: true, noul: 0, source: "heuristic" }),
  } as unknown as JevClient;
  const events = new EventStore(path.join(dataDir, "missions"));
  const chat = new ChatService(registry, jev, config, config.worktreesDir, events);
  return { dir, dataDir, registry, project, conversationId, config, events, chat };
}
afterEach(async () => {
  await Promise.all(
    dirs
      .splice(0)
      .map((dir) => rm(dir, { recursive: true, force: true, maxRetries: 4, retryDelay: 100 })),
  );
});

describe("phase 3 mission integration", () => {
  it("persists a reviewed mission, serves its summary and applies the reviewed commit", async () => {
    const f = await fixture();
    await f.chat.send(f.project.id, f.conversationId, "create result");
    const summary = await new EventStore(path.join(f.dataDir, "missions")).readSummary(
      f.conversationId,
    );
    expect(summary).toMatchObject({
      status: "ready",
      files: ["result.txt"],
      review: { approved: true },
      costUsd: expect.any(Number),
    });
    expect(summary?.verification.every((run) => run.status === "skipped")).toBe(true);
    expect(summary?.agentRuns).toHaveLength(2);
    const server = createAppServer({ chat: f.chat, registry: f.registry, config: f.config });
    const port = await server.listen(0);
    try {
      const response = await fetch(
        `http://127.0.0.1:${port}/api/missions/${f.conversationId}/summary`,
      );
      expect(response.status).toBe(200);
      expect((await response.json()).status).toBe("ready");
      const missing = await fetch(`http://127.0.0.1:${port}/api/missions/unknown/summary`);
      expect(missing.status).toBe(404);
    } finally {
      server.wss.close();
      await new Promise<void>((resolve, reject) =>
        server.server.close((err) => (err ? reject(err) : resolve())),
      );
    }
    const worktree = f.project.conversations[0]!.worktreePath!;
    await runGit(worktree, [
      ...GIT_IDENTITY,
      "commit",
      "--allow-empty",
      "-m",
      "external change after review",
    ]);
    expect((await f.chat.apply(f.project.id, f.conversationId)).ok).toBe(false);
    await runGit(worktree, ["reset", "--hard", summary!.head!]);
    expect(await f.chat.apply(f.project.id, f.conversationId)).toEqual({ ok: true });
    expect(await readFile(path.join(f.dir, "result.txt"), "utf8")).toBe("ok");
    expect((await f.chat.missionSummary(f.conversationId))?.status).toBe("applied");
    await f.registry.flush();
  }, 60_000);

  it("keeps rejected changes in the worktree and refuses apply", async () => {
    const f = await fixture();
    await f.chat.send(f.project.id, f.conversationId, "reject-review");
    expect((await f.chat.missionSummary(f.conversationId))?.status).toBe("failed");
    expect((await f.chat.apply(f.project.id, f.conversationId)).ok).toBe(false);
    expect(
      await readFile(path.join(f.project.conversations[0]!.worktreePath!, "result.txt"), "utf8"),
    ).toBe("ok");
    await f.registry.flush();
  }, 60_000);
});
