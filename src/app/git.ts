import { spawn } from "node:child_process";

export interface GitResult {
  code: number;
  stdout: string;
  stderr: string;
}

export const GIT_IDENTITY = ["-c", "user.name=claudex", "-c", "user.email=claudex@local"];

export function runGit(cwd: string, args: string[], allowFailure = false): Promise<GitResult> {
  return new Promise((resolve, reject) => {
    const child = spawn("git", args, { cwd, windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
    child.on("error", (err) => reject(new Error(`git spawn failed: ${err.message}`)));
    child.on("close", (code) => {
      const exit = code ?? -1;
      if (exit !== 0 && !allowFailure) {
        reject(new Error(`git ${args.join(" ")} failed: ${stderr.trim() || stdout.trim()}`));
        return;
      }
      resolve({ code: exit, stdout, stderr });
    });
  });
}

export async function isGitRepo(dir: string): Promise<boolean> {
  const result = await runGit(dir, ["rev-parse", "--is-inside-work-tree"], true);
  return result.code === 0 && result.stdout.trim() === "true";
}

export async function currentBranch(dir: string): Promise<string> {
  const result = await runGit(dir, ["rev-parse", "--abbrev-ref", "HEAD"]);
  return result.stdout.trim();
}

export async function branchExists(dir: string, branch: string): Promise<boolean> {
  const result = await runGit(dir, ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`], true);
  return result.code === 0;
}

export async function addWorktree(
  root: string,
  worktreePath: string,
  branch: string,
  baseBranch?: string,
): Promise<void> {
  const args = ["worktree", "add", "-b", branch, worktreePath];
  if (baseBranch) args.push(baseBranch);
  await runGit(root, args);
}

export async function removeWorktree(root: string, worktreePath: string): Promise<void> {
  await runGit(root, ["worktree", "remove", "--force", worktreePath], true);
}

export async function commitAll(dir: string, message: string): Promise<boolean> {
  await runGit(dir, ["add", "-A"]);
  const status = await runGit(dir, ["status", "--porcelain"], true);
  if (status.stdout.trim().length === 0) return false;
  await runGit(dir, [...GIT_IDENTITY, "commit", "-m", message]);
  return true;
}

export async function diffAgainst(dir: string, ref: string): Promise<string> {
  await runGit(dir, ["add", "-A"]);
  const result = await runGit(dir, ["diff", ref]);
  return result.stdout;
}

export async function resetHard(dir: string, ref: string): Promise<void> {
  await runGit(dir, ["reset", "--hard", ref]);
  await runGit(dir, ["clean", "-fd"]);
}

export interface MergeOutcome {
  ok: boolean;
  conflicts?: string[];
  reason?: string;
}

export async function mergeBranch(root: string, branch: string): Promise<MergeOutcome> {
  const result = await runGit(root, [...GIT_IDENTITY, "merge", "--no-ff", "--no-edit", branch], true);
  if (result.code === 0) return { ok: true };
  const output = `${result.stdout}\n${result.stderr}`
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const conflicts = output.filter((line) => line.startsWith("CONFLICT"));
  await runGit(root, ["merge", "--abort"], true);
  return {
    ok: false,
    ...(conflicts.length > 0 ? { conflicts } : {}),
    ...(conflicts.length === 0 && output.length > 0 ? { reason: output[output.length - 1] } : {}),
  };
}

export async function deleteBranch(root: string, branch: string): Promise<void> {
  await runGit(root, ["branch", "-D", branch], true);
}

export async function checkout(root: string, branch: string): Promise<void> {
  await runGit(root, ["checkout", branch]);
}
