import type { AutonomyMode } from "./mission.js";
export type WorkStatus = "todo" | "running" | "review" | "done" | "attention" | "cancelled";
export type Repeat = "once" | "daily" | "weekly";
export interface WorkInput {
  projectId: string;
  title: string;
  instructions: string;
  mode: AutonomyMode;
}
export interface WorkItem extends WorkInput {
  id: string;
  status: WorkStatus;
  createdAt: number;
  updatedAt: number;
  conversationId?: string;
  scheduleId?: string;
  error?: string;
}
export interface ScheduleInput extends WorkInput {
  startsAt: number;
  repeat: Repeat;
}
export interface LocalSchedule extends ScheduleInput {
  id: string;
  enabled: boolean;
  timeZone: string;
  nextRunAt: number | null;
  createdAt: number;
  lastRunAt?: number;
  lastTaskId?: string;
  error?: string;
}
export interface AutomationData {
  version: 1;
  tasks: WorkItem[];
  schedules: LocalSchedule[];
}
