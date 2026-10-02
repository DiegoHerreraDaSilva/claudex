import { expect, it, vi } from "vitest";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { AgentTeam } from "../src/application/agentTeam.js";
import { randomUUID } from "node:crypto";

it("delegates independent work concurrently, exchanges messages and joins all children", async () => {
  const folder = await mkdtemp(path.join(tmpdir(), "claudex-team-"));
  await mkdir(path.join(folder, "a"));
  await mkdir(path.join(folder, "b"));
  const controller = new AbortController();
  const starts: string[] = [];
  let release!: () => void;
  const barrier = new Promise<void>((resolve) => (release = resolve));
  const finish = vi.fn();
  const team = new AgentTeam({
    folder,
    controller,
    root: {
      id: "root",
      agent: { kind: "claude", model: "sonnet", label: "claude:sonnet" },
      task: "build",
      depth: 0,
      scopes: [],
      readOnly: false,
    },
    route: async () => ({ kind: "codex", model: "test", label: "codex:test" }),
    create: (_agent, _task, _scopes) => randomUUID(),
    memory: () => "shared changes",
    activity: () => {},
    finish,
    run: async (member, tools) => {
      if (member.id === "root") {
        const a = (await tools.call("delegate", { text: "frontend", paths: ["a"] })) as {
          id: string;
        };
        const b = (await tools.call("delegate", { text: "backend", paths: ["b"] })) as {
          id: string;
        };
        expect(starts).toHaveLength(2);
        await tools.call("message_team", { text: "Use the existing API", to: b.id });
        await expect(
          tools.call("delegate", { text: "conflict", paths: ["a/file.txt"] }),
        ).rejects.toThrow(/reservad/);
        const c = (await tools.call("delegate", { text: "analysis", readOnly: true })) as {
          id: string;
        };
        await expect(tools.call("delegate", { text: "excess", readOnly: true })).rejects.toThrow(
          /quatro/,
        );
        release();
        await tools.call("wait_agents", { ids: [a.id, b.id, c.id] });
        return "combined result";
      }
      starts.push(member.id);
      await barrier;
      const board = await tools.call("read_team", {});
      expect(JSON.stringify(board)).toContain("Use the existing API");
      return "done";
    },
  });
  try {
    await team.run();
    expect(finish).toHaveBeenCalledTimes(4);
  } finally {
    await team.close();
    await rm(folder, { recursive: true, force: true });
  }
});
it("allows a collaborator to delegate within its scope and rejects excessive depth and folder escape", async () => {
  const folder = await mkdtemp(path.join(tmpdir(), "claudex-nested-"));
  const controller = new AbortController();
  const agent = { kind: "claude" as const, model: "sonnet", label: "claude:sonnet" };
  const team = new AgentTeam({
    folder,
    controller,
    root: { id: "root", agent, task: "root", depth: 0, scopes: [], readOnly: false },
    route: async () => agent,
    create: () => randomUUID(),
    memory: () => "",
    activity: () => {},
    finish: async () => {},
    run: async (member, tools) => {
      if (member.depth === 0) {
        await expect(
          tools.call("delegate", { text: "escape", paths: ["../escape"] }),
        ).rejects.toThrow(/fora/);
        const child = (await tools.call("delegate", { text: "child", paths: ["src"] })) as {
          id: string;
        };
        await tools.call("wait_agents", { ids: [child.id] });
      } else if (member.depth === 1) {
        await expect(
          tools.call("delegate", { text: "wrong scope", paths: ["docs"] }),
        ).rejects.toThrow(/área/);
        const child = (await tools.call("delegate", {
          text: "nested",
          paths: ["src/component.ts"],
        })) as { id: string };
        await tools.call("wait_agents", { ids: [child.id] });
      } else
        await expect(tools.call("delegate", { text: "too deep", readOnly: true })).rejects.toThrow(
          /Limite/,
        );
      return "done";
    },
  });
  try {
    await team.run();
    expect(team.members.size).toBe(3);
  } finally {
    await team.close();
    await rm(folder, { recursive: true, force: true });
  }
});
it("cancels and joins all collaborators when the shared controller is aborted", async () => {
  const folder = await mkdtemp(path.join(tmpdir(), "claudex-stop-"));
  const controller = new AbortController();
  const agent = { kind: "claude" as const, model: "sonnet", label: "claude:sonnet" };
  const team = new AgentTeam({
    folder,
    controller,
    root: { id: "root", agent, task: "root", depth: 0, scopes: [], readOnly: false },
    route: async () => agent,
    create: () => randomUUID(),
    memory: () => "",
    activity: () => {},
    finish: async () => {},
    run: async (member, tools) => {
      if (member.depth === 0) {
        await tools.call("delegate", { text: "one", paths: ["a"] });
        await tools.call("delegate", { text: "two", paths: ["b"] });
        controller.abort();
        return "stopped";
      }
      await new Promise((_, reject) =>
        controller.signal.addEventListener("abort", () => reject(new Error("cancelled")), {
          once: true,
        }),
      );
      return "unexpected";
    },
  });
  try {
    await expect(team.run()).rejects.toThrow();
    expect([...team.members.values()].every((m) => m.status === "stopped")).toBe(true);
  } finally {
    await team.close();
    await rm(folder, { recursive: true, force: true });
  }
});
