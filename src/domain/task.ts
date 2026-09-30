import type { AgentKind, TokenUsage } from "./agent.js";

export type TaskStatus =
  | "pending"
  | "planning"
  | "implementing"
  | "verifying"
  | "reviewing"
  | "completed"
  | "failed"
  | "merged"
  | "cancelled";

export interface Task {
  id: string;
  missionId: string;
  description: string;
  dependsOn: string[];
  agent: string;
  agentKind: AgentKind;
  model: string;
  status: TaskStatus;
  worktree?: string;
  branch?: string;
  usage: TokenUsage;
  costUsd: number;
  filesTouched: string[];
  startedAt?: number;
  completedAt?: number;
  error?: string;
}
