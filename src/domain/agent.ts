export type AgentKind = "claude" | "codex";

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface AgentRun {
  id: string;
  missionId: string;
  taskId?: string;
  agentKind: AgentKind;
  model: string;
  label: string;
  sessionId?: string;
  threadId?: string;
  usage: TokenUsage;
  costUsd: number;
  startedAt: number;
  endedAt: number;
}
