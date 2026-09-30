import { describe, expect, it } from "vitest";
import { TerminalService } from "../src/application/terminalService.js";
import { tmpdir } from "node:os";
describe("terminal", () => {
  it("streams output, refuses overlapping runs and supports cancellation", async () => {
    const service = new TerminalService();
    const output: string[] = [];
    const run = service.run(
      "p",
      tmpdir(),
      process.platform === "win32"
        ? 'Write-Output "hello"; Start-Sleep -Seconds 10'
        : "printf hello; sleep 10",
      (event) => {
        if (event.text && event.stream === "stdout") {
          output.push(event.text);
          service.stop("p");
        }
      },
    );
    await expect(service.run("p", tmpdir(), "echo overlap", () => undefined)).rejects.toThrow(
      "already running",
    );
    const result = await run;
    expect(output.join("")).toContain("hello");
    expect(result.aborted).toBe(true);
    await expect(
      service.run("p", tmpdir(), "echo blocked", () => undefined, "manual"),
    ).rejects.toThrow("manual");
  }, 30_000);
});
