import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { verifyMission } from "../src/application/verificationService.ts";

const dirs: string[] = [];
async function repo(pkg?: object) {
  const dir = await mkdtemp(path.join(tmpdir(), "claudex-verify-"));
  dirs.push(dir);
  if (pkg) await writeFile(path.join(dir, "package.json"), JSON.stringify(pkg));
  return dir;
}
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("verifyMission", () => {
  it("reports missing scripts and unsupported stacks as skipped", async () => {
    const results = await verifyMission({ missionId: "m", worktreePath: await repo() });
    expect(results).toHaveLength(5);
    expect(results.every((run) => run.status === "skipped")).toBe(true);
  });

  it("executes available npm scripts, captures test counts and continues after failure", async () => {
    const dir = await repo({
      scripts: {
        typecheck: 'node -e "process.exit(2)"',
        test: "node -e \"console.log('Tests  3 passed (3)')\"",
        lint: "node -e \"console.log('lint ok')\"",
      },
    });
    const events: string[] = [];
    const results = await verifyMission({
      missionId: "m",
      worktreePath: dir,
      onEvent: async (event) => {
        events.push(event.type);
      },
    });
    expect(results.find((run) => run.kind === "typecheck")?.status).toBe("failed");
    expect(results.find((run) => run.kind === "tests")).toMatchObject({
      status: "passed",
      testCount: 3,
    });
    expect(results.find((run) => run.kind === "lint")?.status).toBe("passed");
    expect(events.filter((type) => type === "verification:completed")).toHaveLength(5);
  }, 30_000);

  it("closes a running verification before propagating cancellation", async () => {
    const dir = await repo({ scripts: { test: "node test.js" } });
    const controller = new AbortController();
    const events: { type: string; payload?: Record<string, unknown> }[] = [];
    await expect(
      verifyMission({
        missionId: "m",
        worktreePath: dir,
        signal: controller.signal,
        onEvent: async (event) => {
          events.push(event);
        },
        run: async () => {
          controller.abort();
          return { code: -1, stdout: "", stderr: "", durationMs: 1, aborted: true };
        },
      }),
    ).rejects.toThrow();
    const completed = events.filter((event) => event.type === "verification:completed");
    expect(completed.at(-1)?.payload?.verification).toMatchObject({
      kind: "tests",
      status: "skipped",
      summary: "Verification cancelled",
    });
  });

  it("does not mark an invalid package.json as an unsupported stack", async () => {
    const dir = await repo();
    await writeFile(path.join(dir, "package.json"), "{invalid");
    const results = await verifyMission({ missionId: "m", worktreePath: dir });
    expect(results.some((run) => run.status === "failed")).toBe(true);
  });

  it("treats audit network errors as skipped and actual vulnerabilities as failed", async () => {
    const dir = await repo({});
    await writeFile(path.join(dir, "package-lock.json"), "{}");
    for (const [stdout, status] of [
      [JSON.stringify({ error: { code: "ENOTFOUND" } }), "skipped"],
      [JSON.stringify({ metadata: { vulnerabilities: { total: 2 } } }), "failed"],
    ]) {
      const results = await verifyMission({
        missionId: "m",
        worktreePath: dir,
        run: async () => ({ code: 1, stdout, stderr: "", durationMs: 1 }),
      });
      expect(results.find((run) => run.kind === "security")?.status).toBe(status);
    }
  });
});
