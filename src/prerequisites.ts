import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import type { OrchestratorConfig } from "./config.js";

export type CheckStatus = "ok" | "warn" | "fail";

export interface PrerequisiteCheck {
  name: string;
  status: CheckStatus;
  detail: string;
}

export interface PrerequisiteReport {
  ok: boolean;
  checks: PrerequisiteCheck[];
}

function runGit(args: string[], cwd: string): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn("git", args, { cwd, windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (c: Buffer) => (stdout += c.toString()));
    child.stderr.on("data", (c: Buffer) => (stderr += c.toString()));
    child.on("error", (err) => resolve({ code: -1, stdout, stderr: err.message }));
    child.on("close", (code) => resolve({ code: code ?? -1, stdout, stderr }));
  });
}

export async function checkPrerequisites(
  config: OrchestratorConfig,
  options: { requireClaude?: boolean; requireCodex?: boolean } = {},
): Promise<PrerequisiteReport> {
  const checks: PrerequisiteCheck[] = [];
  const root = config.projectRoot;

  const inRepo = await runGit(["rev-parse", "--is-inside-work-tree"], root);
  checks.push({
    name: "git repository",
    status: inRepo.code === 0 && inRepo.stdout.trim() === "true" ? "ok" : "fail",
    detail:
      inRepo.code === 0 && inRepo.stdout.trim() === "true"
        ? `git repository detected at ${root}`
        : "current directory is not a git repository (run: git init && git commit)",
  });

  const worktree = await runGit(["worktree", "list", "--porcelain"], root);
  checks.push({
    name: "git worktree",
    status: worktree.code === 0 ? "ok" : "fail",
    detail: worktree.code === 0 ? "git worktree is available" : worktree.stderr.trim(),
  });

  const claudeCreds = path.join(homedir(), ".claude", ".credentials.json");
  const hasClaude = existsSync(claudeCreds);
  checks.push({
    name: "Claude subscription",
    status: hasClaude ? "ok" : options.requireClaude ? "fail" : "warn",
    detail: hasClaude
      ? `credentials found at ${claudeCreds}`
      : "~/.claude/.credentials.json missing (run `claude login`)",
  });

  const codexCreds = path.join(homedir(), ".codex", "auth.json");
  const hasCodex = existsSync(codexCreds);
  checks.push({
    name: "Codex subscription",
    status: hasCodex ? "ok" : options.requireCodex ? "fail" : "warn",
    detail: hasCodex
      ? `credentials found at ${codexCreds}`
      : "~/.codex/auth.json missing (run `codex login` -> Sign in with ChatGPT)",
  });

  checks.push({
    name: "TYPESAFE_API_KEY",
    status: config.typesafeApiKey.trim().length > 0 ? "ok" : "warn",
    detail:
      config.typesafeApiKey.trim().length > 0
        ? `configured (endpoint ${config.typesafeBaseUrl})`
        : "not set; Jev routing will fall back to the local heuristic router",
  });

  if (process.env["ANTHROPIC_API_KEY"]) {
    checks.push({
      name: "ANTHROPIC_API_KEY precedence",
      status: "warn",
      detail:
        "ANTHROPIC_API_KEY is set and takes precedence over the Claude subscription (token billing). Unset it to use your Pro/Max plan.",
    });
  }

  if (process.env["OPENAI_API_KEY"]) {
    checks.push({
      name: "OPENAI_API_KEY precedence",
      status: "warn",
      detail:
        "OPENAI_API_KEY is set; Codex may bill the API key instead of your ChatGPT subscription.",
    });
  }

  return { ok: checks.every((check) => check.status !== "fail"), checks };
}
