import { mkdir, readFile, writeFile, readdir, rename, realpath } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { Checkpoint } from "../domain/checkpoint.js";
import { commitAll, runGit, currentBranch } from "../app/git.js";
import { safeId } from "./memoryService.js";
export class CheckpointService {
  constructor(private readonly root: string) {}
  async list(missionId: string): Promise<Checkpoint[]> {
    const dir = path.join(this.root, safeId(missionId));
    try {
      const entries = await readdir(dir);
      const checkpoints = await Promise.all(
        entries
          .filter((name) => /^\d+\.json$/.test(name))
          .map(
            async (name) => JSON.parse(await readFile(path.join(dir, name), "utf8")) as Checkpoint,
          ),
      );
      return checkpoints.sort((a, b) => a.index - b.index);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
  }
  async create(missionId: string, worktree: string, label: string): Promise<Checkpoint> {
    const index = (await this.list(missionId)).length + 1;
    await commitAll(worktree, `checkpoint: ${label}`);
    const commit = (await runGit(worktree, ["rev-parse", "HEAD"])).stdout.trim();
    const files = (
      await runGit(worktree, ["diff-tree", "--no-commit-id", "--name-only", "-r", "HEAD"])
    ).stdout
      .trim()
      .split(/\r?\n/)
      .filter(Boolean);
    const checkpoint: Checkpoint = {
      id: randomUUID(),
      missionId,
      index,
      commit,
      files,
      createdAt: Date.now(),
    };
    const dir = path.join(this.root, safeId(missionId));
    await mkdir(dir, { recursive: true });
    const target = path.join(dir, `${index}.json`);
    const temp = `${target}.tmp`;
    await writeFile(temp, JSON.stringify(checkpoint), "utf8");
    await rename(temp, target);
    return checkpoint;
  }
}
export async function assertMissionWorktree(
  root: string,
  worktreesBase: string,
  worktree: string,
  branch: string,
): Promise<void> {
  const canonical = await realpath(worktree);
  const base = await realpath(worktreesBase);
  const relative = path.relative(base, canonical);
  if (
    !relative ||
    relative.startsWith("..") ||
    path.isAbsolute(relative) ||
    canonical === (await realpath(root))
  )
    throw new Error("worktree is outside the managed workspace");
  const common = async (dir: string) =>
    realpath(
      (
        await runGit(dir, ["rev-parse", "--path-format=absolute", "--git-common-dir"])
      ).stdout.trim(),
    );
  if (
    (await common(root)) !== (await common(worktree)) ||
    (await currentBranch(worktree)) !== branch
  )
    throw new Error("worktree does not belong to this mission");
}
