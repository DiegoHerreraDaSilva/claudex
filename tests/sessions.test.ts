import { afterEach, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { SessionService, type SessionRunner } from "../src/application/sessionService.js";
import type { OrchestratorConfig } from "../src/config.js";

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});
async function fixture(runner?: SessionRunner, complexity = "strong") {
  const dir = await mkdtemp(path.join(tmpdir(), "claudex-direct-"));
  dirs.push(dir);
  const folder = path.join(dir, "plain-folder");
  await mkdir(folder);
  const route = vi.fn(async () => ({ complexity, source: "jev", confidence: 0.9 }));
  const config = {
    defaultSimpleModel: "sonnet",
    defaultPlannerModel: "opus",
    defaultComplexModel: "gpt-6-sol",
    agentTimeoutMs: 5000,
  } as OrchestratorConfig;
  const service = new SessionService(
    path.join(dir, "data"),
    config,
    { classifyComplexity: route } as never,
    runner,
  );
  await service.load();
  const project = await service.addProject(folder);
  return { service, project, folder, dir, route, config };
}
it("keeps attachment references across sessions and shares them with collaborators", async () => {
  const calls: Parameters<SessionRunner>[0][] = [];
  const runner: SessionRunner = async (input) => {
    calls.push(input);
    if (input.text.startsWith("Analyze")) {
      const child = (await input.team!.call("delegate", {
        text: "Read reference",
        readOnly: true,
      })) as { id: string };
      await input.team!.call("wait_agents", { ids: [child.id] });
    }
    return { result: "done", durationMs: 1, usage: { inputTokens: 0, outputTokens: 0 } };
  };
  const f = await fixture(runner);
  const first = await f.service.start(f.project.id, "Analyze reference", [
    { name: "notes.txt", data: Buffer.from("reference content").toString("base64") },
  ]);
  await f.service.wait(first.id);
  const file = first.events.find((e) => e.kind === "user")!.attachments![0];
  expect(await readFile(file.path, "utf8")).toBe("reference content");
  expect(file.path.startsWith(f.folder)).toBe(false);
  expect(calls[0].attachments![0].id).toBe(file.id);
  expect(calls[1].text).toContain(JSON.stringify(file.path));
  expect(f.service.attachment(f.project.id, file.id)).toEqual(file);
  const next = await f.service.start(f.project.id, "Continue");
  await f.service.wait(next.id);
  expect(next.id).toBe(first.id);
  expect(JSON.parse(calls[2].team!.context).memory).toContain(file.path.replace(/\\/g, "\\\\"));
  const reloaded = new SessionService(
    path.join(f.dir, "data"),
    f.config,
    { classifyComplexity: f.route } as never,
    runner,
  );
  await reloaded.load();
  expect(reloaded.attachment(f.project.id, file.id)).toEqual(file);
});

it("changes effort without replacing the session and retains it for compaction", async () => {
  const runner = vi.fn<SessionRunner>(async () => ({
    result: "summary",
    threadId: "same-context",
    durationMs: 1,
    usage: { inputTokens: 0, outputTokens: 0 },
  }));
  const f = await fixture(runner);
  f.config.defaultComplexEffort = "low";
  const first = await f.service.start(f.project.id, "first");
  await f.service.wait(first.id);
  f.config.defaultComplexEffort = "high";
  const next = await f.service.start(f.project.id, "next");
  await f.service.wait(next.id);
  expect(next.id).toBe(first.id);
  expect(runner.mock.calls[0][0].agent.effort).toBe("low");
  expect(runner.mock.calls[1][0]).toMatchObject({
    resumeId: "same-context",
    agent: { effort: "high" },
  });
  await f.service.compact(next.id);
  expect(runner.mock.calls[2][0].agent.effort).toBe("high");
  const stored = JSON.parse(await readFile(path.join(f.dir, "data", "sessions.json"), "utf8"));
  expect(stored[0].sessions[0].effort).toBe("high");
});

