import type { TokenUsage } from "../domain/agent.js";

export interface ModelPrice {
  /** USD per 1M input tokens. */
  inputPerMillion: number;
  /** USD per 1M output tokens. */
  outputPerMillion: number;
}

/**
 * Approximate public prices used only to give the user a sense of cost.
 * Values are estimates and can be overridden via the DEFAULT_* env keys later.
 */
export const MODEL_PRICES: Record<string, ModelPrice> = {
  opus: { inputPerMillion: 15, outputPerMillion: 75 },
  sonnet: { inputPerMillion: 3, outputPerMillion: 15 },
  haiku: { inputPerMillion: 0.8, outputPerMillion: 4 },
  gpt: { inputPerMillion: 1.25, outputPerMillion: 10 },
  default: { inputPerMillion: 3, outputPerMillion: 15 },
};

export function priceFor(model: string): ModelPrice {
  const key = model.toLowerCase();
  for (const [name, price] of Object.entries(MODEL_PRICES)) {
    if (name !== "default" && key.includes(name)) return price;
  }
  return MODEL_PRICES["default"]!;
}

export function estimateCostUsd(model: string, usage: TokenUsage): number {
  const price = priceFor(model);
  const cost =
    (usage.inputTokens / 1_000_000) * price.inputPerMillion +
    (usage.outputTokens / 1_000_000) * price.outputPerMillion;
  return Math.round(cost * 1e6) / 1e6;
}
