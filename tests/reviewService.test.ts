import { describe, expect, it } from "vitest";
import { reviewMission } from "../src/application/reviewService.ts";

const verdict = { approved: true, summary: "Looks good", findings: [] };
const agent = async () => ({
  result: JSON.stringify(verdict),
  sessionId: "s",
  durationMs: 1,
  usage: { inputTokens: 4, outputTokens: 2 },
});
const jev = { reviewDiff: async () => ({ approved: true, noul: 1, source: "jev" as const }) };
const input = {
  missionId: "m",
  worktreePath: process.cwd(),
  diff: "+change",
  plan: "implement",
  timeoutMs: 1000,
};

describe("reviewMission", () => {
  it("requires both the structured reviewer and Jev to approve", async () => {
    expect((await reviewMission(input, { runAgent: agent, jev })).review.approved).toBe(true);
    const rejected = await reviewMission(input, {
      runAgent: agent,
      jev: { reviewDiff: async () => ({ approved: false, noul: 0, source: "jev" as const }) },
    });
    expect(rejected.review.approved).toBe(false);
    expect(rejected.review.findings.length).toBeGreaterThan(0);
  });

  it("never approves an unavailable or malformed reviewer", async () => {
    for (const result of ["not json", JSON.stringify({ approved: "yes", findings: [] })]) {
      const review = await reviewMission(input, {
        jev,
        runAgent: async () => ({ ...(await agent()), result }),
      });
      expect(review.review.approved).toBe(false);
      expect(review.review.source).toBe("unavailable");
    }
    const failure = await reviewMission(input, {
      jev,
      runAgent: async () => {
        throw new Error("offline");
      },
    });
    expect(failure.review.approved).toBe(false);
  });

  it("does not approve a verdict that includes error findings", async () => {
    const review = await reviewMission(input, {
      jev,
      runAgent: async () => ({
        ...(await agent()),
        result: JSON.stringify({
          ...verdict,
          findings: [{ severity: "error", file: "a.ts", line: 2, message: "broken" }],
        }),
      }),
    });
    expect(review.review.approved).toBe(false);
    expect(review.review.findings[0]?.file).toBe("a.ts");
    expect(review.agentRun?.usage.inputTokens).toBe(4);
  });
});