it("closes a session without erasing shared memory and starts a fresh model session afterwards", async () => {
  const runner = vi.fn<SessionRunner>(async () => ({
    result: "remember this",
    threadId: "old",
    durationMs: 1,
    usage: { inputTokens: 1, outputTokens: 1 },
  }));
  const f = await fixture(runner);
  const first = await f.service.start(f.project.id, "first");
  await f.service.wait(first.id);
  await f.service.closeSession(first.id);
  expect(f.service.projects()[0].sessions).toHaveLength(0);
  expect(f.service.projects()[0].memoryCount).toBe(1);
  const next = await f.service.start(f.project.id, "next");
  await f.service.wait(next.id);
  expect(next.id).not.toBe(first.id);
  expect(runner.mock.calls[1][0].resumeId).toBeUndefined();
});

it("compacts using the selected model and only replaces provider context after success", async () => {
  const runner = vi.fn<SessionRunner>(async (o) => ({
    result: o.mode === "compact" ? "Keep the selected contract and pending checks." : "done",
    threadId: "old",
    durationMs: 1,
    usage: { inputTokens: 20, outputTokens: 5 },
  }));
  const f = await fixture(runner);
  const first = await f.service.start(f.project.id, "first");
  await f.service.wait(first.id);
  await f.service.compact(first.id);
  expect(f.service.session(first.id).sdkSessionId).toBeUndefined();
  expect(f.service.session(first.id).summary).toContain("selected contract");
  await f.service.flush();
  const reloaded = new SessionService(
    path.join(f.dir, "data"),
    f.config,
    { classifyComplexity: f.route } as never,
    runner,
  );
  await reloaded.load();
  expect(reloaded.session(first.id).summary).toContain("selected contract");
  expect(reloaded.session(first.id).sdkSessionId).toBeUndefined();
  const next = await f.service.start(f.project.id, "continue");
  await f.service.wait(next.id);
  expect(next.id).toBe(first.id);
  expect(runner.mock.calls[2][0].resumeId).toBeUndefined();
  expect(runner.mock.calls[2][0].summary).toContain("selected contract");
  runner.mockImplementationOnce(async () => {
    throw new Error("summary unavailable");
  });
  await expect(f.service.compact(first.id)).rejects.toThrow("summary unavailable");
  expect(f.service.session(first.id).sdkSessionId).toBe("old");
});

