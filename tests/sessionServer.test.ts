import { afterEach, expect, it } from "vitest";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import WebSocket from "ws";
import { SessionService } from "../src/application/sessionService.js";
import { createSessionServer } from "../src/server/sessionServer.js";
import type { OrchestratorConfig } from "../src/config.js";
const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0)) await close();
});
it("serves plain-folder sessions, rejects foreign origins and does not expose retired routes", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "claudex-http-"));
  const folder = path.join(dir, "folder");
  await mkdir(folder);
  const config = {
    defaultSimpleModel: "sonnet",
    defaultPlannerModel: "opus",
    defaultComplexModel: "test",
    agentTimeoutMs: 5000,
    projectRoot: dir,
    dataDir: path.join(dir, "data"),
    typesafeApiKey: "",
    typesafeBaseUrl: "https://api.typesafe.ai",
  } as OrchestratorConfig;
  const service = new SessionService(
    path.join(dir, "data"),
    config,
    {
      classifyComplexity: async () => ({
        complexity: "balanced",
        source: "heuristic",
        confidence: 1,
        probabilities: {},
      }),
    },
    async (o) => {
      await writeFile(path.join(o.cwd, "direct.txt"), "written");
      return { result: "Feito", durationMs: 1, usage: { inputTokens: 0, outputTokens: 0 } };
    },
  );
  await service.load();
  const app = createSessionServer({ sessions: service, config });
  const port = await app.listen(0);
  cleanup.push(async () => {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${port}`;
  const post = (route: string, body: unknown, origin = base) =>
    fetch(base + route, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: origin },
      body: JSON.stringify(body),
    });
  expect((await post("/api/projects", { rootPath: folder }, "https://evil.example")).status).toBe(
    403,
  );
  expect((await post("/api/projects", { rootPath: 42 })).status).toBe(400);
  const project = await post("/api/projects", { rootPath: folder }).then((r) => r.json());
  expect(
    (await post(`/api/projects/${project.id}/terminal`, { action: "open" }, "https://evil.example"))
      .status,
  ).toBe(403);
  expect((await post("/api/projects/missing/terminal", { action: "open" })).status).toBe(404);
  expect(
    (
      await post(`/api/projects/${project.id}/terminal`, {
        action: "write",
        input: "echo unopened\n",
      })
    ).status,
  ).toBe(400);
  expect(
    (await fetch(base + `/api/projects/${project.id}/terminal`).then((r) => r.json())).running,
  ).toBe(false);
  const response = await post(`/api/projects/${project.id}/sessions`, { text: "editar" });
  expect(response.status).toBe(202);
  const session = await response.json();
  await service.wait(session.id);
  expect((await fetch(base + `/api/sessions/${session.id}`).then((r) => r.json())).status).toBe(
    "completed",
  );
  expect((await fetch(base + "/api/missions")).status).toBe(404);
  expect((await fetch(base + "/api/work")).status).toBe(404);
  const attachedResponse = await post(`/api/projects/${project.id}/sessions`, {
    text: "",
    attachments: [{ name: "notes.txt", data: Buffer.from("reference").toString("base64") }],
  });
  expect(attachedResponse.status).toBe(202);
  const attached = await attachedResponse.json();
  await service.wait(attached.id);
  const file = attached.events.filter((e: { kind: string }) => e.kind === "user").at(-1)
    .attachments[0];
  const fileResponse = await fetch(`${base}/api/projects/${project.id}/attachments/${file.id}`);
  expect(fileResponse.headers.get("content-type")).toBe("application/octet-stream");
  expect(await fileResponse.text()).toBe("reference");
  expect(
    (
      await fetch(`${base}/api/projects/${project.id}/attachments/${file.id}`, {
        headers: { Origin: "https://evil.example" },
      })
    ).status,
  ).toBe(403);
  const otherProject = await service.addProject(config.dataDir, "Other");
  expect(
    (await fetch(`${base}/api/projects/${otherProject.id}/attachments/${file.id}`)).status,
  ).toBe(404);
  expect(
    (await post("/api/settings", { values: { DEFAULT_SIMPLE_MODEL: "other:invalid" } })).status,
  ).toBe(400);
  const oldModel = process.env["DEFAULT_SIMPLE_MODEL"];
  const oldEffort = process.env["DEFAULT_SIMPLE_EFFORT"];
  try {
    expect(
      (await post("/api/settings", { values: { DEFAULT_SIMPLE_EFFORT: "invented" } })).status,
    ).toBe(400);
    expect(
      (await post("/api/settings", { values: { DEFAULT_SIMPLE_EFFORT: "ultra" } })).status,
    ).toBe(400);
    const settings = await post("/api/settings", {
      values: { DEFAULT_SIMPLE_MODEL: "codex:selected-model", DEFAULT_SIMPLE_EFFORT: "high" },
    });
    expect(settings.status).toBe(200);
    expect((await settings.json()).simpleModel).toBe("codex:selected-model");
    expect(config.defaultSimpleModel).toBe("codex:selected-model");
    expect(config.defaultSimpleEffort).toBe("high");
    expect(await readFile(path.join(config.dataDir, ".env"), "utf8")).toContain(
      "DEFAULT_SIMPLE_EFFORT=high",
    );
    const next = await post(`/api/projects/${project.id}/sessions`, {
      text: "usar modelo escolhido",
    }).then((r) => r.json());
    await service.wait(next.id);
    expect(service.session(next.id).agent).toBe("codex:selected-model");
    expect(service.session(next.id).effort).toBe("high");
    const reset = await post("/api/settings", { values: { DEFAULT_SIMPLE_EFFORT: "" } });
    expect(reset.status).toBe(200);
    expect((await reset.json()).simpleEffort).toBe("");
    expect(config.defaultSimpleEffort).toBeUndefined();
    expect(process.env["DEFAULT_SIMPLE_EFFORT"]).toBeUndefined();
  } finally {
    if (oldModel === undefined) delete process.env["DEFAULT_SIMPLE_MODEL"];
    else process.env["DEFAULT_SIMPLE_MODEL"] = oldModel;
    if (oldEffort === undefined) delete process.env["DEFAULT_SIMPLE_EFFORT"];
    else process.env["DEFAULT_SIMPLE_EFFORT"] = oldEffort;
  }
  await new Promise<void>((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`, { origin: "https://evil.example" });
    ws.on("open", () => {
      ws.close();
      reject(new Error("Foreign websocket accepted"));
    });
    ws.on("unexpected-response", (_, res) => {
      expect(res.statusCode).toBe(403);
      res.resume();
      ws.terminate();
      resolve();
    });
    ws.on("error", () => resolve());
  });
});
