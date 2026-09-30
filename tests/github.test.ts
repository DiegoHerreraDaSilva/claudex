import { readFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import { GitHubClient, parseGitHubRemote } from "../src/infrastructure/github.js";
const head = "a".repeat(40);
const pr = {
  number: 7,
  url: "https://github.com/owner/repo/pull/7",
  title: "Add health",
  state: "OPEN",
  isDraft: true,
  isCrossRepository: false,
  headRefName: "claudex/health",
  baseRefName: "main",
  headRefOid: head,
};
const result = (stdout = "", code = 0, stderr = "") => ({ stdout, code, stderr, durationMs: 1 });
const input = {
  cwd: process.cwd(),
  repo: "owner/repo",
  branch: "claudex/health",
  baseBranch: "main",
  head,
  title: "Add health",
  body: "First line\n\nValidation: passed",
  draft: true,
};
describe("GitHub CLI adapter", () => {
  it("accepts GitHub remotes and rejects credentials, other hosts and malformed repositories", () => {
    expect(parseGitHubRemote("git@github.com:owner/repo.git")).toBe("owner/repo");
    expect(parseGitHubRemote("https://github.com/owner/repo.git")).toBe("owner/repo");
    for (const remote of [
      "https://token@github.com/owner/repo",
      "https://evil.example/owner/repo",
      "https://github.com/owner/repo/extra",
      "file:///tmp/repo",
      "--upload-pack=bad",
      "https://github.com/owner/repo?token=secret",
    ])
      expect(() => parseGitHubRemote(remote)).toThrow();
  });
  it("does not reuse a matching branch from another fork", async () => {
    const run = async () => result(JSON.stringify([{ ...pr, isCrossRepository: true }]));
    expect(
      await new GitHubClient(run).find(input.cwd, input.repo, input.branch, input.baseBranch),
    ).toBeUndefined();
  });
  it("creates a PR with exact multiline body and recovers the same PR on retry", async () => {
    let created = false;
    const commands: string[][] = [];
    const run = vi.fn(async (command: string, args: string[]) => {
      commands.push([command, ...args]);
      if (args[0] === "auth") return result();
      if (args.includes("list")) return result(JSON.stringify(created ? [pr] : []));
      if (args.includes("push")) return result();
      if (args.includes("create")) {
        expect(await readFile(args[args.indexOf("--body-file") + 1]!, "utf8")).toBe(input.body);
        created = true;
        return result(pr.url);
      }
      if (args.includes("view")) return result(JSON.stringify(pr));
      throw new Error("unexpected command");
    });
    const client = new GitHubClient(run);
    expect(await client.create(input)).toMatchObject({ number: 7, headRefOid: head });
    expect(await client.create(input)).toMatchObject({ number: 7 });
    expect(commands.filter((command) => command.includes("create"))).toHaveLength(1);
    expect(commands.filter((command) => command.includes("push"))).toHaveLength(1);
  });
  it("does not publish without authentication and does not force push conflicting history", async () => {
    const unauth = vi.fn(async () => result("", 1, "not logged in"));
    await expect(new GitHubClient(unauth).create(input)).rejects.toMatchObject({
      code: "GITHUB_AUTH",
    });
    expect(unauth).toHaveBeenCalledTimes(1);
    const run = vi.fn(async (_command: string, args: string[]) =>
      args[0] === "auth"
        ? result()
        : args.includes("list")
          ? result("[]")
          : result("", 1, "non-fast-forward"),
    );
    await expect(new GitHubClient(run).create(input)).rejects.toMatchObject({
      code: "GITHUB_PUSH",
    });
    expect(run.mock.calls.some(([, args]) => args.includes("--force"))).toBe(false);
  });
  it("recovers creation after an uncertain response instead of creating a duplicate", async () => {
    let created = false;
    const run = async (_command: string, args: string[]) => {
      if (args[0] === "auth" || args.includes("push")) return result();
      if (args.includes("list")) return result(JSON.stringify(created ? [pr] : []));
      if (args.includes("create")) {
        created = true;
        return { ...result("", -1), timedOut: true };
      }
      throw new Error("unexpected command");
    };
    expect(await new GitHubClient(run).create(input)).toMatchObject({ number: 7 });
  });
  it("rejects CI snapshots when the PR changes during the query", async () => {
    let views = 0;
    const run = async (_command: string, args: string[]) =>
      args.includes("view")
        ? result(JSON.stringify({ ...pr, headRefOid: ++views === 1 ? head : "b".repeat(40) }))
        : result(JSON.stringify([{ name: "Tests", bucket: "pass", state: "SUCCESS", link: "" }]));
    await expect(
      new GitHubClient(run).checks(input.cwd, input.repo, 7, head),
    ).rejects.toMatchObject({ code: "GITHUB_CHANGED" });
  });
  it("distinguishes pending, failed, absent and unavailable checks and rejects unsafe links", async () => {
    const run = vi.fn(async (_command: string, args: string[]) =>
      args.includes("view")
        ? result(JSON.stringify(pr))
        : result(
            JSON.stringify([
              {
                name: "Tests",
                bucket: "pending",
                state: "IN_PROGRESS",
                link: "https://github.com/owner/repo/actions/runs/1",
                workflow: "CI",
              },
            ]),
            8,
          ),
    );
    const client = new GitHubClient(run);
    expect(await client.checks(input.cwd, input.repo, 7, head)).toMatchObject({
      status: "pending",
      headMatchesReview: true,
    });
    run.mockImplementation(async (_command, args) =>
      args.includes("view") ? result(JSON.stringify(pr)) : result("", 1, "no checks reported"),
    );
    expect(await client.checks(input.cwd, input.repo, 7, head)).toMatchObject({
      status: "none",
      checks: [],
    });
    run.mockImplementation(async (_command, args) =>
      args.includes("view")
        ? result(JSON.stringify(pr))
        : result(
            JSON.stringify([{ name: "Tests", bucket: "fail", state: "FAILURE", link: "" }]),
            1,
          ),
    );
    expect(await client.checks(input.cwd, input.repo, 7, "b".repeat(40))).toMatchObject({
      status: "failed",
      headMatchesReview: false,
    });
    run.mockImplementation(async (_command, args) =>
      args.includes("view")
        ? result(JSON.stringify(pr))
        : result(
            JSON.stringify([{ name: "Tests", bucket: "skipping", state: "SKIPPED", link: "" }]),
          ),
    );
    expect(await client.checks(input.cwd, input.repo, 7, head)).toMatchObject({
      status: "skipped",
    });
    run.mockImplementation(async (_command, args) =>
      args.includes("view") ? result(JSON.stringify(pr)) : result("", 1, "network unavailable"),
    );
    await expect(client.checks(input.cwd, input.repo, 7, head)).rejects.toMatchObject({
      code: "GITHUB_CHECKS",
    });
    run.mockImplementation(async (_command, args) =>
      args.includes("view")
        ? result(JSON.stringify(pr))
        : result(
            JSON.stringify([
              { name: "Injected", bucket: "pass", state: "SUCCESS", link: "javascript:alert(1)" },
            ]),
          ),
    );
    await expect(client.checks(input.cwd, input.repo, 7, head)).rejects.toMatchObject({
      code: "GITHUB_RESPONSE",
    });
  });
});
