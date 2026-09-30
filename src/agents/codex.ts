import { Codex } from "@openai/codex-sdk";
import type {
  ApprovalMode,
  SandboxMode,
  ThreadEvent,
  ThreadOptions,
  Usage,
} from "@openai/codex-sdk";
import {
  AgentError,
  type AgentRunResult,
  type AgentUsage,
  type CodexEventHandler,
} from "./types.js";

export interface RunCodexAgentOptions {
  prompt: string;
  worktreePath: string;
  model?: string;
  outputSchema?: Record<string, unknown>;
  onEvent?: CodexEventHandler;
  resumeThreadId?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
  sandboxMode?: SandboxMode;
  approvalPolicy?: ApprovalMode;
  reasoningEffort?: ThreadOptions["modelReasoningEffort"];
}

export interface CodexRunResult extends AgentRunResult {
  threadId: string;
  events: ThreadEvent[];
}

export async function runCodexAgent(options: RunCodexAgentOptions): Promise<CodexRunResult> {
  const codex = new Codex();
  const threadOptions: ThreadOptions = {
    workingDirectory: options.worktreePath,
    skipGitRepoCheck: false,
    sandboxMode: options.sandboxMode ?? "workspace-write",
    approvalPolicy: options.approvalPolicy ?? "never",
    networkAccessEnabled: true,
    ...(options.model ? { model: options.model } : {}),
    ...(options.reasoningEffort ? { modelReasoningEffort: options.reasoningEffort } : {}),
  };

  const thread = options.resumeThreadId
    ? codex.resumeThread(options.resumeThreadId, threadOptions)
    : codex.startThread(threadOptions);

  const controller = new AbortController();
  if (options.signal) {
    if (options.signal.aborted) controller.abort();
    else options.signal.addEventListener("abort", () => controller.abort(), { once: true });
  }
  const timer =
    options.timeoutMs && options.timeoutMs > 0
      ? setTimeout(() => controller.abort(), options.timeoutMs)
      : undefined;

  const started = Date.now();
  const events: ThreadEvent[] = [];
  let threadId: string | undefined;
  let resultText = "";
  let usage: Usage | null = null;
  let failure: string | null = null;

  try {
    if (options.onEvent) {
      const streamed = await thread.runStreamed(options.prompt, {
        signal: controller.signal,
        ...(options.outputSchema ? { outputSchema: options.outputSchema } : {}),
      });
      for await (const event of streamed.events) {
        events.push(event);
        options.onEvent(event);
        if (event.type === "thread.started") {
          threadId = event.thread_id;
        } else if (event.type === "turn.completed") {
          usage = event.usage;
        } else if (event.type === "turn.failed") {
          failure = event.error.message;
        } else if (event.type === "error") {
          failure = event.message;
        } else if (event.type === "item.completed" && event.item.type === "agent_message") {
          resultText = event.item.text;
        }
      }
    } else {
      const turn = await thread.run(options.prompt, {
        signal: controller.signal,
        ...(options.outputSchema ? { outputSchema: options.outputSchema } : {}),
      });
      resultText = turn.finalResponse;
      usage = turn.usage;
    }
  } catch (err) {
    throw new AgentError("codex", `Codex execution failed: ${errorMessage(err)}`, {
      cause: err,
    });
  } finally {
    if (timer) clearTimeout(timer);
  }

  if (failure) {
    throw new AgentError("codex", `Codex returned an error: ${failure}`);
  }

  return {
    result: resultText,
    threadId: thread.id ?? threadId ?? options.resumeThreadId ?? "",
    events,
    durationMs: Date.now() - started,
    usage: toAgentUsage(usage),
  };
}

function toAgentUsage(usage: Usage | null): AgentUsage {
  if (!usage) return { inputTokens: 0, outputTokens: 0 };
  return {
    inputTokens: usage.input_tokens + usage.cached_input_tokens,
    outputTokens: usage.output_tokens + usage.reasoning_output_tokens,
  };
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
