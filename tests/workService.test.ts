import { describe, expect, it } from "vitest";
import { nextOccurrence } from "../src/application/workService.js";
describe("local schedule recurrence", () => {
  it("returns no next execution for one-time jobs", () => {
    expect(nextOccurrence(Date.now(), "once", Date.now())).toBeNull();
  });
  it("advances beyond now without replaying missed daily occurrences", () => {
    const start = new Date(2026, 0, 2, 9, 30).getTime();
    const now = new Date(2026, 0, 8, 10).getTime();
    const next = new Date(nextOccurrence(start, "daily", now)!);
    expect(next.getDate()).toBe(9);
    expect(next.getHours()).toBe(9);
    expect(next.getMinutes()).toBe(30);
  });
  it("keeps the chosen weekday and local time for weekly jobs", () => {
    const start = new Date(2026, 0, 2, 9, 30).getTime();
    const next = new Date(nextOccurrence(start, "weekly", new Date(2026, 0, 20).getTime())!);
    expect(next.getDay()).toBe(new Date(start).getDay());
    expect(next.getDate()).toBe(23);
  });
});
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, vi } from "vitest";
import { WorkService } from "../src/application/workService.js";
import { AutomationStore } from "../src/infrastructure/persistence/automationStore.js";
import { ProjectRegistry } from "../src/app/projects.js";
import type { ChatService } from "../src/app/chat.js";
import type { MissionSummary } from "../src/domain/missionSummary.js";
const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(
    dirs
      .splice(0)
      .map((dir) => rm(dir, { recursive: true, force: true, maxRetries: 4, retryDelay: 100 })),
  );
});
async function fixture() {
  const dir = await mkdtemp(path.join(tmpdir(), "claudex-work-"));
  dirs.push(dir);
  const registry = new ProjectRegistry(dir);
  await registry.load();
  const project = await registry.create("Fixture", dir);
  await registry.flush();
  let clock = new Date(2026, 0, 2, 8).getTime();
  let ready = true;
  let workspaceBusy = false;
  const summaries = new Map<string, MissionSummary>();
  const active = new Set<string>();
  const locks = new Set<string>();
  const completions = new Map<string, (status?: string) => void>();
  const send = vi.fn(async (_projectId: string, id: string) => {
    active.add(id);
    await new Promise<void>((resolve) =>
      completions.set(id, (status = "ready") => {
        active.delete(id);
        summaries.set(id, {
          id,
          status,
          verification: [],
          tasks: ["Plan", "Build"],
        } as unknown as MissionSummary);
        resolve();
      }),
    );
  });
  const chat = {
    send,
    projectBusy: (id: string) =>
      workspaceBusy || locks.has(id) || project.conversations.some((item) => active.has(item.id)),
    isRunning: (id: string) => active.has(id),
    missionSummary: async (id: string) => summaries.get(id),
    withProjectOperation: async (id: string, fn: () => unknown) => {
      if (workspaceBusy || locks.has(id) || active.size) throw new Error("project is busy");
      locks.add(id);
      try {
        return await fn();
      } finally {
        locks.delete(id);
      }
    },
    stop: (_projectId: string, id: string) => completions.get(id)?.("cancelled"),
  } as unknown as ChatService;
  const service = new WorkService(
    chat,
    registry,
    dir,
    () => {},
    () => ready,
    () => clock,
  );
  const input = {
    projectId: project.id,
    title: "A friendly task",
    instructions: "Improve the app",
    mode: "assisted" as const,
  };
  return {
    dir,
    registry,
    project,
    chat,
    service,
    input,
    send,
    summaries,
    completions,
    advance: (ms: number) => {
      clock += ms;
    },
    now: () => clock,
    ready: (value: boolean) => {
      ready = value;
    },
    busy: (value: boolean) => {
      workspaceBusy = value;
    },
  };
}
describe("persistent work items", () => {
  it("creates, edits, reloads and deletes tasks, validating projects and input", async () => {
    const f = await fixture();
    const item = await f.service.create(f.input);
    await f.service.edit(item.id, { ...f.input, title: "Edited" });
    const restarted = new WorkService(f.chat, f.registry, f.dir);
    expect((await restarted.overview()).tasks[0].title).toBe("Edited");
    await expect(f.service.create({ ...f.input, projectId: "missing" })).rejects.toMatchObject({
      code: "PROJECT_MISSING",
    });
    await expect(f.service.create({ ...f.input, instructions: "" })).rejects.toThrow();
    await f.service.remove(item.id);
    expect((await f.service.overview()).tasks).toEqual([]);
  });
  it("executes a task through a fresh assisted conversation and records its result", async () => {
    const f = await fixture();
    const item = await f.service.create(f.input);
    const started = await f.service.start(item.id);
    expect(f.send).toHaveBeenCalledWith(f.project.id, started.conversationId, f.input.instructions);
    expect(f.registry.getConversation(f.project.id, started.conversationId!)?.autonomy).toBe(
      "assisted",
    );
    await expect(f.service.edit(item.id, f.input)).rejects.toMatchObject({ code: "LOCKED" });
    await expect(f.service.remove(item.id)).rejects.toMatchObject({ code: "BUSY" });
    f.completions.get(started.conversationId!)!();
    await f.service.idle();
    expect((await f.service.overview()).tasks).toMatchObject([
      { status: "review", steps: ["Plan", "Build"] },
    ]);
    const retry = await f.service.start(item.id);
    expect(retry.conversationId).not.toBe(started.conversationId);
    await f.service.stop(item.id);
    await f.service.idle();
    expect((await f.service.overview()).tasks[0].status).toBe("cancelled");
    await f.service.remove(item.id);
    expect((await f.service.overview()).tasks).toEqual([]);
  });
  it("does not execute without connected account or while the project is occupied", async () => {
    const f = await fixture();
    const item = await f.service.create(f.input);
    f.ready(false);
    await expect(f.service.start(item.id)).rejects.toMatchObject({ code: "ASSISTANT_REQUIRED" });
    f.ready(true);
    f.busy(true);
    await expect(f.service.start(item.id)).rejects.toThrow("busy");
    expect(f.send).not.toHaveBeenCalled();
  });
  it("does not duplicate an execution under concurrent requests", async () => {
    const f = await fixture();
    const item = await f.service.create(f.input);
    const results = await Promise.allSettled([f.service.start(item.id), f.service.start(item.id)]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(f.send).toHaveBeenCalledTimes(1);
    await f.service.stop(item.id);
    await f.service.idle();
  });
  it("marks interrupted work for attention on restart without relaunching it", async () => {
    const f = await fixture();
    const item = await f.service.create(f.input);
    await f.service.store.change((data) => {
      const task = data.tasks[0];
      task.status = "running";
      task.conversationId = "abandoned";
    });
    const restarted = new WorkService(f.chat, f.registry, f.dir);
    expect((await restarted.overview()).tasks[0]).toMatchObject({
      id: item.id,
      status: "attention",
      error: "INTERRUPTED",
    });
    expect(f.send).not.toHaveBeenCalled();
  });
  it("preserves corrupt data instead of resetting or overwriting it", async () => {
    const f = await fixture();
    const file = path.join(f.dir, "invalid.json");
    await writeFile(file, "broken");
    const store = new AutomationStore(file);
    await expect(store.read()).rejects.toThrow("preserved");
    await expect(
      store.change((data) => {
        data.tasks = [];
      }),
    ).rejects.toThrow();
    expect(await readFile(file, "utf8")).toBe("broken");
  });
});
describe("local schedule execution", () => {
  it("claims a one-time occurrence before execution and does not duplicate concurrent ticks", async () => {
    const f = await fixture();
    const schedule = await f.service.saveSchedule({
      ...f.input,
      startsAt: f.now() + 60_000,
      repeat: "once",
    });
    f.advance(60_001);
    await Promise.all([f.service.tick(), f.service.tick()]);
    const data = await f.service.overview();
    expect(data.schedules[0]).toMatchObject({
      enabled: false,
      nextRunAt: null,
      lastTaskId: data.tasks[0].id,
    });
    expect(f.send).toHaveBeenCalledTimes(1);
    expect(data.tasks[0].scheduleId).toBe(schedule.id);
    await f.service.stop(data.tasks[0].id);
    await f.service.idle();
    await f.service.tick();
    expect(f.send).toHaveBeenCalledTimes(1);
  });
  it("waits for the account and project without consuming the occurrence", async () => {
    const f = await fixture();
    await f.service.saveSchedule({ ...f.input, startsAt: f.now() + 1000, repeat: "daily" });
    f.advance(2000);
    f.ready(false);
    await f.service.tick();
    expect((await f.service.overview()).schedules[0].waiting).toBe("ASSISTANT_REQUIRED");
    f.ready(true);
    f.busy(true);
    await f.service.tick();
    expect((await f.service.overview()).schedules[0].waiting).toBe("BUSY");
    expect(f.send).not.toHaveBeenCalled();
    f.busy(false);
    await f.service.tick();
    const task = (await f.service.overview()).tasks[0];
    await f.service.stop(task.id);
    await f.service.idle();
  });
  it("runs only one missed occurrence and advances the recurring schedule into the future", async () => {
    const f = await fixture();
    await f.service.saveSchedule({ ...f.input, startsAt: f.now() + 1000, repeat: "daily" });
    f.advance(9 * 86_400_000);
    await f.service.tick();
    const data = await f.service.overview();
    expect(data.schedules[0].nextRunAt).toBeGreaterThan(f.now());
    expect(data.tasks).toHaveLength(1);
    await f.service.stop(data.tasks[0].id);
    await f.service.idle();
    await f.service.tick();
    expect(f.send).toHaveBeenCalledTimes(1);
  });
  it("supports editing, pause/resume, deletion and rejects times in the past", async () => {
    const f = await fixture();
    await expect(
      f.service.saveSchedule({ ...f.input, startsAt: f.now() - 1, repeat: "once" }),
    ).rejects.toMatchObject({ code: "FUTURE_TIME" });
    const schedule = await f.service.saveSchedule({
      ...f.input,
      startsAt: f.now() + 1000,
      repeat: "weekly",
    });
    await f.service.toggleSchedule(schedule.id, false);
    f.advance(2000);
    await f.service.tick();
    expect(f.send).not.toHaveBeenCalled();
    await f.service.saveSchedule(
      { ...f.input, title: "Updated", startsAt: f.now() + 1000, repeat: "weekly" },
      schedule.id,
    );
    await f.service.toggleSchedule(schedule.id, true);
    expect((await f.service.overview()).schedules[0].title).toBe("Updated");
    await f.service.removeSchedule(schedule.id);
    expect((await f.service.overview()).schedules).toEqual([]);
  });
  it("disables orphaned schedules and schedules created in a different time zone", async () => {
    const f = await fixture();
    const schedule = await f.service.saveSchedule({
      ...f.input,
      startsAt: f.now() + 1000,
      repeat: "once",
    });
    await f.service.store.change((data) => {
      data.schedules[0].timeZone = "Other/Zone";
    });
    f.advance(2000);
    await f.service.tick();
    expect((await f.service.overview()).schedules[0]).toMatchObject({
      enabled: false,
      error: "TIMEZONE_CHANGED",
    });
    await expect(f.service.toggleSchedule(schedule.id, true)).rejects.toMatchObject({
      code: "TIMEZONE_CHANGED",
    });
    expect(f.send).not.toHaveBeenCalled();
  });
});
