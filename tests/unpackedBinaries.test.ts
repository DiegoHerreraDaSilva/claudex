import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { unpackedClaudeBinary, unpackedRoot } from "../src/agents/claude.js";
import { unpackedCodex } from "../src/agents/codex.js";

function fakeApp() {
  const base = mkdtempSync(path.join(os.tmpdir(), "claudex-asar-"));
  const unpacked = path.join(
    base,
    "app.asar.unpacked",
    "node_modules",
    "@anthropic-ai",
    "claude-agent-sdk",
    "node_modules",
    "@anthropic-ai",
    "claude-agent-sdk-win32-x64",
  );
  mkdirSync(unpacked, { recursive: true });
  writeFileSync(path.join(unpacked, "claude.exe"), "");
  const codexBase = path.join(
    base,
    "app.asar.unpacked",
    "node_modules",
    "@openai",
    "codex",
    "node_modules",
    "@openai",
    "codex-win32-x64",
    "vendor",
    "x86_64-pc-windows-msvc",
  );
  mkdirSync(path.join(codexBase, "bin"), { recursive: true });
  writeFileSync(path.join(codexBase, "bin", "codex.exe"), "");
  return { base, moduleDir: path.join(base, "app.asar", "dist", "agents") };
}

describe("binários desempacotados", () => {
  it("ignora quando não está dentro de app.asar", () => {
    expect(unpackedRoot(path.join(os.tmpdir(), "dist", "agents"))).toBeUndefined();
    expect(unpackedClaudeBinary(path.join(os.tmpdir(), "dist", "agents"))).toBeUndefined();
  });
  it("aponta o Claude e o Codex para app.asar.unpacked", () => {
    const { base, moduleDir } = fakeApp();
    expect(unpackedClaudeBinary(moduleDir, "win32", "x64")).toBe(
      path.join(
        base,
        "app.asar.unpacked",
        "node_modules",
        "@anthropic-ai",
        "claude-agent-sdk",
        "node_modules",
        "@anthropic-ai",
        "claude-agent-sdk-win32-x64",
        "claude.exe",
      ),
    );
    expect(unpackedCodex(unpackedRoot(moduleDir), "win32", "x64")?.executablePath).toContain(
      "app.asar.unpacked",
    );
  });
});
