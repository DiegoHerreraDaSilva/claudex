import { describe, expect, it, vi, beforeEach } from "vitest";
import { projectMissionEvent } from "../src/domain/missionSummary.js";
import type { ChatService } from "../src/app/chat.js";
import type { ProjectRegistry } from "../src/app/projects.js";
import { MissionBrowserService } from "../src/application/missionBrowserService.js";
const state = vi.hoisted(() => ({ head: "a".repeat(40), dirty: "" }));
vi.mock("../src/app/git.js", () => ({
  runGit: async (_cwd: string, args: string[]) => ({
    stdout: args[0] === "status" ? state.dirty : state.head,
  }),
}));
vi.mock("../src/application/checkpointService.js", () => ({
  assertMissionWorktree: async () => {},
}));
beforeEach(() => {
  state.head = "a".repeat(40);
  state.dirty = "";
});
function fixture(allowed = true) {
  let summary = projectMissionEvent(undefined, {
    id: "start",
    missionId: "m",
    at: 1,
    type: "mission:started",
    level: "info",
    message: "fixture",
    payload: { projectId: "p" },
  })!;
  Object.assign(summary, { status: "ready", head: state.head, branch: "mission" });
  const events: string[] = [];
  const chat = {
    withProjectOperation: async (_id: string, action: () => Promise<unknown>) => action(),
    missionSummary: async () => summary,
    broker: () => ({ authorize: async () => allowed }),
    recordMissionEvent: async (_id: string, event: any) => {
      events.push(event.type);
      summary = projectMissionEvent(summary, { ...event, id: "event", missionId: "m", at: 2 })!;
    },
  } as unknown as ChatService;
  const conversation = { id: "m", branch: "mission", worktreePath: "managed" };
  const registry = {
    list: () => [{ id: "p", rootPath: "root", conversations: [conversation] }],
    getConversation: () => conversation,
  } as unknown as ProjectRegistry;
  const run = vi.fn(async (input) => ({
    ...input,
    title: "Fixture",
    errors: [],
    durationMs: 3,
    captured: true,
  }));
  const service = new MissionBrowserService(chat, registry, "managed", "data", run);
  return { service, run, events, summary: () => summary };
}
const input = {
  url: "http://localhost:3000",
  channel: "chrome" as const,
  expectedHead: "a".repeat(40),
};
describe("mission Browser QA", () => {
  it("records capture and reviewed head without changing mission readiness, and replaces a previous check", async () => {
    const f = fixture();
    const first = await f.service.check("m", input);
    expect(first.status).toBe("passed");
    expect(first.head).toBe(input.expectedHead);
    expect(first.screenshot).toContain(first.id);
    expect(f.summary().status).toBe("ready");
    await f.service.check("m", { ...input, channel: "msedge" });
    expect(f.summary().verification).toHaveLength(1);
    expect(f.summary().verification[0].id).not.toBe(first.id);
    expect(f.events).toEqual(Array(4).fill("browser:checked"));
  });
  it("blocks manual mode before launching a browser", async () => {
    const f = fixture(false);
    await expect(f.service.check("m", input)).rejects.toMatchObject({ status: 403 });
    expect(f.run).not.toHaveBeenCalled();
    expect(f.events).toEqual([]);
  });
  it("rejects stale commits and dirty worktrees before launching", async () => {
    const f = fixture();
    await expect(
      f.service.check("m", { ...input, expectedHead: "b".repeat(40) }),
    ).rejects.toMatchObject({ status: 409 });
    state.dirty = " M file";
    await expect(f.service.check("m", input)).rejects.toMatchObject({ status: 409 });
    expect(f.run).not.toHaveBeenCalled();
  });
  it("records detected page errors and unavailable browser as failed, never successful", async () => {
    const f = fixture();
    f.run.mockImplementationOnce(async (input) => ({
      ...input,
      title: "",
      errors: ["HTTP 500"],
      durationMs: 3,
      captured: false,
    }));
    expect((await f.service.check("m", input)).status).toBe("failed");
    f.run.mockRejectedValueOnce(new Error("Browser missing"));
    const result = await f.service.check("m", input);
    expect(result.status).toBe("failed");
    expect(result.output).toBe("Browser missing");
    expect(f.summary().verification).toHaveLength(1);
  });
  it("invalidates a browser result when the worktree changes during the check", async () => {
    const f = fixture();
    f.run.mockImplementationOnce(async (input) => {
      state.head = "b".repeat(40);
      return { ...input, title: "", errors: [], durationMs: 3, captured: true };
    });
    const result = await f.service.check("m", input);
    expect(result.status).toBe("failed");
    expect(result.screenshot).toBeUndefined();
  });
  it("rejects screenshot traversal and captures outside the current mission result", async () => {
    const f = fixture();
    await expect(f.service.screenshot("m", "../private")).rejects.toMatchObject({ status: 404 });
    await expect(f.service.screenshot("m", "b".repeat(36))).rejects.toMatchObject({ status: 404 });
  });
});
