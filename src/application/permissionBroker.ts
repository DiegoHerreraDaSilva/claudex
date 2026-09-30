import path from "node:path";
import { realpath } from "node:fs/promises";
import type { Options } from "@anthropic-ai/claude-agent-sdk";
import type { ThreadOptions } from "@openai/codex-sdk";
import type { AutonomyMode } from "../domain/mission.js";
import type { MissionEventInput } from "../domain/event.js";
import type { PermissionInput } from "./permissionCoordinator.js";
export type PermissionAction =
  "read" | "edit" | "tests" | "git" | "install" | "net" | "delete" | "execute";
export const PERMISSIONS: Record<AutonomyMode, readonly PermissionAction[]> = {
  manual: ["read"],
  assisted: ["read", "edit", "tests", "git"],
  autonomous: ["read", "edit", "tests", "git", "install", "net", "delete", "execute"],
};
export function isAutonomy(value: unknown): value is AutonomyMode {
  return value === "manual" || value === "assisted" || value === "autonomous";
}
export function codexPermissions(
  mode: AutonomyMode,
): Pick<
  ThreadOptions,
  "sandboxMode" | "approvalPolicy" | "networkAccessEnabled" | "webSearchMode"
> {
  return {
    sandboxMode:
      mode === "manual"
        ? "read-only"
        : mode === "assisted"
          ? "workspace-write"
          : "danger-full-access",
    approvalPolicy: "never",
    networkAccessEnabled: mode === "autonomous",
    webSearchMode: mode === "autonomous" ? "live" : "disabled",
  };
}
export function commandAction(command: string): PermissionAction {
  if (
    /[;&|<>`\r\n]|\$|%|\(|\)/.test(command) ||
    /(?:^|\s)(?:-[cCeE]|--eval|--exec)(?:\s|$)/.test(command)
  )
    return "execute";
  if (/^(?:npm|pnpm|yarn)\s+(?:install|add|update|upgrade|ci|exec|dlx)\b|^npx\b/i.test(command))
    return "install";
  if (/^(?:rm|rmdir|del|erase|remove-item|unlink)\b/i.test(command)) return "delete";
  if (
    /^(?:curl|wget|invoke-webrequest|invoke-restmethod)\b|^git\s+(?:fetch|pull|push|clone)\b/i.test(
      command,
    )
  )
    return "net";
  if (
    /--(?:ext-diff|textconv|output|exec|config|pre|hostname-bin)|(?:^|\s)-c(?:\s|$)/.test(command)
  )
    return "execute";
  if (
    /^git\s+diff\b/.test(command) &&
    !(command.includes("--no-ext-diff") && command.includes("--no-textconv"))
  )
    return "execute";
  if (/^git\s+(?:status|diff|log|show|rev-parse|ls-files)(?:\s+[\w./:@= -]+)?$/.test(command))
    return "read";
  if (
    /^(?:pwd|ls|dir|rg|cat|head|tail)(?:\s+[\w./:@= -]+)?$/.test(command) &&
    !command.includes("..") &&
    !/(?:^|\s)(?:\/|[A-Za-z]:)/.test(command)
  )
    return "read";
  if (
    /^(?:npm|pnpm|yarn)\s+(?:run\s+)?(?:test|build|lint|typecheck)(?:\s+--?[\w=-]+)*$/.test(command)
  )
    return "tests";
  return "execute";
}
export type ClaudePermissionOptions = Pick<
  Options,
  | "permissionMode"
  | "allowDangerouslySkipPermissions"
  | "tools"
  | "allowedTools"
  | "disallowedTools"
  | "canUseTool"
  | "hooks"
  | "settingSources"
>;
export class PermissionBroker {
  constructor(
    readonly mode: AutonomyMode,
    private readonly projectId: string,
    private readonly conversationId: string,
    private readonly root: string,
    private readonly ask?: (input: PermissionInput, signal: AbortSignal) => Promise<boolean>,
    private readonly record?: (event: MissionEventInput) => Promise<void>,
  ) {}
  async authorize(
    action: PermissionAction,
    tool: string,
    detail: string,
    signal: AbortSignal,
    outside = false,
  ): Promise<boolean> {
    if (signal.aborted) return false;
    if (this.mode === "autonomous" || (!outside && PERMISSIONS[this.mode].includes(action)))
      return true;
    const request = {
      projectId: this.projectId,
      conversationId: this.conversationId,
      action,
      tool,
      detail,
    };
    const canAsk = this.mode === "assisted" && !!this.ask;
    await this.record?.({
      type: "mission:permission",
      level: "warn",
      message: `${canAsk ? "Approval required" : "Blocked"}: ${tool}`,
      payload: { ...request, status: canAsk ? "requested" : "denied", mode: this.mode },
    });
    const approved = canAsk ? await this.ask!(request, signal) : false;
    if (canAsk)
      await this.record?.({
        type: "mission:permission",
        level: approved ? "success" : "warn",
        message: `${approved ? "Approved once" : "Denied"}: ${tool}`,
        payload: { ...request, status: approved ? "approved" : "denied", mode: this.mode },
      });
    return approved && !signal.aborted;
  }
  async tool(name: string, input: Record<string, unknown>, signal: AbortSignal): Promise<boolean> {
    if (this.mode === "autonomous") return !signal.aborted;
    if (name === "Bash")
      return this.authorize(
        commandAction(String(input.command ?? "")),
        name,
        String(input.command ?? ""),
        signal,
      );
    const read = ["Read", "Glob", "Grep"].includes(name);
    const edit = ["Write", "Edit", "NotebookEdit"].includes(name);
    if (read || edit) {
      const file = String(input.file_path ?? input.notebook_path ?? input.path ?? this.root);
      const target = path.resolve(this.root, file);
      const canonicalRoot = await realpath(this.root);
      let existing = target;
      const suffix: string[] = [];
      let canonical: string;
      for (;;) {
        try {
          canonical = path.join(await realpath(existing), ...suffix);
          break;
        } catch (error) {
          if (
            (error as NodeJS.ErrnoException).code !== "ENOENT" ||
            path.dirname(existing) === existing
          )
            throw error;
          suffix.unshift(path.basename(existing));
          existing = path.dirname(existing);
        }
      }
      const relative = path.relative(canonicalRoot, canonical);
      const pattern = name === "Glob" ? String(input.pattern ?? "") : "";
      const patternOutside = pattern.split(/[\\/]/).includes("..") || path.isAbsolute(pattern);
      const outside =
        patternOutside ||
        relative.startsWith("..") ||
        path.isAbsolute(relative) ||
        /(^|[\\/])\.(?:git|claude|codex)([\\/]|$)/.test(relative);
      return this.authorize(read ? "read" : "edit", name, file, signal, outside);
    }
    return this.authorize(
      ["WebFetch", "WebSearch"].includes(name) ? "net" : "execute",
      name,
      JSON.stringify(input).slice(0, 8000),
      signal,
      true,
    );
  }
  private async checkTool(
    name: string,
    input: Record<string, unknown>,
    signal: AbortSignal,
  ): Promise<boolean> {
    try {
      return await this.tool(name, input, signal);
    } catch {
      await this.record?.({
        type: "mission:permission",
        level: "warn",
        message: `Blocked: ${name}`,
        payload: {
          projectId: this.projectId,
          conversationId: this.conversationId,
          tool: name,
          mode: this.mode,
          status: "denied",
          reason: "Permission check failed",
        },
      }).catch(() => undefined);
      return false;
    }
  }
  claudeOptions(available: readonly string[]): ClaudePermissionOptions {
    const tools =
      this.mode === "manual"
        ? available.filter((name) => ["Read", "Glob", "Grep"].includes(name))
        : [...available];
    const decisions = new Map<string, boolean>();
    return {
      permissionMode: this.mode === "autonomous" ? "bypassPermissions" : "default",
      allowDangerouslySkipPermissions: this.mode === "autonomous",
      tools,
      allowedTools:
        this.mode === "autonomous"
          ? tools
          : tools.filter((name) => ["Read", "Glob", "Grep"].includes(name)),
      disallowedTools:
        this.mode === "manual"
          ? [
              "Bash",
              "Write",
              "Edit",
              "NotebookEdit",
              "WebFetch",
              "WebSearch",
              "Agent",
              "Task",
              "mcp__*",
            ]
          : ["Agent", "Task", "mcp__*"],
      settingSources: [],
      hooks: {
        PreToolUse: [
          {
            timeout: 120,
            hooks: [
              async (input, id, options) => {
                if (input.hook_event_name !== "PreToolUse") return {};
                const allowed = await this.checkTool(
                  input.tool_name,
                  input.tool_input as Record<string, unknown>,
                  options.signal,
                );
                if (decisions.size > 1000) decisions.clear();
                decisions.set(id ?? input.tool_use_id, allowed);
                return {
                  hookSpecificOutput: {
                    hookEventName: "PreToolUse",
                    permissionDecision: allowed ? "allow" : "deny",
                    permissionDecisionReason: `Claudex ${this.mode} policy`,
                  },
                };
              },
            ],
          },
        ],
      },
      canUseTool: async (name, input, options) => {
        const cached = decisions.get(options.toolUseID);
        decisions.delete(options.toolUseID);
        const allowed =
          !options.signal.aborted &&
          (cached ?? (await this.checkTool(name, input, options.signal)));
        return allowed
          ? { behavior: "allow", updatedInput: input }
          : { behavior: "deny", message: `Blocked by Claudex ${this.mode} policy` };
      },
    };
  }
}
