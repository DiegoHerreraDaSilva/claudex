import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { AutomationData } from "../../domain/automation.js";
export const workInputSchema = z.object({
  projectId: z.string().min(1).max(100),
  title: z.string().trim().min(1).max(120),
  instructions: z.string().trim().min(1).max(12_000),
  mode: z.enum(["manual", "assisted", "autonomous"]),
});
export const scheduleInputSchema = workInputSchema.extend({
  startsAt: z.number().int().positive().max(8_640_000_000_000_000),
  repeat: z.enum(["once", "daily", "weekly"]),
});
const time = z.number().int().nonnegative();
const taskSchema = workInputSchema.extend({
  id: z.string().uuid(),
  status: z.enum(["todo", "running", "review", "done", "attention", "cancelled"]),
  createdAt: time,
  updatedAt: time,
  conversationId: z.string().max(100).optional(),
  scheduleId: z.string().uuid().optional(),
  error: z.string().max(2000).optional(),
});
const scheduleSchema = scheduleInputSchema.extend({
  id: z.string().uuid(),
  enabled: z.boolean(),
  timeZone: z.string().min(1).max(100),
  nextRunAt: time.nullable(),
  createdAt: time,
  lastRunAt: time.optional(),
  lastTaskId: z.string().uuid().optional(),
  error: z.string().max(2000).optional(),
});
const schema = z.object({
  version: z.literal(1),
  tasks: z.array(taskSchema).max(1000),
  schedules: z.array(scheduleSchema).max(100),
});
export class AutomationStore {
  private queue: Promise<unknown> = Promise.resolve();
  private data?: AutomationData;
  constructor(private readonly file: string) {}
  private async load(): Promise<AutomationData> {
    if (this.data) return this.data;
    try {
      this.data = schema.parse(JSON.parse(await readFile(this.file, "utf8")));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT")
        throw new Error("Invalid automation data; original file preserved", { cause: error });
      this.data = { version: 1, tasks: [], schedules: [] };
    }
    return this.data;
  }
  async read(): Promise<AutomationData> {
    await this.queue.catch(() => {});
    return structuredClone(await this.load());
  }
  change<T>(action: (data: AutomationData) => T | Promise<T>): Promise<T> {
    const job = this.queue
      .catch(() => {})
      .then(async () => {
        const next = structuredClone(await this.load());
        const result = await action(next);
        schema.parse(next);
        await mkdir(path.dirname(this.file), { recursive: true });
        const temp = `${this.file}.${randomUUID()}.tmp`;
        await writeFile(temp, JSON.stringify(next, null, 2), "utf8");
        await rename(temp, this.file);
        this.data = next;
        return structuredClone(result);
      });
    this.queue = job;
    return job;
  }
}
