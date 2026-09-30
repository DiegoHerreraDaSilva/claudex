import { describe, it, expect, afterEach } from "vitest";
import { mkdtemp, rm, appendFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { EventStore } from "../src/infrastructure/persistence/eventStore.ts";

const dirs: string[] = [];

async function makeDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "claudex-events-"));
  dirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("EventStore", () => {
  it("appends and reads events in order", async () => {
    const store = new EventStore(await makeDir());
    await store.append("m1", { type: "mission:started", level: "info", message: "go" });
    await store.append("m1", { type: "mission:completed", level: "success", message: "done" });

    const events = await store.read("m1");
    expect(events).toHaveLength(2);
    expect(events[0]?.type).toBe("mission:started");
    expect(events[1]?.type).toBe("mission:completed");
    expect(events[0]?.missionId).toBe("m1");
    expect(events[0]?.id).toBeTruthy();
  });

  it("keeps missions isolated", async () => {
    const store = new EventStore(await makeDir());
    await store.append("a", { type: "mission:started", level: "info", message: "a" });
    await store.append("b", { type: "mission:started", level: "info", message: "b" });
    expect((await store.read("a")).map((e) => e.message)).toEqual(["a"]);
    expect((await store.read("b")).map((e) => e.message)).toEqual(["b"]);
    expect((await store.listMissions()).sort()).toEqual(["a", "b"]);
  });

  it("skips a corrupt line without failing", async () => {
    const dir = await makeDir();
    const store = new EventStore(dir);
    await store.append("m1", { type: "mission:started", level: "info", message: "ok" });
    await appendFile(path.join(dir, "m1", "events.jsonl"), "{not json\n", "utf8");
    await store.append("m1", { type: "mission:completed", level: "success", message: "end" });

    const events = await store.read("m1");
    expect(events.map((e) => e.type)).toEqual(["mission:started", "mission:completed"]);
  });

  it("returns an empty list for an unknown mission", async () => {
    const store = new EventStore(await makeDir());
    expect(await store.read("nope")).toEqual([]);
  });
});
