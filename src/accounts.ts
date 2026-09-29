import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

export type ProviderId = "claude" | "codex";
export type AccountAction = "login" | "logout";
export type OutputStream = "stdout" | "stderr" | "status";
export type LineSink = (stream: OutputStream, line: string) => void;

export interface AccountResult {
  provider: ProviderId;
  action: AccountAction;
  ok: boolean;
  code: number | null;
  message: string;
}

function findOnPath(names: string[]): string | null {
  const pathEnv = process.env["PATH"] ?? "";
  const sep = process.platform === "win32" ? ";" : ":";
  for (const dir of pathEnv.split(sep)) {
    if (!dir) continue;
    for (const name of names) {
      const candidate = path.join(dir, name);
      if (existsSync(candidate)) return candidate;
    }
  }
  return null;
}

function binNames(base: string): string[] {
  return process.platform === "win32" ? [`${base}.exe`, `${base}.cmd`, base] : [base];
}

export function resolveClaudeCli(projectRoot: string): string | null {
  const explicit = process.env["CLAUDE_CLI_PATH"];
  if (explicit && existsSync(explicit)) return explicit;
  const bin = process.platform === "win32" ? "claude.exe" : "claude";
  const bundled = path.join(
    projectRoot,
    "node_modules",
    "@anthropic-ai",
    `claude-agent-sdk-${process.platform}-${process.arch}`,
    bin,
  );
  if (existsSync(bundled)) return bundled;
  return findOnPath(binNames("claude"));
}

export function resolveCodexCli(projectRoot: string): { command: string; args: string[] } | null {
  const explicit = process.env["CODEX_CLI_PATH"];
  if (explicit && existsSync(explicit)) return { command: explicit, args: [] };
  const onPath = findOnPath(binNames("codex"));
  if (onPath) return { command: onPath, args: [] };
  const js = path.join(projectRoot, "node_modules", "@openai", "codex", "bin", "codex.js");
  if (existsSync(js)) return { command: process.execPath, args: [js] };
  return null;
}

function splitLines(chunk: string, sink: (line: string) => void, carry: { value: string }): void {
  carry.value += chunk;
  const parts = carry.value.split(/\r?\n/);
  carry.value = parts.pop() ?? "";
  for (const line of parts) {
    if (line.trim().length > 0) sink(line);
  }
}

/**
 * Auth management is the one place we spawn claude/codex directly: the official
 * SDKs expose no login/logout, so we delegate to the CLI's auth subcommands.
 */
export function runAccountAction(
  provider: ProviderId,
  action: AccountAction,
  projectRoot: string,
  onLine: LineSink,
  timeoutMs = 300_000,
): Promise<AccountResult> {
  const base: AccountResult = { provider, action, ok: false, code: null, message: "" };

  let command: string;
  let args: string[];
  if (provider === "claude") {
    const cli = resolveClaudeCli(projectRoot);
    if (!cli) {
      return Promise.resolve({ ...base, message: "Claude CLI not found (set CLAUDE_CLI_PATH)" });
    }
    command = cli;
    args = ["auth", action];
  } else {
    const cli = resolveCodexCli(projectRoot);
    if (!cli) {
      return Promise.resolve({ ...base, message: "Codex CLI not found (set CODEX_CLI_PATH)" });
    }
    command = cli.command;
    args = [...cli.args, action];
  }

  onLine("status", `$ ${command} ${args.join(" ")}`);

  return new Promise<AccountResult>((resolve) => {
    const child = spawn(command, args, {
      cwd: projectRoot,
      windowsHide: true,
      env: process.env,
    });

    const stdoutCarry = { value: "" };
    const stderrCarry = { value: "" };
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      onLine("status", `timeout after ${Math.round(timeoutMs / 1000)}s; terminating`);
      child.kill();
    }, timeoutMs);

    child.stdout.on("data", (chunk: Buffer) =>
      splitLines(chunk.toString(), (line) => onLine("stdout", line), stdoutCarry),
    );
    child.stderr.on("data", (chunk: Buffer) =>
      splitLines(chunk.toString(), (line) => onLine("stderr", line), stderrCarry),
    );

    const finish = (result: AccountResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };

    child.on("error", (err) => {
      onLine("stderr", err.message);
      finish({ ...base, message: err.message });
    });

    child.on("close", (code) => {
      const ok = code === 0;
      onLine("status", `${provider} ${action} exited with code ${code ?? "null"}`);
      finish({ ...base, ok, code: code ?? null, message: ok ? "done" : `exit code ${code}` });
    });
  });
}
