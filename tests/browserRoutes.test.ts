import { createServer } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import type { ChatService } from "../src/app/chat.js";
import type { ProjectRegistry } from "../src/app/projects.js";
import { projectToolsRoutes } from "../src/server/projectTools.js";
const servers: ReturnType<typeof createServer>[] = [];
afterEach(async () => {
  await Promise.all(
    servers
      .splice(0)
      .map((server) => new Promise<void>((resolve) => server.close(() => resolve()))),
  );
});
async function fixture() {
  const chat = {
    missionSummary: async () => undefined,
    withProjectOperation: async (_id: string, action: () => unknown) => action(),
  } as unknown as ChatService;
  const project = { id: "p", rootPath: "root", conversations: [{ id: "m" }] };
  const registry = {
    list: () => [project],
    getConversation: () => project.conversations[0],
  } as unknown as ProjectRegistry;
  const route = projectToolsRoutes(chat, registry, "data", "worktrees", () => {});
  const server = createServer(async (req, res) => {
    if (!(await route(req, res, new URL(req.url!, `http://${req.headers.host}`)))) {
      res.writeHead(404);
      res.end();
    }
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No port");
  const base = `http://127.0.0.1:${address.port}`;
  const post = (body: unknown, origin?: string, mission = "m") =>
    fetch(`${base}/api/missions/${mission}/browser-qa`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(origin ? { Origin: origin } : {}) },
      body: JSON.stringify(body),
    });
  return { base, post };
}
describe("Browser QA HTTP contract", () => {
  it("validates browser, URL, commit, registered mission and origin before execution", async () => {
    const { post } = await fixture();
    const input = { url: "http://localhost:3000", channel: "chrome", expectedHead: "a".repeat(40) };
    expect((await post({ ...input, channel: "firefox" })).status).toBe(400);
    expect((await post({ ...input, expectedHead: "bad" })).status).toBe(400);
    expect((await post({ ...input, url: "https://example.com" })).status).toBe(400);
    expect((await post(input, "https://attacker.example")).status).toBe(403);
    expect((await post(input, undefined, "unknown")).status).toBe(404);
    const response = await post(input);
    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe("MISSION_CHANGED");
  });
  it("only serves a capture belonging to the current mission verification", async () => {
    const { base } = await fixture();
    expect(
      (
        await fetch(
          `${base}/api/missions/m/browser-qa/12345678-1234-1234-1234-123456789abc/screenshot`,
        )
      ).status,
    ).toBe(404);
  });
});
