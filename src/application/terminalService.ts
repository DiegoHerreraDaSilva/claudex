import { randomUUID } from "node:crypto";
import { runCommand, type CommandResult } from "../infrastructure/process.js";
import type { AutonomyMode } from "../domain/mission.js";
export interface TerminalOutput {
  projectId: string;
  runId: string;
  stream: "stdout" | "stderr" | "system";
  text?: string;
  result?: CommandResult;
}
export class TerminalService {
  private readonly running = new Map<string, AbortController>();
  stop(projectId: string): void {
    this.running.get(projectId)?.abort();
  }
  async run(
    projectId: string,
    cwd: string,
    command: string,
    emit: (event: TerminalOutput) => void,
    autonomy: AutonomyMode = "autonomous",
  ): Promise<CommandResult> {
    if (autonomy === "manual") throw new Error("terminal is disabled in manual mode");
    if (typeof command !== "string" || !command.trim() || command.length > 4000)
      throw new Error("command must contain 1–4000 characters");
    if (this.running.has(projectId)) throw new Error("terminal already running");
    const controller = new AbortController();
    this.running.set(projectId, controller);
    const runId = randomUUID();
    emit({ projectId, runId, stream: "system", text: `$ ${command}\n` });
    try {
      const result = await runCommand(
        process.platform === "win32" ? "powershell.exe" : "/bin/sh",
        process.platform === "win32"
          ? ["-NoProfile", "-NonInteractive", "-Command", command]
          : ["-c", command],
        {
          cwd,
          signal: controller.signal,
          timeoutMs: 120_000,
          maxOutputBytes: 256_000,
          onOutput: (text, stream) => emit({ projectId, runId, text, stream }),
        },
      );
      emit({ projectId, runId, stream: "system", result });
      return result;
    } finally {
      this.running.delete(projectId);
    }
  }
}
