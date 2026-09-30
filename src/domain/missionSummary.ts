import type { AgentRun, TokenUsage } from "./agent.js";
import type { TaskEvent } from "./event.js";
import type { MissionStatus } from "./mission.js";
import type { Review } from "./review.js";
import type { VerificationRun } from "./verification.js";

export interface MissionSummary {
  id: string;
  projectId: string;
  title: string;
  status: MissionStatus;
  startedAt: number;
  updatedAt: number;
  revision: number;
  finishedAt?: number;
  branch?: string;
  baseBranch?: string;
  head?: string;
  files: string[];
  additions: number;
  deletions: number;
  tasks: string[];
  agentRuns: AgentRun[];
  verification: VerificationRun[];
  review?: Review;
  usage: TokenUsage;
  costUsd: number;
  error?: string;
}

export function projectMissionEvent(
  previous: MissionSummary | undefined,
  event: TaskEvent,
): MissionSummary | undefined {
  const payload = event.payload ?? {};
  if (event.type === "mission:started") {
    return {
      id: event.missionId,
      projectId: String(payload.projectId ?? ""),
      title: event.message,
      status: "implementing",
      startedAt: event.at,
      updatedAt: event.at,
      revision: (previous?.revision ?? 0) + 1,
      files: [],
      additions: 0,
      deletions: 0,
      tasks: [],
      agentRuns: [],
      verification: [],
      usage: { inputTokens: 0, outputTokens: 0 },
      costUsd: 0,
    };
  }
  if (!previous) return undefined;
  const summary = {
    ...previous,
    updatedAt: Math.max(previous.updatedAt, event.at),
    revision: (previous.revision ?? 0) + 1,
  };
  switch (event.type) {
    case "router:decided":
      summary.status = payload.route === "plan" ? "planning" : "implementing";
      break;
    case "plan:created":
      summary.tasks = (payload.subtasks as string[] | undefined) ?? [];
      break;
    case "agent:started":
      if (payload.role !== "reviewer")
        summary.status = payload.role === "planner" ? "planning" : "implementing";
      break;
    case "agent:completed": {
      const run = payload.run as AgentRun | undefined;
      if (!run) break;
      summary.agentRuns = [...summary.agentRuns, run];
      summary.usage = {
        inputTokens: summary.usage.inputTokens + run.usage.inputTokens,
        outputTokens: summary.usage.outputTokens + run.usage.outputTokens,
      };
      summary.costUsd += run.costUsd;
      break;
    }
    case "diff:created":
      summary.files = (payload.files as string[] | undefined) ?? [];
      summary.branch = payload.branch as string | undefined;
      summary.baseBranch = payload.baseBranch as string | undefined;
      summary.head = payload.head as string | undefined;
      summary.additions = Number(payload.additions ?? 0);
      summary.deletions = Number(payload.deletions ?? 0);
      break;
    case "verification:started":
    case "verification:completed": {
      summary.status = "verifying";
      const verification = payload.verification as VerificationRun | undefined;
      if (verification)
        summary.verification = [
          ...summary.verification.filter((run) => run.kind !== verification.kind),
          verification,
        ];
      break;
    }
    case "review:started":
      summary.status = "reviewing";
      break;
    case "review:completed":
      summary.review = payload.review as Review | undefined;
      break;
    case "mission:completed":
      summary.status = payload.readOnly ? "analysed" : "ready";
      summary.finishedAt = event.at;
      break;
    case "mission:failed":
      summary.status = "failed";
      summary.error = event.message;
      summary.finishedAt = event.at;
      break;
    case "mission:stopped":
      summary.status = "cancelled";
      summary.finishedAt ??= event.at;
      break;
    case "mission:applied":
      summary.status = "applied";
      break;
  }
  return summary;
}
