export type MissionEventType =
  | "mission:started"
  | "mission:completed"
  | "mission:failed"
  | "mission:stopped"
  | "router:decided"
  | "plan:created"
  | "agent:started"
  | "agent:message"
  | "agent:tool"
  | "agent:completed"
  | "agent:failed"
  | "diff:created"
  | "cost:updated"
  | "checkpoint:created"
  | "verification:started"
  | "verification:completed"
  | "review:completed";

export type MissionEventLevel = "info" | "warn" | "error" | "success";

export interface TaskEvent {
  id: string;
  missionId: string;
  taskId?: string;
  at: number;
  type: MissionEventType;
  level: MissionEventLevel;
  message: string;
  payload?: Record<string, unknown>;
}

export type MissionEventInput = Omit<TaskEvent, "id" | "missionId" | "at"> & { at?: number };
