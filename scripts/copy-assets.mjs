import { cp, mkdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");

const targets = [{ src: resolve(root, "src", "chat"), dest: resolve(root, "dist", "chat") }];

for (const { src, dest } of targets) {
  if (!existsSync(src)) {
    console.error(`[copy-assets] source not found: ${src}`);
    process.exit(1);
  }
  await rm(dest, { recursive: true, force: true });
  await mkdir(dirname(dest), { recursive: true });
  await cp(src, dest, { recursive: true });
  console.log(`[copy-assets] copied ${src} -> ${dest}`);
}

const vendor = resolve(root, "dist", "chat", "vendor");
await mkdir(vendor, { recursive: true });
await cp(
  resolve(root, "node_modules", "marked", "lib", "marked.esm.js"),
  resolve(vendor, "marked.js"),
);
await cp(
  resolve(root, "node_modules", "dompurify", "dist", "purify.es.mjs"),
  resolve(vendor, "purify.js"),
);
