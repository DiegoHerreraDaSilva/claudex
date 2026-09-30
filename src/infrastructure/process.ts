import { spawn } from "node:child_process";

export interface CommandResult {
  code: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut?: boolean;
  aborted?: boolean;
  truncated?: boolean;
  error?: string;
}

export interface CommandOptions {
  cwd: string;
  env?: Record<string, string>;
  onOutput?: (text: string, stream: "stdout" | "stderr") => void;
  timeoutMs?: number;
  maxOutputBytes?: number;
  signal?: AbortSignal;
}

export function runCommand(
  command: string,
  args: string[],
  options: CommandOptions,
): Promise<CommandResult> {
  const started = Date.now();
  if (options.signal?.aborted)
    return Promise.resolve({ code: -1, stdout: "", stderr: "", durationMs: 0, aborted: true });
  const shell = process.platform === "win32" && command === "npm";
  if (shell && args.some((arg) => !/^[\w./:@=-]+$/.test(arg))) {
    return Promise.resolve({
      code: -1,
      stdout: "",
      stderr: "",
      durationMs: 0,
      error: "Unsafe shell argument",
    });
  }
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let capturedBytes = 0;
    let timedOut = false;
    let aborted = false;
    let truncated = false;
    let error: string | undefined;
    const maxBytes = options.maxOutputBytes ?? 512_000;
    const child = spawn(shell ? [command, ...args].join(" ") : command, shell ? [] : args, {
      cwd: options.cwd,
      windowsHide: true,
      shell,
      detached: process.platform !== "win32",
      env: {
        ...process.env,
        ...options.env,
        ...(command === process.execPath && process.versions.electron
          ? { ELECTRON_RUN_AS_NODE: "1" }
          : {}),
        CI: "1",
        FORCE_COLOR: "0",
      },
    });
    const capture = (chunk: Buffer, stream: "stdout" | "stderr") => {
      const remaining = Math.max(0, maxBytes - capturedBytes);
      const piece = chunk.subarray(0, remaining).toString();
      capturedBytes += Math.min(chunk.length, remaining);
      if (chunk.length > remaining) truncated = true;
      if (piece) options.onOutput?.(piece, stream);
      if (stream === "stdout") stdout += piece;
      else stderr += piece;
    };
    child.stdout.on("data", (chunk: Buffer) => capture(chunk, "stdout"));
    child.stderr.on("data", (chunk: Buffer) => capture(chunk, "stderr"));
    const terminate = () => {
      if (!child.pid) return;
      if (process.platform === "win32") {
        const killer = spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
          windowsHide: true,
        });
        killer.on("error", () => child.kill());
        killer.on("exit", (code) => {
          if (code !== 0) child.kill();
        });
        killer.stdout.resume();
        killer.stderr.resume();
      } else {
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch {
          child.kill("SIGKILL");
        }
      }
    };
    const abort = () => {
      aborted = true;
      terminate();
    };
    const timer = setTimeout(() => {
      timedOut = true;
      terminate();
    }, options.timeoutMs ?? 600_000);
    options.signal?.addEventListener("abort", abort, { once: true });
    if (options.signal?.aborted) abort();
    child.on("error", (err) => {
      error = err.message;
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", abort);
      resolve({
        code: timedOut || aborted || error ? -1 : (code ?? -1),
        stdout,
        stderr,
        durationMs: Date.now() - started,
        timedOut,
        aborted,
        truncated,
        ...(error ? { error } : {}),
      });
    });
  });
}
