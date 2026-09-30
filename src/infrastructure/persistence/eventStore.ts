import { appendFile, mkdir, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { v4 as uuid } from "uuid";
import type { MissionEventInput, TaskEvent } from "../../domain/event.js";

/**
 * Append-only event log per mission. Each mission is stored as a folder with an
 * `events.jsonl` file: one JSON event per line. Writes for the same mission are
 * serialized so lines never interleave; a corrupt trailing line is skipped on read.
 */
export class EventStore {
  private readonly queues = new Map<string, Promise<unknown>>();

  constructor(private readonly baseDir: string) {}

  get root(): string {
    return this.baseDir;
  }

  private dirFor(missionId: string): string {
    return path.join(this.baseDir, missionId);
  }

  private fileFor(missionId: string): string {
    return path.join(this.dirFor(missionId), "events.jsonl");
  }

  async append(missionId: string, event: MissionEventInput): Promise<TaskEvent> {
    const full: TaskEvent = {
      id: uuid(),
      missionId,
      at: event.at ?? Date.now(),
      type: event.type,
      level: event.level,
      message: event.message,
      ...(event.taskId ? { taskId: event.taskId } : {}),
      ...(event.payload ? { payload: event.payload } : {}),
    };
    const previous = this.queues.get(missionId) ?? Promise.resolve();
    const next = previous.then(async () => {
      await mkdir(this.dirFor(missionId), { recursive: true });
      await appendFile(this.fileFor(missionId), `${JSON.stringify(full)}\n`, "utf8");
    });
    this.queues.set(
      missionId,
      next.catch(() => undefined),
    );
    await next;
    return full;
  }

  async read(missionId: string): Promise<TaskEvent[]> {
    let raw: string;
    try {
      raw = await readFile(this.fileFor(missionId), "utf8");
    } catch {
      return [];
    }
    const events: TaskEvent[] = [];
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        events.push(JSON.parse(trimmed) as TaskEvent);
      } catch {
        // skip a corrupt line (e.g. a crash mid-write)
      }
    }
    return events;
  }

  async listMissions(): Promise<string[]> {
    try {
      const entries = await readdir(this.baseDir, { withFileTypes: true });
      return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
    } catch {
      return [];
    }
  }
}
