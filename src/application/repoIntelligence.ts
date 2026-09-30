import { readdir, readFile, lstat, realpath } from "node:fs/promises";
import path from "node:path";
import { runGit } from "../app/git.js";
export interface RepoFile {
  file: string;
  text: string;
  symbols: string[];
}
const excluded =
  /(^|\/)(node_modules|\.git|dist|build|coverage|release|\.claudex|\.worktrees|\.codex|\.agents|vendor|\.venv|\.aws|\.ssh)(\/|$)|(^|\/)(\.env(?:\..*)?|.*\.(?:pem|key|p12|pfx)|(?:credentials|secrets)(?:\.[\w-]+)?\.json|package-lock\.json|yarn\.lock|pnpm-lock\.yaml)$/i;
const textFile = /\.(?:[cm]?[jt]sx?|json|md|html|css|scss|py|rs|go|java|ya?ml|toml|sh|sql|txt)$/i;
export async function repositoryFiles(
  root: string,
): Promise<{ files: RepoFile[]; truncated: boolean }> {
  const canonical = await realpath(root);
  const git = await runGit(
    root,
    ["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
    true,
  );
  let names: string[] = [];
  let truncated = false;
  if (git.code === 0) names = [...new Set(git.stdout.split("\0").filter(Boolean))];
  else {
    let visited = 0;
    const walk = async (dir: string): Promise<void> => {
      if (++visited > 5000 || dir.split("/").length > 12) {
        truncated = true;
        return;
      }
      for (const entry of await readdir(path.join(root, dir), { withFileTypes: true })) {
        const name = dir ? `${dir}/${entry.name}` : entry.name;
        if (excluded.test(name) || entry.isSymbolicLink()) continue;
        if (names.length >= 3000) {
          truncated = true;
          return;
        }
        if (entry.isDirectory()) await walk(name);
        else if (entry.isFile()) names.push(name);
      }
    };
    await walk("");
  }
  const candidates = names.filter((name) => !excluded.test(name) && textFile.test(name)).sort();
  if (candidates.length > 2000) truncated = true;
  const files: RepoFile[] = [];
  let bytes = 0;
  for (const file of candidates.slice(0, 2000)) {
    const target = path.resolve(root, file);
    const relative = path.relative(canonical, await realpath(target).catch(() => canonical));
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) continue;
    try {
      const info = await lstat(target);
      if (!info.isFile() || info.isSymbolicLink() || info.size > 256_000) {
        truncated = true;
        continue;
      }
      if (bytes + info.size > 8_000_000) {
        truncated = true;
        break;
      }
      const text = await readFile(target, "utf8");
      if (text.includes("\0")) continue;
      bytes += info.size;
      const symbols = [
        ...text.matchAll(/\b(?:function|class|interface|type|def|fn|const)\s+([A-Za-z_$][\w$]*)/g),
      ].map((match) => match[1]);
      files.push({ file, text, symbols });
    } catch {
      continue;
    }
  }
  return { files, truncated };
}
export async function inspectRepository(root: string) {
  const scan = await repositoryFiles(root);
  const names = new Set(scan.files.map((file) => file.file));
  const edges: { from: string; to: string }[] = [];
  for (const file of scan.files.filter((file) => /\.[cm]?[jt]sx?$/.test(file.file))) {
    const imports = [
      ...file.text.matchAll(/(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)["']([^"']+)["']/g),
    ];
    for (const match of imports) {
      if (!match[1].startsWith(".")) continue;
      const base = path.posix.normalize(path.posix.join(path.posix.dirname(file.file), match[1]));
      const stem = base.replace(/\.[cm]?js$/, "");
      const to = [
        base,
        ...[".ts", ".tsx", ".js", ".jsx", ".mts", ".mjs", "/index.ts", "/index.js"].map(
          (ext) => stem + ext,
        ),
      ].find((name) => names.has(name));
      if (to && !edges.some((edge) => edge.from === file.file && edge.to === to))
        edges.push({ from: file.file, to });
    }
  }
  let manifest: Record<string, unknown> = {};
  try {
    manifest = JSON.parse(scan.files.find((file) => file.file === "package.json")?.text ?? "{}");
  } catch {}
  const deps = (value: unknown): Record<string, string> =>
    value && typeof value === "object"
      ? Object.fromEntries(
          Object.entries(value).filter(
            (entry): entry is [string, string] => typeof entry[1] === "string",
          ),
        )
      : {};
  const dependencies = { ...deps(manifest.dependencies), ...deps(manifest.devDependencies) };
  const entryPoints = [
    ...new Set(
      [
        manifest.main,
        manifest.module,
        ...Object.values(deps(manifest.bin)),
        ...scan.files
          .map((file) => file.file)
          .filter((file) => /(^|\/)(main|index|app|server)\.[cm]?[jt]sx?$/.test(file)),
      ].filter((value): value is string => typeof value === "string" && names.has(value)),
    ),
  ];
  return {
    files: scan.files.map(({ file, symbols }) => ({ file, symbols })),
    fileCount: scan.files.length,
    dependencies,
    entryPoints,
    truncated: scan.truncated,
    graph: { nodes: [...names].filter((name) => /\.[cm]?[jt]sx?$/.test(name)), edges },
  };
}
