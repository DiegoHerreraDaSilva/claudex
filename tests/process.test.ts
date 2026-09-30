import { describe, expect, it } from "vitest";
import { runCommand } from "../src/infrastructure/process.ts";

describe("runCommand", () => {
  it("captures output and nonzero exit codes without rejecting", async () => {
    const result = await runCommand(
      process.execPath,
      ["-e", "console.log('out'); console.error('err'); process.exit(7)"],
      { cwd: process.cwd() },
    );
    expect(result.code).toBe(7);
    expect(result.stdout.trim()).toBe("out");
    expect(result.stderr.trim()).toBe("err");
  });

  it("terminates a command at its timeout", async () => {
    const result = await runCommand(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
      cwd: process.cwd(),
      timeoutMs: 150,
    });
    expect(result.timedOut).toBe(true);
    expect(result.code).not.toBe(0);
  });

  it("does not start an already cancelled command", async () => {
    const result = await runCommand(process.execPath, ["-e", "console.log('started')"], {
      cwd: process.cwd(),
      signal: AbortSignal.abort(),
    });
    expect(result.aborted).toBe(true);
    expect(result.stdout).toBe("");
  });

  it("bounds captured output", async () => {
    const result = await runCommand(
      process.execPath,
      ["-e", "process.stdout.write('x'.repeat(10000))"],
      { cwd: process.cwd(), maxOutputBytes: 100 },
    );
    expect(result.stdout.length).toBeLessThanOrEqual(100);
    expect(result.truncated).toBe(true);
  });

  it("reports a missing executable as a result", async () => {
    const result = await runCommand("claudex-no-such-command", [], { cwd: process.cwd() });
    expect(result.code).not.toBe(0);
    expect(result.error).toBeTruthy();
  });
});
