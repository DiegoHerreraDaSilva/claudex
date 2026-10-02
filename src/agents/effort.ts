import type { EffortLevel } from "@anthropic-ai/claude-agent-sdk";
import type { ModelReasoningEffort } from "@openai/codex-sdk";
export type AgentEffort = EffortLevel | ModelReasoningEffort;
export const effortLevels = {
  claude: ["low", "medium", "high", "xhigh", "max"],
  codex: ["minimal", "low", "medium", "high", "xhigh", "max", "ultra", "persistent"],
} as const;
export function validEffort(kind: "claude" | "codex", value: string): value is AgentEffort {
  return (effortLevels[kind] as readonly string[]).includes(value);
}
export function configuredEffort(value: string | undefined): AgentEffort | undefined {
  const trimmed = value?.trim();
  return trimmed && (validEffort("claude", trimmed) || validEffort("codex", trimmed))
    ? trimmed
    : undefined;
}
