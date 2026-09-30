import { query } from "@anthropic-ai/claude-agent-sdk";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import {
  AgentError,
  type AgentRunResult,
  type AgentUsage,
  type ClaudeMessageHandler,
  type ClaudeModel,
} from "./types.js";

export interface RunClaudeAgentOptions {
  prompt: string;
  model: ClaudeModel;
  worktreePath: string;
  allowedTools?: string[];
  disallowedTools?: string[];
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
        permissionMode: "acceptEdits",
        ...(options.allowedTools ? { allowedTools: options.allowedTools } : {}),
        ...(options.disallowedTools ? { disallowedTools: options.disallowedTools } : {}),
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
          resultText = message.result;
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
