import { describe, it, expect } from "vitest";
import { estimateCostUsd, priceFor } from "../src/infrastructure/pricing.ts";

describe("pricing", () => {
  it("prices sonnet/opus/haiku", () => {
    expect(priceFor("sonnet").inputPerMillion).toBe(3);
    expect(priceFor("claude:opus").outputPerMillion).toBe(75);
    expect(priceFor("haiku").inputPerMillion).toBe(0.8);
  });

  it("treats codex/gpt models as gpt family", () => {
    expect(priceFor("gpt-6-sol").inputPerMillion).toBe(1.25);
    expect(priceFor("codex:gpt-6-sol").outputPerMillion).toBe(10);
  });

  it("falls back to the default price for unknown models", () => {
    expect(priceFor("mystery-model")).toEqual(priceFor("default"));
  });

  it("estimates cost from token usage", () => {
    expect(estimateCostUsd("sonnet", { inputTokens: 1_000_000, outputTokens: 0 })).toBe(3);
    expect(estimateCostUsd("opus", { inputTokens: 1_000_000, outputTokens: 1_000_000 })).toBe(90);
    expect(estimateCostUsd("sonnet", { inputTokens: 0, outputTokens: 0 })).toBe(0);
  });
});
