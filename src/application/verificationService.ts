import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { v4 as uuid } from "uuid";
import type { MissionEventInput } from "../domain/event.js";
import type { VerificationKind, VerificationRun } from "../domain/verification.js";
import { runCommand, type CommandOptions, type CommandResult } from "../infrastructure/process.js";

export interface VerificationOptions {
  missionId: string;
  worktreePath: string;
  timeoutMs?: number;
  signal?: AbortSignal;
  onEvent?: (event: MissionEventInput) => Promise<void>;
  run?: (command: string, args: string[], options: CommandOptions) => Promise<CommandResult>;
}

const KINDS: VerificationKind[] = ["typecheck", "build", "tests", "lint", "security"];

export async function verifyMission(options: VerificationOptions): Promise<VerificationRun[]> {
  const { missionId, worktreePath, signal } = options;
  let scripts: Record<string, unknown> = {};
  let packageError: string | undefined;
  const hasPackage = existsSync(path.join(worktreePath, "package.json"));
  if (hasPackage) {
    try {
      const pkg = JSON.parse(await readFile(path.join(worktreePath, "package.json"), "utf8"));
      if (!pkg || typeof pkg !== "object" || Array.isArray(pkg))
        throw new Error("Invalid package.json");
      scripts = pkg.scripts && typeof pkg.scripts === "object" ? pkg.scripts : {};
    } catch (err) {
      packageError = err instanceof Error ? err.message : String(err);
    }
  }
  const results: VerificationRun[] = [];
  for (const kind of KINDS) {
    signal?.throwIfAborted();
    const item: VerificationRun = {
      id: uuid(),
      missionId,
      kind,
      status: "running",
      summary: kind,
      at: Date.now(),
    };
    await options.onEvent?.({
      type: "verification:started",
      level: "info",
      message: kind,
      payload: { verification: { ...item } },
    });
    const script = kind === "tests" ? "test" : kind;
    let command = "npm";
    let args: string[] | undefined;
    if (hasPackage && kind === "security") {
      if (
        existsSync(path.join(worktreePath, "package-lock.json")) ||
        existsSync(path.join(worktreePath, "npm-shrinkwrap.json"))
      )
        args = ["audit", "--json", "--fetch-retries=0", "--fetch-timeout=30000"];
    } else if (typeof scripts[script] === "string" && scripts[script]) {
      args = ["run", script];
    } else if (kind === "typecheck" && existsSync(path.join(worktreePath, "tsconfig.json"))) {
      const tsc = path.join(worktreePath, "node_modules", "typescript", "bin", "tsc");
      if (existsSync(tsc)) {
        command = process.execPath;
        args = [tsc, "--noEmit"];
      }
    }
    if (packageError) {
      Object.assign(item, {
        status: "failed",
        summary: "Invalid package.json",
        output: packageError,
      });
    } else if (!args) {
      Object.assign(item, {
        status: "skipped",
        summary: !hasPackage
          ? "Unsupported stack: no package.json"
          : kind === "security"
            ? "No npm lockfile"
            : `No ${script} script or local compiler`,
      });
    } else {
      try {
        const result = await (options.run ?? runCommand)(command, args, {
          cwd: worktreePath,
          timeoutMs:
            kind === "security" ? Math.min(options.timeoutMs ?? 60_000, 60_000) : options.timeoutMs,
          signal,
        });
        const output = [
          result.stdout,
          result.stderr,
          result.error,
          result.timedOut ? "Command timed out" : "",
          result.truncated ? "Output truncated" : "",
        ]
          .filter(Boolean)
          .join("\n");
        Object.assign(item, {
          status: result.code === 0 ? "passed" : "failed",
          summary:
            result.code === 0
              ? "Command passed"
              : result.timedOut
                ? "Command timed out"
                : `Command failed (exit ${result.code})`,
          output,
          durationMs: result.durationMs,
        });
        if (kind === "security") Object.assign(item, auditVerdict(result));
        if (kind === "tests" && item.status === "passed") {
          const match = /Tests\s*:?\s*(\d+)\s+passed/i.exec(output);
          if (match?.[1]) item.testCount = Number(match[1]);
        }
      } catch (err) {
        Object.assign(item, {
          status: kind === "security" ? "skipped" : "failed",
          summary: "Command unavailable",
          output: err instanceof Error ? err.message : String(err),
        });
      }
    }
    if (signal?.aborted) {
      Object.assign(item, { status: "skipped", summary: "Verification cancelled" });
    }
    results.push(item);
    await options.onEvent?.({
      type: "verification:completed",
      level: item.status === "failed" ? "error" : item.status === "passed" ? "success" : "warn",
      message: `${kind}: ${item.summary}`,
      payload: { verification: item },
    });
    signal?.throwIfAborted();
  }
  return results;
}

function auditVerdict(result: CommandResult): Pick<VerificationRun, "status" | "summary"> {
  try {
    const report = JSON.parse(result.stdout) as {
      error?: unknown;
      metadata?: { vulnerabilities?: { total?: unknown } };
    };
    const total = report.metadata?.vulnerabilities?.total;
    if (
      !result.timedOut &&
      !result.error &&
      !report.error &&
      typeof total === "number" &&
      Number.isFinite(total) &&
      total >= 0
    ) {
      return {
        status: total > 0 ? "failed" : result.code === 0 ? "passed" : "skipped",
        summary: `${total} known vulnerabilities`,
      };
    }
  } catch {}
  return { status: "skipped", summary: "Security audit unavailable" };
}
