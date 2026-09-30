import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { z } from "zod";
import { runCommand, type CommandResult } from "./process.js";
import type { PullRequest, CiSnapshot } from "../domain/devops.js";
export class GitHubError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 502,
  ) {
    super(message);
  }
}
export function parseGitHubRemote(remote: string): string {
  const value = remote.trim();
  const match =
    /^(?:https:\/\/github\.com\/|git@github\.com:)([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?$/i.exec(
      value,
    );
  if (
    !match ||
    [match[1], match[2]].some((piece) => piece === "." || piece === ".." || piece.startsWith("-"))
  )
    throw new GitHubError(
      "GITHUB_REMOTE",
      "Origin must identify a GitHub repository without embedded credentials",
      400,
    );
  return `${match[1]}/${match[2]}`;
}
const safeUrl = z
  .string()
  .max(2000)
  .refine((value) => {
    if (!value) return true;
    try {
      const url = new URL(value);
      return url.protocol === "https:" && !url.username && !url.password;
    } catch {
      return false;
    }
  });
const prSchema = z.object({
  number: z.number().int().positive(),
  url: safeUrl,
  title: z.string().max(1000),
  state: z.enum(["OPEN", "CLOSED", "MERGED"]),
  isDraft: z.boolean(),
  isCrossRepository: z.boolean(),
  headRefName: z.string().max(300),
  baseRefName: z.string().max(300),
  headRefOid: z.string().regex(/^[a-f0-9]{40,64}$/),
});
const checksSchema = z
  .array(
    z.object({
      name: z.string().max(1000),
      bucket: z.enum(["pass", "fail", "pending", "skipping", "cancel"]),
      state: z.string().max(100),
      link: safeUrl,
      workflow: z.string().max(1000).optional(),
    }),
  )
  .max(200);
const fields =
  "number,url,title,state,isDraft,isCrossRepository,headRefName,baseRefName,headRefOid";
export interface PublishInput {
  cwd: string;
  repo: string;
  branch: string;
  baseBranch: string;
  head: string;
  title: string;
  body: string;
  draft: boolean;
}
function validPr(pr: PullRequest, repo: string): PullRequest {
  if (pr.url.toLowerCase() !== `https://github.com/${repo}/pull/${pr.number}`.toLowerCase())
    throw new GitHubError("GITHUB_RESPONSE", "GitHub returned an unexpected pull request URL");
  return pr;
}
function decodeJson<T>(raw: string, schema: z.ZodType<T>): T {
  try {
    return schema.parse(JSON.parse(raw));
  } catch {
    throw new GitHubError("GITHUB_RESPONSE", "GitHub returned invalid JSON data");
  }
}
export class GitHubClient {
  constructor(private readonly run: typeof runCommand = runCommand) {}
  private execute(
    command: string,
    args: string[],
    cwd: string,
    timeoutMs = 30_000,
  ): Promise<CommandResult> {
    return this.run(command, args, {
      cwd,
      timeoutMs,
      maxOutputBytes: 256_000,
      env: { GH_PROMPT_DISABLED: "1", GIT_TERMINAL_PROMPT: "0" },
    });
  }
  async repository(cwd: string): Promise<string> {
    const fetch = await this.execute("git", ["remote", "get-url", "origin"], cwd);
    if (fetch.code !== 0)
      throw new GitHubError("GITHUB_REMOTE", "Project has no origin remote", 400);
    const repo = parseGitHubRemote(fetch.stdout);
    const push = await this.execute("git", ["remote", "get-url", "--push", "origin"], cwd);
    if (push.code !== 0 || parseGitHubRemote(push.stdout).toLowerCase() !== repo.toLowerCase())
      throw new GitHubError("GITHUB_REMOTE", "Origin fetch and push repositories must match", 400);
    return repo;
  }
  async authenticated(cwd: string): Promise<boolean> {
    return (
      (await this.execute("gh", ["auth", "status", "--hostname", "github.com"], cwd)).code === 0
    );
  }
  async find(
    cwd: string,
    repo: string,
    branch: string,
    baseBranch: string,
  ): Promise<PullRequest | undefined> {
    const result = await this.execute(
      "gh",
      [
        "pr",
        "list",
        "--repo",
        repo,
        "--head",
        branch,
        "--base",
        baseBranch,
        "--state",
        "open",
        "--limit",
        "100",
        "--json",
        fields,
      ],
      cwd,
    );
    if (result.code !== 0 || result.truncated)
      throw new GitHubError(
        "GITHUB_QUERY",
        "Could not query existing pull requests; check GitHub authentication and connectivity",
      );
    const items = decodeJson(result.stdout, z.array(prSchema).max(100));
    const match = items.find(
      (pr) => !pr.isCrossRepository && pr.headRefName === branch && pr.baseRefName === baseBranch,
    );
    return match ? validPr(match, repo) : undefined;
  }
  async create(input: PublishInput): Promise<PullRequest> {
    if (!(await this.authenticated(input.cwd)))
      throw new GitHubError(
        "GITHUB_AUTH",
        "GitHub CLI is not authenticated. Run gh auth login",
        503,
      );
    const existing = await this.find(input.cwd, input.repo, input.branch, input.baseBranch);
    if (existing?.headRefOid === input.head) return existing;
    const pushed = await this.execute(
      "git",
      [
        "-c",
        "credential.helper=",
        "-c",
        "credential.helper=!gh auth git-credential",
        "push",
        "--porcelain",
        `https://github.com/${input.repo}.git`,
        `${input.head}:refs/heads/${input.branch}`,
      ],
      input.cwd,
      120_000,
    );
    if (pushed.code !== 0)
      throw new GitHubError(
        "GITHUB_PUSH",
        "Could not publish the reviewed commit. Check Git credentials and remote branch history; force push is disabled",
      );
    if (existing) return this.view(input.cwd, input.repo, existing.number);
    const dir = await mkdtemp(path.join(tmpdir(), "claudex-pr-"));
    try {
      const bodyFile = path.join(dir, "body.md");
      await writeFile(bodyFile, input.body, "utf8");
      const created = await this.execute(
        "gh",
        [
          "pr",
          "create",
          "--repo",
          input.repo,
          "--head",
          input.branch,
          "--base",
          input.baseBranch,
          "--title",
          input.title,
          "--body-file",
          bodyFile,
          ...(input.draft ? ["--draft"] : []),
        ],
        input.cwd,
        60_000,
      );
      if (created.code === 0) {
        const url = created.stdout.trim();
        const match = /^https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/(\d+)$/.exec(url);
        if (
          !match ||
          url.toLowerCase() !== `https://github.com/${input.repo}/pull/${match[1]}`.toLowerCase()
        )
          throw new GitHubError(
            "GITHUB_RESPONSE",
            "GitHub returned an unexpected pull request URL",
          );
        return this.view(input.cwd, input.repo, Number(match[1]));
      }
      const recovered = await this.find(input.cwd, input.repo, input.branch, input.baseBranch);
      if (recovered) return recovered;
      throw new GitHubError(
        "GITHUB_CREATE",
        "PR creation did not return a confirmed result. Retry queries the existing PR before creating another",
      );
    } finally {
      await rm(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    }
  }
  async view(cwd: string, repo: string, number: number): Promise<PullRequest> {
    const result = await this.execute(
      "gh",
      ["pr", "view", String(number), "--repo", repo, "--json", fields],
      cwd,
    );
    if (result.code !== 0 || result.truncated)
      throw new GitHubError("GITHUB_QUERY", "Could not read pull request details");
    return validPr(decodeJson(result.stdout, prSchema), repo);
  }
  async checks(
    cwd: string,
    repo: string,
    number: number,
    reviewedHead?: string,
  ): Promise<CiSnapshot> {
    const pullRequest = await this.view(cwd, repo, number);
    const result = await this.execute(
      "gh",
      ["pr", "checks", String(number), "--repo", repo, "--json", "name,bucket,state,link,workflow"],
      cwd,
    );
    const absent =
      result.code === 1 && !result.stdout.trim() && /no checks reported/i.test(result.stderr);
    if (
      (!absent && ![0, 1, 8].includes(result.code)) ||
      result.truncated ||
      (!absent && !result.stdout.trim())
    )
      throw new GitHubError(
        "GITHUB_CHECKS",
        "Could not read CI checks; no successful result is assumed",
      );
    const checks = absent ? [] : decodeJson(result.stdout, checksSchema);
    const confirmed = await this.view(cwd, repo, number);
    if (confirmed.headRefOid !== pullRequest.headRefOid)
      throw new GitHubError(
        "GITHUB_CHANGED",
        "PR head changed while querying CI; query the checks again",
        409,
      );
    return {
      pullRequest,
      checks,
      status: !checks.length
        ? "none"
        : checks.some((check) => check.bucket === "fail" || check.bucket === "cancel")
          ? "failed"
          : checks.some((check) => check.bucket === "pending")
            ? "pending"
            : checks.every((check) => check.bucket === "skipping")
              ? "skipped"
              : "passed",
      headMatchesReview: !!reviewedHead && pullRequest.headRefOid === reviewedHead,
      checkedAt: Date.now(),
    };
  }
}
