import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { ThreadEvent } from "@openai/codex-sdk";
import type { Complexity } from "../jev.js";
import type { ContextUsage } from "../application/context.js";
import { validEffort, type AgentEffort } from "./effort.js";
export type ClaudeModel = string;
export type AgentKind = "claude" | "codex";
export interface ClaudeAgentSpec {
  effort?: AgentEffort;
  roleName?: "Planner" | "Simple" | "Complex";
  kind: "claude";
  model: ClaudeModel;
  label: string;
}
export interface CodexAgentSpec {
  effort?: AgentEffort;
  roleName?: "Planner" | "Simple" | "Complex";
  kind: "codex";
  model: string;
  label: string;
}
export type AgentSpec = ClaudeAgentSpec | CodexAgentSpec;
export interface AgentUsage {
  inputTokens: number;
  outputTokens: number;
}
export interface AgentRunResult {
  context?: ContextUsage;
  result: string;
  durationMs: number;
  usage: AgentUsage;
  sessionId?: string;
  threadId?: string;
}
export class AgentError extends Error {
  readonly kind: AgentKind;
  readonly sessionId: string | undefined;
  constructor(
    kind: AgentKind,
    message: string,
    options: { sessionId?: string; cause?: unknown } = {},
  ) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "AgentError";
    this.kind = kind;
    this.sessionId = options.sessionId;
  }
}
export type ClaudeMessageHandler = (message: SDKMessage) => void;
export type CodexEventHandler = (event: ThreadEvent) => void;
export function agentForComplexity(
  complexity: Complexity,
  config: {
    plannerModel: string;
    simpleModel: string;
    complexModel: string;
    plannerEffort?: AgentEffort;
    simpleEffort?: AgentEffort;
    complexEffort?: AgentEffort;
  },
): AgentSpec {
  const configured =
    complexity === "strong"
      ? config.complexModel
      : complexity === "judgment"
        ? config.plannerModel
        : config.simpleModel;
  const fallback = complexity === "strong" ? "codex" : "claude";
  const separator = configured.indexOf(":");
  const kind = separator >= 0 ? configured.slice(0, separator) : fallback;
  const model = separator >= 0 ? configured.slice(separator + 1) : configured;
  if ((kind !== "claude" && kind !== "codex") || !model.trim())
    throw new Error("Provedor ou modelo inválido.");
  const effort =
    complexity === "strong"
      ? config.complexEffort
      : complexity === "judgment"
        ? config.plannerEffort
        : config.simpleEffort;
  if (effort && !validEffort(kind, effort))
    throw new Error(`Esforço ${effort} não é aceito pelo provedor ${kind}.`);
  return { kind, model, label: `${kind}:${model}`, ...(effort ? { effort } : {}) };
}
