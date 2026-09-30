import type { AgentRun, TokenUsage } from "./agent.js";
import type { Checkpoint } from "./checkpoint.js";
import type { Review } from "./review.js";
import type { Task } from "./task.js";
import type { VerificationRun } from "./verification.js";

export type MissionStatus =
  | "draft"
  | "planning"
  | "implementing"
  | "verifying"
  | "reviewing"
  | "ready"
  | "applied"
  | "failed"
  | "cancelled";

export type AutonomyMode = "manual" | "assisted" | "autonomous";

export interface MissionRoute {
  stage: "implement" | "plan";
  agent: string;
  model: string;
  label: string;
  confidence: number;
  source: string;
}

export interface Mission {
  id: string;
  projectId: string;
  title: string;
  intent: string;
  status: MissionStatus;
  autonomy: AutonomyMode;
  route?: MissionRoute;
  branch?: string;
  worktreePath?: string;
  baseBranch?: string;
  createdAt: number;
  startedAt?: number;
  finishedAt?: number;
  usage: TokenUsage;
  costUsd: number;
  tasks: Task[];
  agentRuns: AgentRun[];
  verification: VerificationRun[];
  review?: Review;
  checkpoints: Checkpoint[];
}
