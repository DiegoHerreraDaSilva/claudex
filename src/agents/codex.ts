import { Codex, type Usage, type ModelReasoningEffort } from "@openai/codex-sdk";
import { existsSync } from "node:fs";
import path from "node:path";
import { unpackedRoot } from "./claude.js";
import { estimatedContext } from "../application/context.js";
import { AgentError, type AgentRunResult, type CodexEventHandler } from "./types.js";
export interface RunCodexAgentOptions {
  prompt: string;
  cwd: string;
  model?: string;
  effort?: ModelReasoningEffort;
  imagePaths?: string[];
  signal?: AbortSignal;
  timeoutMs?: number;
  onEvent?: CodexEventHandler;
  skipGitRepoCheck?: boolean;
  sandboxMode?: "workspace-write" | "read-only";
  approvalPolicy?: "never";
  networkAccessEnabled?: boolean;
  resumeThreadId?: string;
  teamBridge?: { command: string; args: string[]; env: Record<string, string> };
}
const CODEX_TARGETS: Record<string, string> = {
  "win32-x64": "x86_64-pc-windows-msvc",
  "win32-arm64": "aarch64-pc-windows-msvc",
  "darwin-x64": "x86_64-apple-darwin",
  "darwin-arm64": "aarch64-apple-darwin",
  "linux-x64": "x86_64-unknown-linux-musl",
  "linux-arm64": "aarch64-unknown-linux-musl",
};

/** No app empacotado, o binário do Codex precisa ser executado a partir da cópia desempacotada (fora do app.asar). */
export function unpackedCodex(
  root = unpackedRoot(),
  platform = process.platform,
  arch = process.arch,
): { executablePath: string; pathDir?: string } | undefined {
  const triple = CODEX_TARGETS[`${platform}-${arch}`];
  if (!root || !triple) return undefined;
  const name = platform === "win32" ? "codex.exe" : "codex";
  const base = path.join(
    root,
    "node_modules",
    "@openai",
    "codex",
    "node_modules",
    "@openai",
    `codex-${platform}-${arch}`,
    "vendor",
    triple,
  );
  const executablePath = path.join(base, "bin", name);
  if (!existsSync(executablePath)) return undefined;
  const pathDir = path.join(base, "codex-path");
  return { executablePath, ...(existsSync(pathDir) ? { pathDir } : {}) };
}

export async function runCodexAgent(options: RunCodexAgentOptions): Promise<AgentRunResult> {
  const unpacked = unpackedCodex();
  const codex = new Codex({
    ...(unpacked
      ? {
          codexPathOverride: unpacked.executablePath,
          ...(unpacked.pathDir
            ? {
                env: Object.fromEntries(
                  Object.entries({
                    ...process.env,
                    PATH: `${unpacked.pathDir}${path.delimiter}${process.env["PATH"] ?? ""}`,
                  }).filter((entry): entry is [string, string] => entry[1] !== undefined),
                ),
              }
            : {}),
        }
      : {}),
    ...(process.env["OPENAI_API_KEY"] ? { apiKey: process.env["OPENAI_API_KEY"] } : {}),
    ...(options.teamBridge ? { config: { mcp_servers: { claudex: options.teamBridge } } } : {}),
  });
  const threadOptions = {
    workingDirectory: options.cwd,
    skipGitRepoCheck: options.skipGitRepoCheck ?? true,
    model: options.model,
    ...(options.effort ? { modelReasoningEffort: options.effort } : {}),
    sandboxMode: options.sandboxMode ?? "workspace-write",
    approvalPolicy: "never" as const,
    networkAccessEnabled: options.networkAccessEnabled ?? true,
  };
  const thread = options.resumeThreadId
    ? codex.resumeThread(options.resumeThreadId, threadOptions)
    : codex.startThread(threadOptions);
  const controller = new AbortController(),
    started = Date.now();
  const abort = () => controller.abort();
  if (options.signal?.aborted) abort();
  else options.signal?.addEventListener("abort", abort, { once: true });
  const timer = options.timeoutMs ? setTimeout(abort, options.timeoutMs) : undefined;
  let result = "",
    usage: Usage | null = null,
    completed = false;
  const transcript: string[] = [options.prompt];
  const input = options.imagePaths?.length
    ? [
        { type: "text" as const, text: options.prompt },
        ...options.imagePaths.map((path) => ({ type: "local_image" as const, path })),
      ]
    : options.prompt;
  try {
    if (options.onEvent) {
      const stream = await thread.runStreamed(input, { signal: controller.signal });
      for await (const event of stream.events) {
        if (event.type === "item.completed") {
          if (event.item.type === "agent_message") transcript.push(event.item.text);
          if (event.item.type === "command_execution")
            transcript.push(event.item.command, event.item.aggregated_output);
        }
        options.onEvent(event);
        if (event.type === "turn.completed") {
          usage = event.usage;
          completed = true;
        }
        if (event.type === "turn.failed") throw new Error(event.error.message);
        if (event.type === "error") throw new Error(event.message);
        if (event.type === "item.completed" && event.item.type === "agent_message")
          result = event.item.text;
      }
    } else {
      const turn = await thread.run(input, { signal: controller.signal });
      result = turn.finalResponse;
      transcript.push(result);
      usage = turn.usage;
      completed = true;
    }
    if (!completed) throw new Error("Codex terminou sem fornecer um resultado.");
    return {
      result,
      threadId: thread.id || undefined,
      durationMs: Date.now() - started,
      usage: { inputTokens: usage?.input_tokens ?? 0, outputTokens: usage?.output_tokens ?? 0 },
      context: estimatedContext(transcript.join("\n"), `codex:${options.model ?? ""}`),
    };
  } catch (error) {
    throw new AgentError(
      "codex",
      `Codex: ${error instanceof Error ? error.message : String(error)}`,
    );
  } finally {
    if (timer) clearTimeout(timer);
    options.signal?.removeEventListener("abort", abort);
  }
}
