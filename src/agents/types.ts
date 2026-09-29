import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { ThreadEvent } from "@openai/codex-sdk";
import type { Complexity } from "../jev.js";

export type ClaudeModel = "opus" | "sonnet" | "haiku";
export type AgentKind = "claude" | "codex";

export interface ClaudeAgentSpec {
  kind: "claude";
  model: ClaudeModel;
  label: string;
}

export interface CodexAgentSpec {
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
  },
): AgentSpec {
  switch (complexity) {
    case "fast":
    case "balanced":
      return {
        kind: "claude",
        model: toClaudeModel(config.simpleModel, "sonnet"),
        label: `claude:${toClaudeModel(config.simpleModel, "sonnet")}`,
      };
    case "strong":
      return { kind: "codex", model: config.complexModel, label: `codex:${config.complexModel}` };
    case "judgment":
      return {
        kind: "claude",
        model: toClaudeModel(config.plannerModel, "opus"),
        label: `claude:${toClaudeModel(config.plannerModel, "opus")}`,
      };
  }
}

function toClaudeModel(value: string, fallback: ClaudeModel): ClaudeModel {
  if (value === "opus" || value === "sonnet" || value === "haiku") return value;
  return fallback;
}
