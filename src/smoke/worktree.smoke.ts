import { writeFile } from "node:fs/promises";
import path from "node:path";
import { getConfig } from "../config.js";
import { WorktreeManager } from "../worktree.js";

const config = getConfig();
const manager = new WorktreeManager(config.projectRoot);
const id = "smoke-worktree";

try {
  console.log("[worktree smoke] create");
  const dir = await manager.create(id);
  console.log("created", dir);

  await writeFile(path.join(dir, "SMOKE.md"), "# smoke\n", "utf8");

  console.log("[worktree smoke] diff");
  const diff = await manager.getDiff(id);
  console.log(diff.split("\n").slice(0, 8).join("\n"));

  console.log("[worktree smoke] list");
  console.log(await manager.list());

  console.log("[worktree smoke] remove");
  await manager.remove(id);
  console.log("done");
} catch (err) {
  console.error("worktree smoke failed:", err instanceof Error ? err.message : err);
  process.exitCode = 1;
}
