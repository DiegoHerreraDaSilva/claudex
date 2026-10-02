import { EventEmitter } from "node:events";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";

interface Terminal {
  projectId: string;
  cwd: string;
  shell: string;
  output: string;
  running: boolean;
  process?: ChildProcessWithoutNullStreams;
}

/** User-controlled persistent shells. Output is bounded and never persisted to disk. */
export class TerminalService extends EventEmitter {
  private readonly terminals = new Map<string, Terminal>();

  snapshot(projectId: string) {
    const terminal = this.terminals.get(projectId);
    return terminal
      ? {
          projectId,
          cwd: terminal.cwd,
          shell: terminal.shell,
          output: terminal.output,
          running: terminal.running,
        }
      : { projectId, cwd: "", shell: "", output: "", running: false };
  }

  open(projectId: string, cwd: string) {
    if (this.terminals.get(projectId)?.running) return this.snapshot(projectId);
    const windows = process.platform === "win32";
    const shell = windows ? "powershell.exe" : "/bin/bash";
    const terminal: Terminal = {
      projectId,
      cwd,
      shell: windows ? "PowerShell" : "Bash",
      output: this.terminals.get(projectId)?.output ?? "",
      running: true,
    };
    const env: NodeJS.ProcessEnv = { ...process.env, TERM: "dumb" };
    for (const key of ["TYPESAFE_API_KEY", "ANTHROPIC_API_KEY", "OPENAI_API_KEY"]) delete env[key];
    const child = spawn(
      shell,
      windows ? ["-NoLogo", "-NoProfile", "-NoExit", "-Command", "-"] : ["--noprofile", "--norc"],
      {
        cwd,
        env,
        windowsHide: true,
        stdio: "pipe",
        detached: !windows,
      },
    );
    terminal.process = child;
    this.terminals.set(projectId, terminal);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    const output = (text: string) => {
      terminal.output = (terminal.output + text).slice(-65536);
      this.emit("updated", this.snapshot(projectId));
    };
    child.stdout.on("data", output);
    child.stderr.on("data", output);
    child.stdin.on("error", () => undefined);
    child.on("error", (error) => {
      terminal.running = false;
      output(`\nNão foi possível iniciar o terminal: ${error.message}\n`);
    });
    child.on("close", (code) => {
      terminal.running = false;
      terminal.process = undefined;
      output(`\n[Terminal encerrado${code === null ? "" : ` · código ${code}`} ]\n`);
    });
    if (windows)
      child.stdin.write("[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)\n");
    this.emit("updated", this.snapshot(projectId));
    return this.snapshot(projectId);
  }

  write(projectId: string, input: string) {
    const terminal = this.terminals.get(projectId);
    if (!terminal?.running || !terminal.process)
      throw new Error("Abra o terminal antes de enviar comandos.");
    terminal.output = (terminal.output + `\n› ${input}`).slice(-65536);
    terminal.process.stdin.write(input);
    this.emit("updated", this.snapshot(projectId));
  }

  clear(projectId: string) {
    const terminal = this.terminals.get(projectId);
    if (terminal) terminal.output = "";
    this.emit("updated", this.snapshot(projectId));
  }

  async stop(projectId: string): Promise<void> {
    const terminal = this.terminals.get(projectId);
    const child = terminal?.process;
    if (!terminal || !child || !terminal.running) return;
    const closed = new Promise<void>((resolve) => child.once("close", () => resolve()));
    if (process.platform === "win32" && child.pid) {
      await new Promise<void>((resolve) => {
        const killer = spawn("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], {
          windowsHide: true,
        });
        killer.on("error", () => {
          child.kill();
          resolve();
        });
        killer.on("close", () => {
          child.kill();
          resolve();
        });
      });
    } else if (child.pid) {
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {
        child.kill("SIGKILL");
      }
    }
    await closed;
  }

  async close() {
    await Promise.all([...this.terminals.keys()].map((id) => this.stop(id)));
  }
}
