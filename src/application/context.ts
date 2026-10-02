export interface ContextUsage {
  usedTokens: number;
  limitTokens?: number;
  source: "sdk" | "estimate";
  limitSource?: "sdk" | "documented";
  compactedAt?: number;
}
/** Only exact documented model IDs have a fallback; provider aliases remain unknown. */
export function documentedContextLimit(label: string): number | undefined {
  const model = label.split(":").at(-1);
  if (model === "gpt-6-sol" || model === "gpt-6.1-sol") return 1_050_000;
  if (model === "claude-sonnet-5-5" || model === "claude-opus-5-5") return 1_000_000;
  return undefined;
}
export function estimatedContext(text: string, label: string): ContextUsage {
  const limitTokens = documentedContextLimit(label);
  return {
    usedTokens: Math.ceil(text.length / 4),
    source: "estimate",
    ...(limitTokens ? { limitTokens, limitSource: "documented" as const } : {}),
  };
}
