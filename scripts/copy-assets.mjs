import { cp, mkdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");

const src = resolve(root, "src", "dashboard");
const dest = resolve(root, "dist", "dashboard");

if (!existsSync(src)) {
  console.error(`[copy-assets] dashboard source not found: ${src}`);
  process.exit(1);
}

await rm(dest, { recursive: true, force: true });
await mkdir(dirname(dest), { recursive: true });
await cp(src, dest, { recursive: true });

console.log(`[copy-assets] copied ${src} -> ${dest}`);
