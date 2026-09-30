import { createServer, request as httpRequest } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkService } from "../src/application/workService.js";
import { ProjectRegistry } from "../src/app/projects.js";
import { workRoutes } from "../src/server/workRoutes.js";
import type { ChatService } from "../src/app/chat.js";
import type { CredentialStatus } from "../src/prerequisites.js";
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});
async function fixture() {
  const dir = await mkdtemp(path.join(tmpdir(), "claudex-work-http-"));
  const registry = new ProjectRegistry(dir);
  await registry.load();
  const project = await registry.create("Example", dir);
  await registry.flush();
  const chat = {
    missionSummary: async () => undefined,
    isRunning: () => false,
    projectBusy: () => false,
  } as unknown as ChatService;
  const work = new WorkService(
    chat,
    registry,
    dir,
    () => {},
    () => false,
  );
  const create = vi.spyOn(work, "create");
  const route = workRoutes(
    work,
    chat,
    registry,
    () =>
      ({
        claude: { mode: "none" },
        codex: { mode: "none" },
        typesafe: { configured: false },
      }) as CredentialStatus,
  );
  const server = createServer(async (req, res) => {
    if (!(await route(req, res, new URL(req.url!, `http://${req.headers.host}`)))) {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No port");
  cleanups.push(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(dir, { recursive: true, force: true, maxRetries: 4, retryDelay: 100 });
  });
  const base = `http://127.0.0.1:${address.port}`;
  const request = (url: string, method = "GET", body?: unknown, headers = {}) =>
    fetch(base + url, {
      method,
      headers: { "Content-Type": "application/json", ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  return {
    request,
    base,
    create,
    work,
    input: {
      projectId: project.id,
      title: "Help me",
      instructions: "Improve my project",
      mode: "assisted",
    },
  };
}
describe("work HTTP contract", () => {
  it("persists task CRUD and reports disconnected execution without losing the task", async () => {
    const f = await fixture();
    const response = await f.request("/api/work-items", "POST", f.input);
    expect(response.status).toBe(201);
    const task = await response.json();
    expect(
      (await f.request(`/api/work-items/${task.id}`, "PUT", { ...f.input, title: "Updated" }))
        .status,
    ).toBe(200);
    const run = await f.request(`/api/work-items/${task.id}/run`, "POST", {});
    expect(run.status).toBe(503);
    expect((await run.json()).code).toBe("ASSISTANT_REQUIRED");
    expect((await (await f.request("/api/work/overview")).json()).tasks).toMatchObject([
      { title: "Updated", status: "todo" },
    ]);
    expect((await f.request(`/api/work-items/${task.id}`, "DELETE")).status).toBe(200);
    expect((await (await f.request("/api/work/overview")).json()).tasks).toEqual([]);
  });
  it("validates origin, host, JSON and input before mutating data", async () => {
    const f = await fixture();
    expect(
      (await f.request("/api/work-items", "POST", f.input, { Origin: "https://attacker.example" }))
        .status,
    ).toBe(403);
    const hostStatus = await new Promise<number>((resolve) => {
      const req = httpRequest(
        new URL("/api/work/overview", f.base),
        { headers: { Host: "attacker.example" } },
        (res) => {
          res.resume();
          resolve(res.statusCode!);
        },
      );
      req.end();
    });
    expect(hostStatus).toBe(403);
    expect(
      (await f.request("/api/work-items", "POST", f.input, { "Content-Type": "text/plain" }))
        .status,
    ).toBe(400);
    expect(
      (await f.request("/api/work-items", "POST", { ...f.input, instructions: "x".repeat(33000) }))
        .status,
    ).toBe(400);
    expect(
      (await f.request("/api/work-items", "POST", { ...f.input, mode: "invalid" })).status,
    ).toBe(400);
    expect(f.create).not.toHaveBeenCalled();
    expect((await f.request("/api/work-items", "PATCH", {})).status).toBe(405);
  });
  it("persists schedule pause, edit, resume and deletion through the API", async () => {
    const f = await fixture();
    const input = { ...f.input, startsAt: Date.now() + 600000, repeat: "daily" };
    const response = await f.request("/api/schedules", "POST", input);
    expect(response.status).toBe(201);
    const item = await response.json();
    expect((await f.request(`/api/schedules/${item.id}`, "PATCH", { enabled: false })).status).toBe(
      200,
    );
    expect(
      (await f.request(`/api/schedules/${item.id}`, "PUT", { ...input, repeat: "weekly" })).status,
    ).toBe(200);
    expect((await f.request(`/api/schedules/${item.id}`, "PATCH", { enabled: true })).status).toBe(
      200,
    );
    expect((await (await f.request("/api/work/overview")).json()).schedules).toMatchObject([
      { enabled: true, repeat: "weekly" },
    ]);
    expect((await f.request(`/api/schedules/${item.id}`, "DELETE")).status).toBe(200);
  });
  it("returns account state without credentials or session identifiers", async () => {
    const f = await fixture();
    const response = await f.request("/api/assistants");
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      providers: [
        { id: "claude", connected: false, recent: [] },
        { id: "codex", connected: false, recent: [] },
      ],
      routerConfigured: false,
    });
  });
});
