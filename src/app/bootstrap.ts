import { access, copyFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { initLogger } from "../logger.js";
import { legacyDataDir } from "./paths.js";
async function exists(target: string): Promise<boolean> {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}
/** Ensures the app-data dir exists, initializes logging and imports legacy state once. */
export async function bootstrapDataDir(
  projectRoot: string,
  dataDir: string,
  logsDir: string,
): Promise<void> {
  await mkdir(dataDir, { recursive: true });
  initLogger(logsDir);
  const legacy = path.join(legacyDataDir(projectRoot), "projects.json");
  const target = path.join(dataDir, "projects.json");
  if ((await exists(legacy)) && !(await exists(target))) {
    await copyFile(legacy, target);
  }
}
