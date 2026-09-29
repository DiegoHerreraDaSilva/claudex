import { rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");

await rm(resolve(root, "dist"), { recursive: true, force: true });
await rm(resolve(root, ".worktrees"), { recursive: true, force: true });

console.log("[clean] removed dist/ and .worktrees/");
