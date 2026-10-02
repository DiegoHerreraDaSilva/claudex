import { query } from "@anthropic-ai/claude-agent-sdk";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { estimatedContext } from "../application/context.js";
import type { EffortLevel } from "@anthropic-ai/claude-agent-sdk";
import type { SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { readFile } from "node:fs/promises";
import type { Attachment } from "../application/attachments.js";
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
  cwd: string;
  signal?: AbortSignal;
  timeoutMs?: number;
  onMessage?: ClaudeMessageHandler;
  resumeSessionId?: string;
  teamBridge?: { command: string; args: string[]; env: Record<string, string> };
  readOnly?: boolean;
  effort?: EffortLevel;
  images?: Attachment[];
}
/**
 * No app empacotado, o SDK acharia o binário dentro de app.asar, de onde não dá para executá-lo.
 * Aponta para a cópia desempacotada (asarUnpack). Fora do empacotamento devolve undefined e o SDK decide.
 */
export function unpackedRoot(
  moduleDir = path.dirname(fileURLToPath(import.meta.url)),
): string | undefined {
  const at = moduleDir.indexOf(`app.asar${path.sep}`);
  return at < 0 ? undefined : `${moduleDir.slice(0, at)}app.asar.unpacked`;
}

export function unpackedClaudeBinary(
  moduleDir = path.dirname(fileURLToPath(import.meta.url)),
  platform = process.platform,
  arch = process.arch,
): string | undefined {
  const root = unpackedRoot(moduleDir);
  if (!root) return undefined;
  const pkg = `claude-agent-sdk-${platform}-${arch}`;
  const exe = platform === "win32" ? "claude.exe" : "claude";
  const candidates = [
    path.join(
      root,
      "node_modules",
      "@anthropic-ai",
      "claude-agent-sdk",
      "node_modules",
      "@anthropic-ai",
      pkg,
      exe,
    ),
    path.join(root, "node_modules", "@anthropic-ai", pkg, exe),
  ];
  return candidates.find((candidate) => existsSync(candidate));
}

export async function runClaudeAgent(options: RunClaudeAgentOptions): Promise<AgentRunResult> {
  const started = Date.now(),
    controller = new AbortController();
  const abort = () => controller.abort();
  if (options.signal?.aborted) abort();
  else options.signal?.addEventListener("abort", abort, { once: true });
  const timer = options.timeoutMs ? setTimeout(abort, options.timeoutMs) : undefined;
  let result = "",
    sessionId = "",
    receivedResult = false;
  let usage: AgentUsage = { inputTokens: 0, outputTokens: 0 };
  let reportedContext:
    { usedTokens: number; limitTokens: number; source: "sdk"; limitSource: "sdk" } | undefined;
  let lastInput = 0,
    lastOutput = 0,
    lastModel = "",
    contextWindow: number | undefined;
  try {
    const claudeBinary = unpackedClaudeBinary();
    let prompt: string | AsyncIterable<SDKUserMessage> = options.prompt;
    if (options.images?.length) {
      const content: Exclude<SDKUserMessage["message"]["content"], string> = [
        { type: "text", text: options.prompt },
      ];
      for (const file of options.images) {
        if (!["image/png", "image/jpeg", "image/gif", "image/webp"].includes(file.mimeType))
          throw new Error("Formato de imagem não suportado.");
        content.push({
          type: "image",
          source: {
            type: "base64",
            media_type: file.mimeType as "image/png" | "image/jpeg" | "image/gif" | "image/webp",
            data: (await readFile(file.path)).toString("base64"),
          },
        });
      }
      prompt = (async function* (): AsyncGenerator<SDKUserMessage> {
        yield { type: "user", message: { role: "user", content }, parent_tool_use_id: null };
      })();
    }
    const stream = query({
      prompt,
      options: {
        model: options.model,
        ...(options.effort ? { effort: options.effort } : {}),
        cwd: options.cwd,
        ...(claudeBinary ? { pathToClaudeCodeExecutable: claudeBinary } : {}),
        ...(options.resumeSessionId ? { resume: options.resumeSessionId } : {}),
        ...(options.teamBridge ? { mcpServers: { claudex: options.teamBridge } } : {}),
        disallowedTools: options.readOnly
          ? ["Write", "Edit", "Bash", "NotebookEdit", "Agent", "Task"]
          : options.teamBridge
            ? ["Agent", "Task"]
            : [],
        abortController: controller,
        permissionMode: "bypassPermissions",
        allowDangerouslySkipPermissions: true,
      },
    });
    for await (const message of stream) {
      if (message.type === "assistant") {
        if (message.context_usage)
          reportedContext = {
            usedTokens: message.context_usage.total_tokens,
            limitTokens: message.context_usage.raw_max_tokens,
            source: "sdk",
            limitSource: "sdk",
          };
        const u = message.message.usage;
        lastInput =
          u.input_tokens + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0);
        lastOutput = u.output_tokens;
        lastModel = message.message.model;
      }
      options.onMessage?.(message);
      sessionId = message.session_id || sessionId;
      if (message.type === "result") {
        if (message.subtype !== "success") throw new Error(message.subtype);
        receivedResult = true;
        result = message.result;
        usage = {
          inputTokens: message.usage.input_tokens,
          outputTokens: message.usage.output_tokens,
        };
        const models = message.modelUsage ?? {};
        const row = models[lastModel] ?? models[options.model];
        contextWindow = row?.contextWindow;
      }
    }
    if (!receivedResult) throw new Error("Claude terminou sem fornecer um resultado.");
    const context = estimatedContext(options.prompt + result, `claude:${options.model}`);
    if (lastInput) context.usedTokens = lastInput + lastOutput;
    if (contextWindow) {
      context.limitTokens = contextWindow;
      context.limitSource = "sdk";
    }
    return {
      result,
      sessionId,
      usage,
      context: reportedContext ?? context,
      durationMs: Date.now() - started,
    };
  } catch (error) {
    throw new AgentError(
      "claude",
      `Claude: ${error instanceof Error ? error.message : String(error)}`,
    );
  } finally {
    if (timer) clearTimeout(timer);
    options.signal?.removeEventListener("abort", abort);
  }
}