it("reuses the model session and SDK context in a folder without Git, including after restart", async () => {
  const runner = vi.fn<SessionRunner>(async (options) => {
    expect(options.agent.kind).toBe("codex");
    await writeFile(path.join(options.cwd, "edited.txt"), options.text);
    options.activity("tool", "Write edited.txt");
    return {
      result: "Pronto",
      threadId: "codex-context",
      usage: { inputTokens: 1, outputTokens: 2 },
      durationMs: 1,
    };
  });
  const f = await fixture(runner);
  const first = await f.service.start(f.project.id, "criar arquivo");
  await f.service.wait(first.id);
  const second = await f.service.start(f.project.id, "outro pedido");
  await f.service.wait(second.id);
  expect(first.id).toBe(second.id);
  expect(runner.mock.calls[1][0].resumeId).toBe("codex-context");
  expect(f.service.projects()[0].sessions).toHaveLength(1);
  expect(runner).toHaveBeenCalledTimes(2);
  expect(await readFile(path.join(f.folder, "edited.txt"), "utf8")).toBe("outro pedido");
  expect(f.service.session(first.id).status).toBe("completed");
  await f.service.flush();
  const restored = new SessionService(
    path.join(f.dir, "data"),
    f.config,
    { classifyComplexity: f.route } as never,
    runner,
  );
  await restored.load();
  expect(restored.session(first.id).events.some((e) => e.text === "Pronto")).toBe(true);
  const third = await restored.start(f.project.id, "continuar");
  await restored.wait(third.id);
  expect(third.id).toBe(first.id);
  expect(runner.mock.calls[2][0].resumeId).toBe("codex-context");
});
it("keeps separate Sonnet, Opus and Codex contexts and never shares them between projects", async () => {
  const runner = vi.fn<SessionRunner>(async (o) => ({
    result: o.text,
    sessionId: `context-${o.agent.label}-${o.cwd}`,
    durationMs: 0,
    usage: { inputTokens: 0, outputTokens: 0 },
  }));
  const f = await fixture(runner, "balanced");
  const sonnet = await f.service.start(f.project.id, "primeiro");
  await f.service.wait(sonnet.id);
  f.route.mockResolvedValue({ complexity: "judgment", source: "jev", confidence: 1 });
  const opus = await f.service.start(f.project.id, "segundo");
  await f.service.wait(opus.id);
  f.route.mockResolvedValue({ complexity: "strong", source: "jev", confidence: 1 });
  const codex = await f.service.start(f.project.id, "terceiro");
  await f.service.wait(codex.id);
  f.route.mockResolvedValue({ complexity: "balanced", source: "jev", confidence: 1 });
  const again = await f.service.start(f.project.id, "quarto");
  await f.service.wait(again.id);
  expect(again.id).toBe(sonnet.id);
  expect(new Set([sonnet.id, opus.id, codex.id]).size).toBe(3);
  expect(runner.mock.calls[3][0].resumeId).toContain("claude:sonnet");
  const folder = path.join(f.dir, "other-project");
  await mkdir(folder);
  const other = await f.service.addProject(folder);
  const separate = await f.service.start(other.id, "novo projeto");
  await f.service.wait(separate.id);
  expect(runner.mock.calls[4][0].resumeId).toBeUndefined();
});
it("shares previous model changes and external edits with the next model, including after restart", async () => {
  const runner = vi.fn<SessionRunner>(async (o) => {
    await writeFile(path.join(o.cwd, o.text + ".txt"), "updated");
    return {
      result: "Contrato da API definido pelo agente anterior",
      sessionId: o.agent.label,
      durationMs: 0,
      usage: { inputTokens: 0, outputTokens: 0 },
    };
  });
  const f = await fixture(runner, "balanced");
  const first = await f.service.start(f.project.id, "primeiro");
  await f.service.wait(first.id);
  await writeFile(path.join(f.folder, "external.txt"), "manual change");
  f.route.mockResolvedValue({ complexity: "strong", source: "jev", confidence: 1 });
  const restored = new SessionService(
    path.join(f.dir, "data"),
    f.config,
    { classifyComplexity: f.route } as never,
    runner,
  );
  await restored.load();
  const second = await restored.start(f.project.id, "segundo");
  await restored.wait(second.id);
  expect(runner.mock.calls[1][0].team?.context).toContain("Contrato da API definido");
  expect(runner.mock.calls[1][0].team?.context).toContain("primeiro.txt");
  expect(runner.mock.calls[1][0].team?.context).toContain("external.txt");
  expect(runner.mock.calls[1][0].agent.kind).toBe("codex");
  await restored.close();
  await f.service.close();
});
it("runs a team against the same plain folder and exposes shared results to its coordinator", async () => {
  const started: string[] = [];
  let release!: () => void;
  const ready = new Promise<void>((resolve) => (release = resolve));
  const f = await fixture(async (o) => {
    if (o.text === "equipe") {
      const a = (await o.team!.call("delegate", { text: "primeiro", paths: ["a.txt"] })) as {
        id: string;
      };
      const b = (await o.team!.call("delegate", { text: "segundo", paths: ["b.txt"] })) as {
        id: string;
      };
      // Runners inspect their folders before starting. Wait until both have entered.
      while (started.length < 2) await new Promise((resolve) => setTimeout(resolve, 5));
      await o.team!.call("message_team", { text: "Contrato: use a API existente" });
      release();
      const results = await o.team!.call("wait_agents", { ids: [a.id, b.id] });
      expect(JSON.stringify(results)).toContain("concluído");
      expect(JSON.stringify(await o.team!.call("read_team", {}))).toContain("a.txt");
    } else {
      started.push(o.text);
      await ready;
      expect(JSON.stringify(await o.team!.call("read_team", {}))).toContain("API existente");
      await writeFile(path.join(o.cwd, o.text === "primeiro" ? "a.txt" : "b.txt"), "feito");
    }
    return { result: "concluído", durationMs: 0, usage: { inputTokens: 0, outputTokens: 0 } };
  }, "balanced");
  const root = await f.service.start(f.project.id, "equipe");
  await f.service.wait(root.id);
  expect(root.status).toBe("completed");
  expect(f.service.projects()[0].sessions).toHaveLength(3);
  expect(await readFile(path.join(f.folder, "a.txt"), "utf8")).toBe("feito");
  await f.service.close();
});
it("persists an initialized provider context even when its first request fails", async () => {
  const runner = vi.fn<SessionRunner>(async (o) => {
    o.rememberSession("initialized-context");
    throw new Error("connection lost after initialization");
  });
  const f = await fixture(runner, "balanced");
  const first = await f.service.start(f.project.id, "primeiro pedido");
  await f.service.wait(first.id);
  expect(first.status).toBe("failed");
  const restored = new SessionService(
    path.join(f.dir, "data"),
    f.config,
    { classifyComplexity: f.route } as never,
    runner,
  );
  await restored.load();
  const again = await restored.start(f.project.id, "continuar após falha");
  await restored.wait(again.id);
  expect(again.id).toBe(first.id);
  expect(runner.mock.calls[1][0].resumeId).toBe("initialized-context");
});
it("locks overlapping folders and releases only after cancellation finishes", async () => {
  const runner: SessionRunner = ({ signal }) =>
    new Promise((_, reject) =>
      signal.addEventListener("abort", () => reject(new Error("cancelled")), { once: true }),
    );
  const f = await fixture(runner, "balanced");
  const child = path.join(f.folder, "child");
  await mkdir(child);
  const nested = await f.service.addProject(child);
  const session = await f.service.start(f.project.id, "alterar");
  await new Promise((resolve) => setTimeout(resolve, 10));
  await expect(f.service.start(nested.id, "conflito")).rejects.toMatchObject({ status: 409 });
  await expect(f.service.removeProject(f.project.id)).rejects.toMatchObject({ status: 409 });
  f.service.stop(session.id);
  await f.service.wait(session.id);
  expect(session.status).toBe("stopped");
});
it("imports folder registrations without resuming legacy sessions and rejects files", async () => {
  const f = await fixture();
  await writeFile(path.join(f.dir, "not-folder"), "text");
  await expect(f.service.addProject(path.join(f.dir, "not-folder"))).rejects.toMatchObject({
    status: 400,
  });
  expect((await f.service.addProject(f.folder)).id).toBe(f.project.id);
  const legacy = path.join(f.dir, "legacy");
  await mkdir(legacy);
  await writeFile(
    path.join(legacy, "projects.json"),
    JSON.stringify({
      projects: [{ name: "Antigo", rootPath: f.folder, conversations: [{ worktreePath: "old" }] }],
    }),
  );
  const service = new SessionService(legacy, f.config, {} as never);
  await service.load();
  expect(service.projects()[0].name).toBe("Antigo");
  expect(service.projects()[0].sessions).toEqual([]);
});
it("marks unfinished sessions as interrupted after restart without executing again", async () => {
  const f = await fixture(async () => ({
    result: "ok",
    usage: { inputTokens: 0, outputTokens: 0 },
    durationMs: 0,
  }));
  const session = await f.service.start(f.project.id, "pedido");
  await f.service.wait(session.id);
  session.status = "running";
  session.compacting = true;
  await f.service.flush();
  const runner = vi.fn<SessionRunner>();
  const restored = new SessionService(path.join(f.dir, "data"), f.config, {} as never, runner);
  await restored.load();
  expect(restored.session(session.id).status).toBe("stopped");
  expect(restored.session(session.id).compacting).toBe(false);
  expect(runner).not.toHaveBeenCalled();
});
it("allows independent folders to run concurrently and cancels while Jev is routing", async () => {
  const f = await fixture();
  const other = path.join(f.dir, "other");
  await mkdir(other);
  const second = await f.service.addProject(other);
  f.route.mockImplementation(async (_text?: string, signal?: AbortSignal) => {
    await new Promise((_, reject) =>
      signal?.addEventListener("abort", () => reject(new Error("cancelled")), { once: true }),
    );
    return { complexity: "balanced", source: "heuristic", confidence: 1 };
  });
  const a = f.service.start(f.project.id, "first");
  const aRejected = expect(a).rejects.toThrow("Roteamento interrompido");
  const b = f.service.start(second.id, "second");
  const bRejected = expect(b).rejects.toThrow("Roteamento interrompido");
  await new Promise((resolve) => setTimeout(resolve, 30));
  for (const project of f.service.projects()) f.service.stop(project.routing!.id);
  await Promise.all([aRejected, bRejected]);
  expect(f.service.projects().every((p) => !p.routing && p.sessions.length === 0)).toBe(true);
});
