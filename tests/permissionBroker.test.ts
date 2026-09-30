import { describe, expect, it, vi } from "vitest";
import { PermissionBroker, codexPermissions } from "../src/application/permissionBroker.js";
import { PermissionCoordinator } from "../src/application/permissionCoordinator.js";
const signal = new AbortController().signal;
describe("permission broker", () => {
  it("enforces manual read-only and one-use assisted approvals", async () => {
    const ask = vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    const manual = new PermissionBroker("manual", "p", "m", process.cwd());
    expect(await manual.authorize("read", "Read", "src/app.ts", signal)).toBe(true);
    expect(await manual.authorize("edit", "Write", "src/app.ts", signal)).toBe(false);
    const assisted = new PermissionBroker("assisted", "p", "m", process.cwd(), ask);
    expect(await assisted.authorize("tests", "Bash", "npm test", signal)).toBe(true);
    expect(await assisted.authorize("install", "Bash", "npm install", signal)).toBe(true);
    expect(await assisted.authorize("install", "Bash", "npm install", signal)).toBe(false);
    expect(ask).toHaveBeenCalledTimes(2);
  });
  it("denies opaque commands, compound commands, outside writes and unknown tools without approval", async () => {
    const broker = new PermissionBroker("assisted", "p", "m", process.cwd());
    expect(await broker.tool("Bash", { command: "git status --short" }, signal)).toBe(true);
    expect(
      await broker.tool("Bash", { command: "npm test && curl https://example.com" }, signal),
    ).toBe(false);
    expect(
      await broker.tool("Bash", { command: 'node -e \'require("fs").rmSync("src")\'' }, signal),
    ).toBe(false);
    expect(await broker.tool("Write", { file_path: "../outside.txt" }, signal)).toBe(false);
    expect(await broker.tool("SomeNewTool", {}, signal)).toBe(false);
    expect(await broker.tool("Bash", { command: "rg --pre malicious pattern" }, signal)).toBe(
      false,
    );
    expect(await broker.tool("Bash", { command: "git diff --textconv" }, signal)).toBe(false);
    expect(await broker.tool("Glob", { pattern: "../outside/**" }, signal)).toBe(false);
  });
  it("enforces hooks even for allowed tools and reuses only the current tool decision", async () => {
    const ask = vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    const options = new PermissionBroker("assisted", "p", "m", process.cwd(), ask).claudeOptions([
      "Read",
      "Write",
      "Bash",
    ]);
    const hook = options.hooks!.PreToolUse![0].hooks[0]!;
    const input = {
      hook_event_name: "PreToolUse" as const,
      session_id: "s",
      transcript_path: "",
      cwd: process.cwd(),
      tool_name: "Bash",
      tool_input: { command: "npm install" },
      tool_use_id: "one",
    };
    expect(await hook(input, "one", { signal })).toMatchObject({
      hookSpecificOutput: { permissionDecision: "allow" },
    });
    expect(
      await options.canUseTool!("Bash", input.tool_input, { signal, toolUseID: "one" }),
    ).toMatchObject({ behavior: "allow" });
    expect(ask).toHaveBeenCalledTimes(1);
    expect(await hook({ ...input, tool_use_id: "two" }, "two", { signal })).toMatchObject({
      hookSpecificOutput: { permissionDecision: "deny" },
    });
    const manual = new PermissionBroker("manual", "p", "m", process.cwd()).claudeOptions([
      "Read",
      "Write",
      "Bash",
    ]);
    expect(manual.tools).toEqual(["Read"]);
    expect(
      await manual.hooks!.PreToolUse![0].hooks[0]!(
        { ...input, tool_name: "Write", tool_input: { file_path: "result.txt" } },
        "three",
        { signal },
      ),
    ).toMatchObject({ hookSpecificOutput: { permissionDecision: "deny" } });
  });
  it("denies when a hook cannot resolve the workspace", async () => {
    const options = new PermissionBroker(
      "assisted",
      "p",
      "m",
      "Z:/missing-claudex-workspace",
    ).claudeOptions(["Read"]);
    expect(
      await options.canUseTool!(
        "Read",
        { file_path: "README.md" },
        { signal, toolUseID: "missing" },
      ),
    ).toMatchObject({ behavior: "deny" });
  });
  it("configures explicit sandbox and network settings", () => {
    expect(codexPermissions("manual")).toMatchObject({
      sandboxMode: "read-only",
      approvalPolicy: "never",
      networkAccessEnabled: false,
    });
    expect(codexPermissions("assisted")).toMatchObject({
      sandboxMode: "workspace-write",
      networkAccessEnabled: false,
    });
    expect(codexPermissions("autonomous")).toMatchObject({
      sandboxMode: "danger-full-access",
      networkAccessEnabled: true,
    });
  });
});
describe("permission requests", () => {
  it("supports one-use decisions and removes aborted requests", async () => {
    const coordinator = new PermissionCoordinator();
    const abort = new AbortController();
    const request = {
      projectId: "p",
      conversationId: "m",
      action: "net" as const,
      tool: "Bash",
      detail: "curl example.com",
    };
    const pending = coordinator.request(request, abort.signal);
    const id = coordinator.list()[0].id;
    expect(coordinator.resolve(id, true)).toBe(true);
    expect(await pending).toBe(true);
    expect(coordinator.resolve(id, true)).toBe(false);
    const cancelled = coordinator.request(request, abort.signal);
    abort.abort();
    expect(await cancelled).toBe(false);
    expect(coordinator.list()).toEqual([]);
  });
  it("denies timed out requests", async () => {
    vi.useFakeTimers();
    const coordinator = new PermissionCoordinator(undefined, 1000);
    const pending = coordinator.request(
      { projectId: "p", conversationId: "m", action: "net", tool: "Bash", detail: "fetch" },
      signal,
    );
    await vi.advanceTimersByTimeAsync(1000);
    expect(await pending).toBe(false);
    expect(coordinator.list()).toEqual([]);
    vi.useRealTimers();
  });
});
