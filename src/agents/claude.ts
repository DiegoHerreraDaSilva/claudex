import { query } from "@anthropic-ai/claude-agent-sdk";
import type { Options, SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import {
  AgentError,
  type AgentRunResult,
  type AgentUsage,
  type ClaudeMessageHandler,
  type ClaudeModel,
} from "./types.js";

export interface RunClaudeAgentOptions {
  permissionPolicy?: Pick<
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
  prompt: string;
  model: ClaudeModel;
  worktreePath: string;
  allowedTools?: string[];
  disallowedTools?: string[];
  tools?: string[];
  maxTurns?: number;
  onMessage?: ClaudeMessageHandler;
  resumeSessionId?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
  outputSchema?: Record<string, unknown>;
}

export const CLAUDE_TOOLS = {
  planner: ["Read", "Glob", "Grep"],
  implementer: ["Read", "Write", "Edit", "Bash", "Glob", "Grep"],
  reviewer: ["Read", "Glob", "Grep"],
} as const;

export interface ClaudeUsage {
  subscriptionType: string | null;
  fiveHour: { utilization: number | null; resetsAt: string | null } | null;
  sevenDay: { utilization: number | null; resetsAt: string | null } | null;
}

interface UsageWindow {
  utilization?: number | null;
  resets_at?: string | null;
}

/**
 * Best-effort read of the Claude plan usage via the SDK's experimental usage control.
 * Returns null when unavailable (older CLI, no plan, API key instead of subscription).
 */
export async function getClaudeUsage(cwd: string, timeoutMs = 60_000): Promise<ClaudeUsage | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const stream = query({
    prompt: "ok",
    options: {
      model: "haiku",
      cwd,
      maxTurns: 1,
      allowedTools: [],
      abortController: controller,
    },
  });
  try {
    for await (const message of stream) {
      if (message.type === "system" && message.subtype === "init") {
        const probe = stream as unknown as {
          usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET?: (opts?: {
            skipBehaviors?: boolean;
          }) => Promise<unknown>;
        };
        if (typeof probe.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET !== "function") {
          return null;
        }
        const raw = (await probe.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET({
          skipBehaviors: true,
        })) as {
          subscription_type?: string | null;
          rate_limits?: { five_hour?: UsageWindow | null; seven_day?: UsageWindow | null };
        };
        const norm = (w: UsageWindow | null | undefined) =>
          w ? { utilization: w.utilization ?? null, resetsAt: w.resets_at ?? null } : null;
        return {
          subscriptionType: raw.subscription_type ?? null,
          fiveHour: norm(raw.rate_limits?.five_hour),
          sevenDay: norm(raw.rate_limits?.seven_day),
        };
      }
    }
    return null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    try {
      stream.close();
    } catch {
      /* ignore */
    }
  }
}

export async function runClaudeAgent(
  options: RunClaudeAgentOptions,
): Promise<AgentRunResult & { sessionId: string }> {
  const started = Date.now();
  const controller = new AbortController();
  if (options.signal) {
    if (options.signal.aborted) controller.abort();
    else options.signal.addEventListener("abort", () => controller.abort(), { once: true });
  }
  const timer =
    options.timeoutMs && options.timeoutMs > 0
      ? setTimeout(() => controller.abort(), options.timeoutMs)
      : undefined;

  let sessionId = "";
  let resultText = "";
  let usage: AgentUsage = { inputTokens: 0, outputTokens: 0 };
  let failure: string | null = null;

  try {
    const stream = query({
      prompt: options.prompt,
      options: {
        model: options.model,
        cwd: options.worktreePath,
        maxTurns: options.maxTurns,
        abortController: controller,
        permissionMode: "bypassPermissions",
        allowDangerouslySkipPermissions: true,
        ...(options.allowedTools ? { allowedTools: options.allowedTools } : {}),
        ...(options.tools ? { tools: options.tools } : {}),
        ...(options.disallowedTools ? { disallowedTools: options.disallowedTools } : {}),
        ...options.permissionPolicy,
        ...(options.resumeSessionId ? { resume: options.resumeSessionId } : {}),
        ...(options.outputSchema
          ? { outputFormat: { type: "json_schema" as const, schema: options.outputSchema } }
          : {}),
      },
    });

    for await (const message of stream) {
      options.onMessage?.(message);
      const id = (message as { session_id?: string }).session_id;
      if (id) sessionId = id;
      if (message.type === "result") {
        if (message.subtype === "success") {
          resultText =
            options.outputSchema && message.structured_output !== undefined
              ? JSON.stringify(message.structured_output)
              : message.result;
          usage = readUsage(message);
        } else {
          failure = message.subtype;
        }
      }
    }
  } catch (err) {
    throw new AgentError("claude", `Claude Code execution failed: ${errorMessage(err)}`, {
      sessionId: sessionId || undefined,
      cause: err,
    });
  } finally {
    if (timer) clearTimeout(timer);
  }

  if (failure) {
    throw new AgentError("claude", `Claude Code returned an error result: ${failure}`, {
      sessionId: sessionId || undefined,
    });
  }

  return {
    result: resultText,
    sessionId,
    durationMs: Date.now() - started,
    usage,
  };
}

function readUsage(message: SDKMessage): AgentUsage {
  const usage = (message as { usage?: Record<string, unknown> }).usage;
  if (!usage) return { inputTokens: 0, outputTokens: 0 };
  const input = Number(usage["input_tokens"] ?? 0);
  const output = Number(usage["output_tokens"] ?? 0);
  return {
    inputTokens: Number.isFinite(input) ? input : 0,
    outputTokens: Number.isFinite(output) ? output : 0,
  };
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
