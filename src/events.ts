import { EventEmitter } from "node:events";
import type { AgentKind, AgentUsage } from "./agents/types.js";
import type { Complexity, DecisionSource } from "./jev.js";

export type TaskStatus =
  | "pending"
  | "deciding"
  | "running"
  | "reviewing"
  | "completed"
  | "failed"
  | "merged";

export type TaskMessageRole = "system" | "assistant" | "tool" | "result" | "error";

export interface TaskMessage {
  at: number;
  role: TaskMessageRole;
  text: string;
  meta?: string;
}

export type TaskUsage = AgentUsage;

export interface ReviewOutcome {
  approved: boolean;
  noul: number;
  source: DecisionSource;
  summary: string;
  issues: string[];
}

export interface TaskSnapshot {
  taskId: string;
  description: string;
  agent: string;
  agentKind: AgentKind;
  model: string;
  complexity: Complexity;
  status: TaskStatus;
  worktree: string;
  branch: string;
  sessionId?: string;
  threadId?: string;
  messages: TaskMessage[];
  diff?: string;
  review?: ReviewOutcome;
  error?: string;
  startedAt?: number;
  completedAt?: number;
  usage: TaskUsage;
  turns: number;
  filesTouched: string[];
}

export interface TaskCreatedEvent {
  taskId: string;
  description: string;
}

export interface TaskDecidedEvent {
  taskId: string;
  choice: Complexity;
  probabilities: Record<string, number>;
  confidence: number;
  source: DecisionSource;
  agent: string;
  model: string;
}

export interface TaskStartedEvent {
  taskId: string;
  agent: string;
  worktree: string;
  sessionId?: string;
}

export interface TaskMessageEvent {
  taskId: string;
  agent: string;
  message: TaskMessage;
}

export interface TaskCompletedEvent {
  taskId: string;
  diff: string;
  durationMs: number;
  usage: TaskUsage;
}

export interface TaskFailedEvent {
  taskId: string;
  error: string;
}

export interface FleetUpdatedEvent {
  tasks: TaskSnapshot[];
  parallelized: boolean;
  startedAt: number;
}

export interface OrchestratorEventMap {
  "task:created": TaskCreatedEvent;
  "task:decided": TaskDecidedEvent;
  "task:started": TaskStartedEvent;
  "task:message": TaskMessageEvent;
  "task:completed": TaskCompletedEvent;
  "task:failed": TaskFailedEvent;
  "fleet:updated": FleetUpdatedEvent;
}

export type OrchestratorEventName = keyof OrchestratorEventMap;

export interface SerializedEvent<E extends OrchestratorEventName = OrchestratorEventName> {
  event: E;
  data: OrchestratorEventMap[E];
}

export class TypedEmitter<Events extends { [K in keyof Events]: unknown }> {
  private readonly emitter = new EventEmitter();

  on<K extends keyof Events & string>(
    event: K,
    listener: (payload: Events[K]) => void,
  ): this {
    this.emitter.on(event, listener as (payload: unknown) => void);
    return this;
  }

  off<K extends keyof Events & string>(
    event: K,
    listener: (payload: Events[K]) => void,
  ): this {
    this.emitter.off(event, listener as (payload: unknown) => void);
    return this;
  }

  emit<K extends keyof Events & string>(event: K, payload: Events[K]): boolean {
    return this.emitter.emit(event, payload);
  }

  removeAllListeners(): this {
    this.emitter.removeAllListeners();
    return this;
  }
}
