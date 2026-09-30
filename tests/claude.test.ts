import { expect, it, vi } from "vitest";
const { query } = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("@anthropic-ai/claude-agent-sdk", () => ({ query }));
import { runClaudeAgent } from "../src/agents/claude.ts";

it("uses the SDK structured output for schema-based reviews and plans", async () => {
  query.mockReturnValue(
    (async function* () {
      yield {
        type: "result",
        subtype: "success",
        result: "Review complete",
        structured_output: { approved: true, summary: "ok", findings: [] },
        usage: { input_tokens: 1, output_tokens: 2 },
      };
    })(),
  );
  const result = await runClaudeAgent({
    prompt: "review",
    model: "opus",
    worktreePath: process.cwd(),
    outputSchema: {},
    tools: ["Read"],
  });
  expect(JSON.parse(result.result).approved).toBe(true);
  expect(query.mock.calls[0]?.[0]?.options.tools).toEqual(["Read"]);
});
