import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import path from "node:path";

export interface WorktreeInfo {
  id: string;
  path: string;
  branch: string;
  dirty: boolean;
}

export interface MergeResult {
  success: boolean;
  conflicts?: string[];
}

export class WorktreeError extends Error {
  readonly args: string[];
  readonly stderr: string;

  constructor(message: string, args: string[], stderr: string) {
    super(message);
    this.name = "WorktreeError";
    this.args = args;
    this.stderr = stderr;
  }
}

interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

export class WorktreeManager {
  private readonly worktreesDir: string;

  constructor(
    private readonly root: string,
    worktreesDir?: string,
  ) {
    this.worktreesDir = worktreesDir ?? path.join(root, ".worktrees");
  }

  async create(taskId: string, baseBranch?: string): Promise<string> {
    await mkdir(this.worktreesDir, { recursive: true });
    const relative = path.join(".worktrees", taskId);
    const args = ["worktree", "add", relative, "-b", taskId];
    if (baseBranch) args.push(baseBranch);
    await this.run(args);
    return path.join(this.worktreesDir, taskId);
  }

  async remove(taskId: string): Promise<void> {
    const relative = path.join(".worktrees", taskId);
    await this.run(["worktree", "remove", relative, "--force"]);
    const branch = await this.run(["branch", "-D", taskId], { allowFailure: true });
    if (branch.code !== 0 && !/not found|no such branch/i.test(branch.stderr)) {
      throw new WorktreeError(
        `Failed to delete branch '${taskId}': ${branch.stderr.trim()}`,
        ["branch", "-D", taskId],
        branch.stderr,
      );
    }
  }

  async getDiff(taskId: string): Promise<string> {
    const dir = path.join(this.worktreesDir, taskId);
    await this.run(["add", "-A"], { cwd: dir });
    const result = await this.run(["diff", "HEAD"], { cwd: dir });
    return result.stdout;
  }

  async list(): Promise<WorktreeInfo[]> {
    const result = await this.run(["worktree", "list", "--porcelain"]);
    const infos: WorktreeInfo[] = [];
    const blocks = result.stdout.split(/\r?\n\r?\n/).filter((b) => b.trim().length > 0);
    for (const block of blocks) {
      const lines = block.split(/\r?\n/);
      let worktreePath = "";
      let branch = "";
      for (const line of lines) {
        if (line.startsWith("worktree ")) worktreePath = line.slice("worktree ".length).trim();
        else if (line.startsWith("branch ")) {
          branch = line.slice("branch ".length).trim().replace(/^refs\/heads\//, "");
        }
      }
      if (!worktreePath) continue;
      const status = await this.run(["status", "--porcelain"], {
        cwd: worktreePath,
        allowFailure: true,
      });
      infos.push({
        id: path.basename(worktreePath),
        path: worktreePath,
        branch,
        dirty: status.stdout.trim().length > 0,
      });
    }
    return infos;
  }

  async merge(taskId: string, targetBranch: string): Promise<MergeResult> {
    const current = await this.run(["rev-parse", "--abbrev-ref", "HEAD"], { allowFailure: true });
    if (current.stdout.trim() !== targetBranch) {
      await this.run(["checkout", targetBranch]);
    }
    const merge = await this.run(["merge", "--no-ff", "--no-edit", taskId], { allowFailure: true });
    if (merge.code === 0) return { success: true };
    const conflicts = merge.stdout
      .split(/\r?\n/)
      .filter((line) => line.startsWith("CONFLICT"))
      .map((line) => line.trim());
    await this.run(["merge", "--abort"], { allowFailure: true });
    return { success: false, conflicts };
  }

  private run(
    args: string[],
    options: { cwd?: string; allowFailure?: boolean } = {},
  ): Promise<RunResult> {
    const cwd = options.cwd ?? this.root;
    return new Promise((resolve, reject) => {
      const child = spawn("git", args, { cwd, windowsHide: true });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk: Buffer) => {
        stdout += chunk.toString();
      });
      child.stderr.on("data", (chunk: Buffer) => {
        stderr += chunk.toString();
      });
      child.on("error", (err) => {
        reject(new WorktreeError(`Failed to spawn git: ${err.message}`, args, stderr));
      });
      child.on("close", (code) => {
        const exit = code ?? -1;
        if (exit !== 0 && !options.allowFailure) {
          reject(new WorktreeError(`git ${args.join(" ")} failed: ${stderr.trim()}`, args, stderr));
          return;
        }
        resolve({ code: exit, stdout, stderr });
      });
    });
  }
}
