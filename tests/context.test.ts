import { expect, it } from "vitest";
import { estimatedContext } from "../src/application/context.js";
it("labels estimates and does not invent limits for model aliases or unknown models", () => {
  expect(estimatedContext("12345678", "claude:sonnet")).toEqual({
    usedTokens: 2,
    source: "estimate",
  });
  expect(estimatedContext("1234", "codex:gpt-6.1-sol")).toMatchObject({
    limitTokens: 1050000,
    limitSource: "documented",
  });
});
