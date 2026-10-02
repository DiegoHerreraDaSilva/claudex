import { expect, it } from "vitest";
import { agentForComplexity } from "../src/agents/types.js";
it("selects effort by role and rejects provider-incompatible values", () => {
  const config = {
    simpleModel: "claude:sonnet",
    complexModel: "codex:gpt-6-sol",
    plannerModel: "claude:opus",
    simpleEffort: "low" as const,
    complexEffort: "ultra" as const,
    plannerEffort: "max" as const,
  };
  expect(agentForComplexity("fast", config).effort).toBe("low");
  expect(agentForComplexity("balanced", config).effort).toBe("low");
  expect(agentForComplexity("strong", config).effort).toBe("ultra");
  expect(agentForComplexity("judgment", config).effort).toBe("max");
  expect(() => agentForComplexity("balanced", { ...config, simpleEffort: "ultra" })).toThrow(
    "não é aceito",
  );
});
it("uses exact configured providers and models for all agent roles", () => {
  const config = {
    simpleModel: "codex:selected-simple",
    complexModel: "claude:claude-custom-model",
    plannerModel: "claude:claude-opus-5-5",
  };
  expect(agentForComplexity("balanced", config)).toEqual({
    kind: "codex",
    model: "selected-simple",
    label: "codex:selected-simple",
  });
  expect(agentForComplexity("strong", config)).toMatchObject({
    kind: "claude",
    model: "claude-custom-model",
  });
  expect(agentForComplexity("judgment", config)).toEqual({
    kind: "claude",
    model: "claude-opus-5-5",
    label: "claude:claude-opus-5-5",
  });
});
