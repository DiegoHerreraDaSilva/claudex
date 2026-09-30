import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const prompts = vi.hoisted(() => [] as string[]);

vi.mock("../src/agents/claude.js", () => ({
  CLAUDE_TOOLS: { planner: ["Read"], implementer: ["Read", "Write"], reviewer: ["Read"] },
  runClaudeAgent: async (options: {
    worktreePath: string;
    model: string;
    prompt: string;
    outputSchema?: object;
    permissionPolicy?: { tools?: string[] };
  }) => {
    prompts.push(options.prompt);
    if (!options.outputSchema && options.permissionPolicy?.tools?.includes("Write"))
      await writeFile(path.join(options.worktreePath, "result.txt"), "ok");
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
import { MemoryService } from "../src/application/memoryService.js";
import { CheckpointService } from "../src/application/checkpointService.js";
import { EventStore } from "../src/infrastructure/persistence/eventStore.ts";
import type { OrchestratorConfig } from "../src/config.ts";
import type { JevClient } from "../src/jev.ts";
import { WebSocket } from "ws";
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
  it("keeps manual missions read-only and requires single-use assisted terminal approvals", async () => {
    const f = await fixture();
    await f.registry.updateConversation(f.project.id, f.conversationId, {
      claudeSessionId: "old",
      codexThreadId: "old",
    });
    await f.chat.setAutonomy(f.project.id, f.conversationId, "manual");
    expect(f.project.conversations[0]?.claudeSessionId).toBeUndefined();
    expect(f.project.conversations[0]?.codexThreadId).toBeUndefined();
    const head = (await runGit(f.dir, ["rev-parse", "HEAD"])).stdout;
    const status = (await runGit(f.dir, ["status", "--short"])).stdout;
    await f.chat.send(f.project.id, f.conversationId, "analyze project");
    expect((await f.chat.missionSummary(f.conversationId))?.status).toBe("analysed");
    expect((await runGit(f.dir, ["rev-parse", "HEAD"])).stdout).toBe(head);
    expect((await runGit(f.dir, ["status", "--short"])).stdout).toBe(status);
    expect(f.project.conversations[0]?.worktreePath).toBeUndefined();
    expect(
      await new CheckpointService(path.join(f.dataDir, "checkpoints")).list(f.conversationId),
    ).toEqual([]);
    expect((await f.chat.apply(f.project.id, f.conversationId)).ok).toBe(false);
    const server = createAppServer({ chat: f.chat, registry: f.registry, config: f.config });
    const port = await server.listen(0);
    const base = `http://127.0.0.1:${port}`;
    const post = (route: string, body: unknown, method = "POST") =>
      fetch(base + route, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    try {
      const route = `/api/projects/${f.project.id}/terminal`;
      expect((await post(route, { command: "echo blocked" })).status).toBe(400);
      const modeRoute = `/api/projects/${f.project.id}/conversations/${f.conversationId}/autonomy`;
      expect((await post(modeRoute, { mode: "invalid" }, "PUT")).status).toBe(400);
      expect((await post(modeRoute, { mode: "assisted" }, "PUT")).status).toBe(200);
      const waitRequest = async () => {
        for (let attempt = 0; attempt < 100 && !f.chat.permissions.list().length; attempt++)
          await new Promise((resolve) => setTimeout(resolve, 10));
        expect(f.chat.permissions.list()).toHaveLength(1);
        return f.chat.permissions.list()[0]!;
      };
      const pending = post(route, { command: "echo approved-once" });
      const request = await waitRequest();
      expect((await post(modeRoute, { mode: "autonomous" }, "PUT")).status).toBe(409);
      expect(
        (await fetch(base + "/api/permissions").then((response) => response.json()))[0].id,
      ).toBe(request.id);
      expect((await post(`/api/permissions/${request.id}`, { approved: true })).status).toBe(200);
      expect((await (await pending).json()).code).toBe(0);
      expect((await post(`/api/permissions/${request.id}`, { approved: true })).status).toBe(404);
      const denied = post(route, { command: "echo approved-once" });
      const repeat = await waitRequest();
      expect(repeat.id).not.toBe(request.id);
      await post(`/api/permissions/${repeat.id}`, { approved: false });
      expect((await denied).status).toBe(400);
      const stopped = post(route, { command: "echo stopped" });
      await waitRequest();
      await post(route + "/stop", {});
      expect((await stopped).status).toBe(400);
      expect(f.chat.permissions.list()).toEqual([]);
    } finally {
      server.wss.close();
      await new Promise<void>((resolve) => server.server.close(() => resolve()));
      await f.registry.flush();
    }
  }, 90_000);

  it("persists a reviewed mission, serves its summary and applies the reviewed commit", async () => {
    const f = await fixture();
    await new MemoryService(path.join(f.dataDir, "memory")).add(
      f.project.id,
      "convention",
      "ESM only",
    );
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
    expect(
      prompts.some((prompt) => prompt.includes("Project memory") && prompt.includes("ESM only")),
    ).toBe(true);
    const checkpoints = await new CheckpointService(path.join(f.dataDir, "checkpoints")).list(
      f.conversationId,
    );
    expect(checkpoints).toHaveLength(2);
    expect(
      (await f.chat.missionEvents(f.conversationId)).find(
        (event) => event.type === "context:loaded",
      )?.payload?.memory,
    ).toMatchObject([{ text: "ESM only" }]);
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
      const base = `http://127.0.0.1:${port}`;
      const intelligence = await fetch(`${base}/api/projects/${f.project.id}/intelligence`);
      expect((await intelligence.json()).files).toContainEqual({ file: "README.md", symbols: [] });
      expect(
        (
          await fetch(`${base}/api/projects/${f.project.id}/memory`).then((response) =>
            response.json(),
          )
        )[0].text,
      ).toBe("ESM only");
      expect(
        (
          await fetch(`${base}/api/projects/${f.project.id}/git`).then((response) =>
            response.json(),
          )
        ).worktrees,
      ).toHaveLength(2);
      expect(
        (
          await fetch(`${base}/api/projects/${f.project.id}/missions`).then((response) =>
            response.json(),
          )
        )[0].status,
      ).toBe("ready");
      const blocked = await fetch(`${base}/api/projects/${f.project.id}/terminal`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: "https://external.example" },
        body: JSON.stringify({ command: "echo blocked" }),
      });
      expect(blocked.status).toBe(403);
      const invalidHost = await fetch(`${base}/api/projects/${f.project.id}/terminal`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Host: "attacker.example",
          Origin: "http://attacker.example",
        },
        body: JSON.stringify({ command: "echo blocked" }),
      });
      expect(invalidHost.status).toBe(403);
      const ask = await fetch(`${base}/api/repo/ask`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: f.project.id, query: "fixture" }),
      });
      expect((await ask.json()).matches[0]).toMatchObject({ file: "README.md", line: 1 });
      const socket = new WebSocket(`ws://127.0.0.1:${port}`);
      const output: string[] = [];
      socket.on("message", (raw) => {
        const event = JSON.parse(raw.toString());
        if (event.type === "terminal:out" && event.stream === "stdout") output.push(event.text);
      });
      await new Promise<void>((resolve, reject) => {
        socket.once("open", resolve);
        socket.once("error", reject);
      });
      try {
        const response = await fetch(`${base}/api/projects/${f.project.id}/terminal`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ command: "echo api-terminal" }),
        });
        expect(response.status).toBe(200);
        expect((await response.json()).code).toBe(0);
        await new Promise((resolve) => setTimeout(resolve, 30));
        expect(output.join("")).toContain("api-terminal");
      } finally {
        socket.close();
        await new Promise((resolve) => socket.once("close", resolve));
      }
    } finally {
      server.wss.close();
      await new Promise<void>((resolve, reject) =>
        server.server.close((err) => (err ? reject(err) : resolve())),
      );
    }
    const worktree = f.project.conversations[0]!.worktreePath!;
    await writeFile(path.join(worktree, "unreviewed.txt"), "pending");
    expect((await f.chat.apply(f.project.id, f.conversationId)).ok).toBe(false);
    await rm(path.join(worktree, "unreviewed.txt"));
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
    await writeFile(path.join(worktree, "result.txt"), "changed after checkpoint");
    await writeFile(path.join(worktree, "untracked.txt"), "temporary");
    await f.registry.updateConversation(f.project.id, f.conversationId, { worktreePath: f.dir });
    await expect(f.chat.restore(f.conversationId, checkpoints[0].id)).rejects.toThrow(
      "outside the managed workspace",
    );
    await f.registry.updateConversation(f.project.id, f.conversationId, { worktreePath: worktree });
    await f.chat.restore(f.conversationId, checkpoints[0].id);
    expect(await readFile(path.join(worktree, "result.txt"), "utf8")).toBe("ok");
    await expect(readFile(path.join(worktree, "untracked.txt"))).rejects.toThrow();
    expect(await readFile(path.join(f.dir, "result.txt"), "utf8")).toBe("ok");
    expect((await f.chat.missionSummary(f.conversationId))?.status).toBe("cancelled");
    expect((await f.chat.apply(f.project.id, f.conversationId)).ok).toBe(false);
    await expect(
      f.chat.restore(f.conversationId, "00000000-0000-4000-8000-000000000000"),
    ).rejects.toThrow("checkpoint not found");
    await f.registry.flush();
  }, 120_000);

  it("keeps rejected changes in the worktree and refuses apply", async () => {
    const f = await fixture();
    await f.chat.send(f.project.id, f.conversationId, "reject-review");
    expect((await f.chat.missionSummary(f.conversationId))?.status).toBe("failed");
    expect((await f.chat.apply(f.project.id, f.conversationId)).ok).toBe(false);
    expect(
      await readFile(path.join(f.project.conversations[0]!.worktreePath!, "result.txt"), "utf8"),
    ).toBe("ok");
    await f.registry.flush();
  }, 90_000);
});
