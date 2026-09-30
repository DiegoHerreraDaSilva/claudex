import { describe, expect, it } from "vitest";
import { validateMission } from "../src/application/missionValidation.ts";
import type { MissionEventInput } from "../src/domain/event.ts";
import type { VerificationRun } from "../src/domain/verification.ts";

const input = {
  missionId: "m",
  worktreePath: "repo",
  plan: "task",
  timeoutMs: 1000,
  signal: new AbortController().signal,
};
const review = {
  id: "r",
  missionId: "m",
  approved: true,
  source: "claude",
  summary: "ok",
  findings: [],
  at: 1,
};
const failed: VerificationRun = {
  id: "v",
  missionId: "m",
  kind: "tests",
  status: "failed",
  summary: "broken",
  output: "assert failed",
  at: 1,
};

describe("mission validation", () => {
  it("re-verifies after one correction and emits the final review", async () => {
    let attempts = 0;
    let corrections = 0;
    const events: MissionEventInput[] = [];
    await validateMission(input, {
      captureDiff: async () => "+change",
      verify: async () => [attempts++ === 0 ? failed : { ...failed, status: "passed" }],
      review: async () => ({ review }),
      correct: async (prompt) => {
        expect(prompt).toContain("assert failed");
        corrections++;
      },
      record: async (event) => {
        events.push(event);
      },
      onReviewUsage: async () => {},
    });
    expect(corrections).toBe(1);
    expect(attempts).toBe(2);
    expect(events.filter((event) => event.type === "review:completed")).toHaveLength(2);
  });

  it("fails after the correction budget is exhausted", async () => {
    let corrections = 0;
    await expect(
      validateMission(input, {
        captureDiff: async () => "+change",
        verify: async () => [failed],
        review: async () => ({ review }),
        correct: async () => {
          corrections++;
        },
        record: async () => {},
        onReviewUsage: async () => {},
      }),
    ).rejects.toThrow("Validation failed");
    expect(corrections).toBe(1);
  });

  it("does not try to repair unavailable reviews and respects cancellation", async () => {
    const deps = {
      captureDiff: async () => "",
      verify: async () => [],
      review: async () => ({ review: { ...review, approved: false, source: "unavailable" } }),
      correct: async () => {
        throw new Error("should not correct");
      },
      record: async () => {},
      onReviewUsage: async () => {},
    };
    await expect(validateMission(input, deps)).rejects.toThrow("Validation failed");
    await expect(
      validateMission({ ...input, signal: AbortSignal.abort() }, deps),
    ).rejects.toThrow();
  });
});
