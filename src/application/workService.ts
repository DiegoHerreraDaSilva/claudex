import path from "node:path";
import { randomUUID } from "node:crypto";
import type { ChatService } from "../app/chat.js";
import type { ProjectRegistry } from "../app/projects.js";
import type { MissionSummary } from "../domain/missionSummary.js";
import type {
  WorkInput,
  WorkItem,
  WorkStatus,
  ScheduleInput,
  Repeat,
} from "../domain/automation.js";
import {
  AutomationStore,
  workInputSchema,
  scheduleInputSchema,
} from "../infrastructure/persistence/automationStore.js";
export class WorkError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}
export function nextOccurrence(start: number, repeat: Repeat, now: number): number | null {
  if (repeat === "once") return null;
  const days = repeat === "daily" ? 1 : 7;
  const date = new Date(start);
  const jumps = Math.max(0, Math.floor((now - start) / (days * 86_400_000)));
  date.setDate(date.getDate() + jumps * days);
  while (date.getTime() <= now) date.setDate(date.getDate() + days);
  return date.getTime();
}
function statusOf(summary: MissionSummary | undefined, fallback: WorkStatus): WorkStatus {
  if (!summary) return fallback;
  if (summary.status === "cancelled") return "cancelled";
  if (summary.status === "failed" || summary.verification.some((run) => run.status === "failed"))
    return "attention";
  if (["applied", "analysed"].includes(summary.status)) return "done";
  if (summary.status === "ready") return "review";
  return fallback;
}
export class WorkService {
  readonly store: AutomationStore;
  private readonly running = new Map<string, Promise<void>>();
  private timer?: ReturnType<typeof setInterval>;
  private ticking = false;
  private initialized?: Promise<void>;
  private stopped = false;
  private fault?: string;
  constructor(
    private readonly chat: ChatService,
    private readonly registry: ProjectRegistry,
    dataDir: string,
    private readonly changed: () => void = () => {},
    private readonly ready: () => boolean = () => true,
    private readonly now: () => number = Date.now,
  ) {
    this.store = new AutomationStore(path.join(dataDir, "automation.json"));
  }
  initialize(): Promise<void> {
    return (this.initialized ??= this.store.change(async (data) => {
      for (const task of data.tasks.filter((task) => task.status === "running")) {
        const summary = task.conversationId
          ? await this.chat.missionSummary(task.conversationId)
          : undefined;
        task.status = statusOf(summary, "attention");
        task.error = task.status === "attention" ? "INTERRUPTED" : undefined;
        task.updatedAt = this.now();
      }
    }));
  }
  async overview() {
    await this.initialize();
    const data = await this.store.read();
    const linked = new Set(data.tasks.map((task) => task.conversationId).filter(Boolean));
    const tasks: (WorkItem & { projectName: string; owned: boolean; steps: string[] })[] = [];
    for (const task of data.tasks) {
      const project = this.registry.get(task.projectId);
      const summary = task.conversationId
        ? await this.chat.missionSummary(task.conversationId)
        : undefined;
      tasks.push({
        ...task,
        status:
          task.conversationId && this.chat.isRunning(task.conversationId)
            ? "running"
            : statusOf(summary, task.status),
        projectName: project?.name ?? "",
        owned: true,
        steps: summary?.tasks ?? [],
        error: !project ? "PROJECT_MISSING" : task.error,
      });
    }
    for (const project of this.registry.list())
      for (const conversation of project.conversations) {
        if (
          conversation.workItemId ||
          linked.has(conversation.id) ||
          (!conversation.messages.length && !conversation.validationRequired)
        )
          continue;
        const summary = await this.chat.missionSummary(conversation.id);
        tasks.push({
          id: `mission:${conversation.id}`,
          projectId: project.id,
          projectName: project.name,
          title: conversation.name,
          instructions:
            conversation.messages.find((message) => message.role === "user")?.text ?? "",
          mode: conversation.autonomy ?? "autonomous",
          status: this.chat.isRunning(conversation.id) ? "running" : statusOf(summary, "todo"),
          createdAt: conversation.createdAt,
          updatedAt: summary?.updatedAt ?? conversation.createdAt,
          conversationId: conversation.id,
          owned: false,
          steps: summary?.tasks ?? [],
        });
      }
    return {
      tasks: tasks.sort((a, b) => b.updatedAt - a.updatedAt),
      schedules: data.schedules.map((schedule) => ({
        ...schedule,
        projectName: this.registry.get(schedule.projectId)?.name ?? "",
        waiting:
          schedule.enabled && !!schedule.nextRunAt && schedule.nextRunAt <= this.now()
            ? !this.ready()
              ? "ASSISTANT_REQUIRED"
              : this.chat.projectBusy(schedule.projectId)
                ? "BUSY"
                : null
            : null,
      })),
      schedulerError: this.fault ?? null,
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    };
  }
  private project(id: string) {
    const project = this.registry.get(id);
    if (!project) throw new WorkError("PROJECT_MISSING", "Project not found", 404);
    return project;
  }
  async create(input: WorkInput, scheduleId?: string): Promise<WorkItem> {
    await this.initialize();
    input = workInputSchema.parse(input);
    this.project(input.projectId);
    const task: WorkItem = {
      ...input,
      id: randomUUID(),
      status: "todo",
      createdAt: this.now(),
      updatedAt: this.now(),
      ...(scheduleId ? { scheduleId } : {}),
    };
    await this.store.change((data) => {
      if (data.tasks.length >= 1000) throw new WorkError("LIMIT", "Task limit reached");
      data.tasks.push(task);
    });
    this.changed();
    return task;
  }
  async edit(id: string, input: WorkInput) {
    await this.initialize();
    input = workInputSchema.parse(input);
    this.project(input.projectId);
    const task = await this.store.change((data) => {
      const task = data.tasks.find((task) => task.id === id);
      if (!task) throw new WorkError("NOT_FOUND", "Task not found", 404);
      if (task.status === "running" || task.conversationId)
        throw new WorkError("LOCKED", "Executed tasks cannot be edited; create a copy", 409);
      Object.assign(task, input, { updatedAt: this.now() });
      return task;
    });
    this.changed();
    return task;
  }
  async remove(id: string) {
    await this.initialize();
    await this.store.change((data) => {
      const task = data.tasks.find((task) => task.id === id);
      if (!task) throw new WorkError("NOT_FOUND", "Task not found", 404);
      if (
        task.status === "running" ||
        (task.conversationId && this.chat.isRunning(task.conversationId))
      )
        throw new WorkError("BUSY", "Task is running", 409);
      data.tasks = data.tasks.filter((task) => task.id !== id);
    });
    this.changed();
  }
  async start(id: string) {
    await this.initialize();
    if (!this.ready())
      throw new WorkError("ASSISTANT_REQUIRED", "Connect Claude before running tasks", 503);
    const existing = (await this.store.read()).tasks.find((task) => task.id === id);
    if (!existing) throw new WorkError("NOT_FOUND", "Task not found", 404);
    const claimed = await this.chat.withProjectOperation(existing.projectId, async () =>
      this.store.change(async (data) => {
        const task = data.tasks.find((task) => task.id === id)!;
        if (!task || task.status === "running" || this.running.has(id))
          throw new WorkError("BUSY", "Task is running", 409);
        const conversation = await this.registry.createConversation(task.projectId, task.title);
        if (!conversation) throw new WorkError("PROJECT_MISSING", "Project not found", 404);
        await this.registry.updateConversation(task.projectId, conversation.id, {
          autonomy: task.mode,
          workItemId: task.id,
        });
        await this.registry.flush();
        Object.assign(task, {
          conversationId: conversation.id,
          status: "running",
          updatedAt: this.now(),
          error: undefined,
        });
        return task;
      }),
    );
    const job = this.chat
      .send(claimed.projectId, claimed.conversationId!, claimed.instructions)
      .then(async () => {
        const summary = await this.chat.missionSummary(claimed.conversationId!);
        await this.store.change((data) => {
          const task = data.tasks.find((task) => task.id === id);
          if (task)
            Object.assign(task, {
              status: statusOf(summary, "attention"),
              updatedAt: this.now(),
              error: summary?.status === "failed" ? "MISSION_FAILED" : undefined,
            });
        });
      })
      .catch(async (error) => {
        await this.store.change((data) => {
          const task = data.tasks.find((task) => task.id === id);
          if (task)
            Object.assign(task, {
              status: "attention",
              updatedAt: this.now(),
              error: error instanceof WorkError ? error.code : "MISSION_FAILED",
            });
        });
      })
      .finally(() => {
        this.running.delete(id);
        this.changed();
      });
    this.running.set(id, job);
    void job.catch(() => {
      this.fault = "STORAGE_ERROR";
      this.changed();
    });
    this.changed();
    return claimed;
  }
  async stop(id: string) {
    const task = (await this.store.read()).tasks.find((task) => task.id === id);
    if (!task?.conversationId) throw new WorkError("NOT_FOUND", "Running task not found", 404);
    this.chat.stop(task.projectId, task.conversationId);
    this.changed();
  }
  async saveSchedule(input: ScheduleInput, id?: string) {
    await this.initialize();
    input = scheduleInputSchema.parse(input);
    this.project(input.projectId);
    if (input.startsAt <= this.now() || input.startsAt > this.now() + 366 * 86_400_000)
      throw new WorkError("FUTURE_TIME", "Choose a future time within one year");
    const result = await this.store.change((data) => {
      const schedule = id ? data.schedules.find((schedule) => schedule.id === id) : undefined;
      if (id && !schedule) throw new WorkError("NOT_FOUND", "Schedule not found", 404);
      if (schedule) {
        Object.assign(schedule, input, {
          nextRunAt: input.startsAt,
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          error: undefined,
        });
        return schedule;
      }
      if (data.schedules.length >= 100) throw new WorkError("LIMIT", "Schedule limit reached");
      const created = {
        ...input,
        id: randomUUID(),
        enabled: true,
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        nextRunAt: input.startsAt,
        createdAt: this.now(),
      };
      data.schedules.push(created);
      return created;
    });
    this.changed();
    return result;
  }
  async toggleSchedule(id: string, enabled: boolean) {
    await this.initialize();
    const result = await this.store.change((data) => {
      const schedule = data.schedules.find((schedule) => schedule.id === id);
      if (!schedule) throw new WorkError("NOT_FOUND", "Schedule not found", 404);
      if (enabled) {
        this.project(schedule.projectId);
        if (schedule.timeZone !== Intl.DateTimeFormat().resolvedOptions().timeZone)
          throw new WorkError(
            "TIMEZONE_CHANGED",
            "Review the schedule after changing time zone",
            409,
          );
        if (!schedule.nextRunAt)
          throw new WorkError("FUTURE_TIME", "Edit completed schedule before enabling", 409);
      }
      schedule.enabled = enabled;
      return schedule;
    });
    this.changed();
    return result;
  }
  async removeSchedule(id: string) {
    await this.initialize();
    await this.store.change((data) => {
      if (!data.schedules.some((schedule) => schedule.id === id))
        throw new WorkError("NOT_FOUND", "Schedule not found", 404);
      data.schedules = data.schedules.filter((schedule) => schedule.id !== id);
    });
    this.changed();
  }
  async tick() {
    if (this.ticking || this.stopped) return;
    this.ticking = true;
    try {
      await this.initialize();
      const due = (await this.store.read()).schedules.filter(
        (schedule) =>
          schedule.enabled && schedule.nextRunAt !== null && schedule.nextRunAt <= this.now(),
      );
      for (const schedule of due) {
        if (this.stopped) break;
        if (
          !this.registry.get(schedule.projectId) ||
          schedule.timeZone !== Intl.DateTimeFormat().resolvedOptions().timeZone
        ) {
          await this.store.change((data) => {
            const entry = data.schedules.find((item) => item.id === schedule.id);
            if (entry)
              Object.assign(entry, {
                enabled: false,
                error: !this.registry.get(schedule.projectId)
                  ? "PROJECT_MISSING"
                  : "TIMEZONE_CHANGED",
              });
          });
          this.changed();
          continue;
        }
        if (!this.ready() || this.chat.projectBusy(schedule.projectId)) continue;
        const claimed = await this.store.change((data) => {
          const entry = data.schedules.find((item) => item.id === schedule.id);
          if (!entry?.enabled || entry.nextRunAt !== schedule.nextRunAt) return false;
          Object.assign(entry, {
            lastRunAt: this.now(),
            nextRunAt: nextOccurrence(entry.startsAt, entry.repeat, this.now()),
            error: undefined,
          });
          if (entry.repeat === "once") entry.enabled = false;
          return true;
        });
        if (!claimed) continue;
        try {
          const task = await this.create(schedule, schedule.id);
          await this.store.change((data) => {
            const entry = data.schedules.find((item) => item.id === schedule.id);
            if (entry) entry.lastTaskId = task.id;
          });
          await this.start(task.id);
        } catch (error) {
          await this.store.change((data) => {
            const entry = data.schedules.find((item) => item.id === schedule.id);
            if (entry) entry.error = error instanceof WorkError ? error.code : "MISSION_FAILED";
          });
        }
        this.changed();
      }
      this.fault = undefined;
    } catch {
      this.fault = "STORAGE_ERROR";
      this.changed();
    } finally {
      this.ticking = false;
    }
  }
  async startScheduler() {
    await this.initialize();
    this.stopped = false;
    this.timer = setInterval(() => {
      void this.tick();
    }, 15_000);
    this.timer.unref();
    void this.tick();
  }
  stopScheduler() {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
  }
  async idle() {
    await Promise.allSettled([...this.running.values()]);
  }
}
