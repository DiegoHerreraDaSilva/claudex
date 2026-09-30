import { describe, expect, it } from "vitest";
import { projectMissionEvent } from "../src/domain/missionSummary.ts";
import type { TaskEvent } from "../src/domain/event.ts";

function event(type: TaskEvent["type"], payload?: Record<string, unknown>): TaskEvent {
  return { id: "e", missionId: "m", type, level: "info", message: "task", at: 100, payload };
}

describe("mission projection", () => {
  it("resets the previous turn and advances through real verification and review states", () => {
    let summary = projectMissionEvent(undefined, event("mission:started", { projectId: "p" }));
    expect(summary?.projectId).toBe("p");
    summary = projectMissionEvent(
      summary,
      event("verification:started", {
        verification: { id: "v", kind: "tests", status: "running" },
      }),
    );
    expect(summary?.status).toBe("verifying");
    summary = projectMissionEvent(
      summary,
      event("verification:completed", {
        verification: { id: "v", kind: "tests", status: "passed", testCount: 3 },
      }),
    );
    expect(summary?.verification).toHaveLength(1);
    summary = projectMissionEvent(summary, event("review:started"));
    expect(summary?.status).toBe("reviewing");
    summary = projectMissionEvent(summary, event("mission:completed"));
    expect(summary?.status).toBe("ready");
    const restored = projectMissionEvent(summary, { ...event("mission:stopped"), at: 999 });
    expect(restored?.status).toBe("cancelled");
    expect(restored?.finishedAt).toBe(100);
    summary = projectMissionEvent(
      summary,
      event("github:pull-request", { pullRequest: { number: 7 }, repo: "owner/repo" }),
    );
    summary = projectMissionEvent(
      summary,
      event("github:checks", { ci: { pullRequest: { number: 7 }, status: "pending" } }),
    );
    expect(summary?.ci?.status).toBe("pending");
    summary = projectMissionEvent(summary, event("mission:started"));
    expect(summary?.pullRequest?.number).toBe(7);
    expect(summary?.githubRepo).toBe("owner/repo");
    expect(summary?.ci).toBeUndefined();
    expect(summary?.verification).toEqual([]);
    expect(summary?.finishedAt).toBeUndefined();
  });

  it("aggregates usage and costs and retains cancellation", () => {
    let summary = projectMissionEvent(undefined, event("mission:started"));
    summary = projectMissionEvent(
      summary,
      event("agent:completed", {
        run: { id: "r", usage: { inputTokens: 10, outputTokens: 3 }, costUsd: 0.05 },
      }),
    );
    expect(summary?.costUsd).toBe(0.05);
    expect(summary?.usage.inputTokens).toBe(10);
    summary = projectMissionEvent(summary, event("mission:stopped"));
    expect(summary?.status).toBe("cancelled");
  });
});
