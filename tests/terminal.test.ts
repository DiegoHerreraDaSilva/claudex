import { afterEach, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { TerminalService } from "../src/application/terminalService.js";

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0)) await close();
});

it("runs commands in a persistent project shell, isolates projects and stops the process", async () => {
  const folder = await mkdtemp(path.join(tmpdir(), "claudex-terminal-"));
  const terminals = new TerminalService();
  cleanup.push(async () => {
    await terminals.close();
    await rm(folder, { recursive: true, force: true });
  });
  terminals.open("a", folder);
  terminals.open("b", folder);
  const variable =
    process.platform === "win32"
      ? "$terminalValue = 'persistent-' + 'value'"
      : "terminalValue=persistent-; terminalValue=${terminalValue}value";
  terminals.write("a", variable + "\n");
  terminals.write(
    "a",
    process.platform === "win32"
      ? "Write-Output $terminalValue\n(Get-Location).Path\n"
      : "echo $terminalValue\npwd\n",
  );
  await expect
    .poll(() => terminals.snapshot("a").output, { timeout: 15000 })
    .toContain("persistent-value");
  await expect.poll(() => terminals.snapshot("a").output, { timeout: 15000 }).toContain(folder);
  expect(terminals.snapshot("b").output).not.toContain("persistent-value");
  terminals.clear("a");
  expect(terminals.snapshot("a").output).toBe("");
  await terminals.stop("a");
  expect(terminals.snapshot("a").running).toBe(false);
  expect(() => terminals.write("a", "echo stale\n")).toThrow();
}, 20000);
