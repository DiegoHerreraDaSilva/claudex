import { runGit } from "../app/git.js";
import type { ChatService } from "../app/chat.js";
import type { ProjectRegistry } from "../app/projects.js";
import { assertMissionWorktree } from "./checkpointService.js";
import { GitHubClient, GitHubError } from "../infrastructure/github.js";
import type { MissionSummary } from "../domain/missionSummary.js";
export interface PrInput {
  expectedHead: string;
  title: string;
  body: string;
  draft: boolean;
}
function prBody(summary: MissionSummary): string {
  return [
    summary.title,
    "",
    `Reviewed commit: ${summary.head}`,
    "",
    "Changes:",
    ...summary.files.slice(0, 80).map((file) => `- ${file}`),
    "",
    "Validation:",
    ...summary.verification.map(
      (run) =>
        `- ${run.kind}: ${run.status}${run.testCount === undefined ? "" : ` (${run.testCount} tests)`}`,
    ),
    `- Review: ${summary.review?.approved ? "approved" : "unavailable"}`,
    "",
    "Created with Claudex.",
  ]
    .join("\n")
    .slice(0, 20_000);
}
export class MissionGitHubService {
  constructor(
    private readonly chat: ChatService,
    private readonly registry: ProjectRegistry,
    private readonly worktreesBase: string,
    private readonly client: GitHubClient = new GitHubClient(),
  ) {}
  private context(missionId: string) {
    const project = this.registry
      .list()
      .find((item) => item.conversations.some((conversation) => conversation.id === missionId));
    const conversation = project && this.registry.getConversation(project.id, missionId);
    if (!project || !conversation)
      throw new GitHubError("MISSION_NOT_FOUND", "Mission not found", 404);
    return { project, conversation };
  }
  private async reviewed(missionId: string, expectedHead?: string) {
    const { project, conversation } = this.context(missionId);
    const summary = await this.chat.missionSummary(missionId);
    if (
      !summary ||
      summary.status !== "ready" ||
      !summary.review?.approved ||
      !summary.head ||
      !/^[a-f0-9]{40,64}$/.test(summary.head) ||
      !summary.files.length ||
      summary.verification.some((run) => run.status === "failed" || run.status === "running")
    )
      throw new GitHubError(
        "MISSION_NOT_READY",
        "Mission must pass verification and review before publishing",
        409,
      );
    if (expectedHead && summary.head !== expectedHead)
      throw new GitHubError(
        "MISSION_CHANGED",
        "The reviewed commit changed; prepare the PR again",
        409,
      );
    if (
      !conversation.worktreePath ||
      !conversation.branch ||
      !project.baseBranch ||
      summary.branch !== conversation.branch ||
      summary.baseBranch !== project.baseBranch ||
      conversation.branch === project.baseBranch
    )
      throw new GitHubError("MISSION_WORKTREE", "Mission has no valid reviewed worktree", 409);
    await assertMissionWorktree(
      project.rootPath,
      this.worktreesBase,
      conversation.worktreePath,
      conversation.branch,
    );
    const status = await runGit(conversation.worktreePath, ["status", "--porcelain"]);
    const head = (await runGit(conversation.worktreePath, ["rev-parse", "HEAD"])).stdout.trim();
    if (status.stdout.trim() || head !== summary.head)
      throw new GitHubError(
        "MISSION_CHANGED",
        "Worktree changed after review; run a new validation",
        409,
      );
    return {
      project,
      conversation,
      summary,
      cwd: conversation.worktreePath,
      branch: conversation.branch,
      baseBranch: project.baseBranch,
      head,
    };
  }
  async preview(missionId: string) {
    const { project } = this.context(missionId);
    return this.chat.withProjectOperation(project.id, async () => {
      const reviewed = await this.reviewed(missionId);
      const repo = await this.client.repository(reviewed.cwd);
      return {
        repo,
        branch: reviewed.branch,
        baseBranch: reviewed.baseBranch,
        expectedHead: reviewed.head,
        title: reviewed.summary.title.slice(0, 120),
        body: prBody(reviewed.summary),
        draft: true,
        authenticated: await this.client.authenticated(reviewed.cwd),
      };
    });
  }
  async publish(missionId: string, input: PrInput) {
    const { project } = this.context(missionId);
    return this.chat.withProjectOperation(project.id, async () => {
      const reviewed = await this.reviewed(missionId, input.expectedHead);
      const repo = await this.client.repository(reviewed.cwd);
      const allowed = await this.chat
        .broker(project.id, missionId, reviewed.cwd)
        .authorize(
          "net",
          "GitHub",
          `Publish ${reviewed.head} as ${repo}:${reviewed.branch} → ${reviewed.baseBranch} and create a ${input.draft ? "draft " : ""}PR`,
          new AbortController().signal,
        );
      if (!allowed)
        throw new GitHubError(
          "PERMISSION_DENIED",
          "GitHub publication denied by autonomy policy",
          403,
        );
      await this.reviewed(missionId, input.expectedHead);
      await this.chat.recordMissionEvent(missionId, {
        type: "github:publishing",
        level: "info",
        message: "Publishing reviewed mission",
        payload: {
          repo,
          head: reviewed.head,
          branch: reviewed.branch,
          baseBranch: reviewed.baseBranch,
        },
      });
      try {
        const pullRequest = await this.client.create({
          cwd: reviewed.cwd,
          repo,
          branch: reviewed.branch,
          baseBranch: reviewed.baseBranch,
          head: reviewed.head,
          title: input.title,
          body: input.body,
          draft: input.draft,
        });
        if (
          pullRequest.isCrossRepository ||
          pullRequest.headRefName !== reviewed.branch ||
          pullRequest.baseRefName !== reviewed.baseBranch ||
          pullRequest.headRefOid !== reviewed.head ||
          pullRequest.state !== "OPEN"
        )
          throw new GitHubError(
            "GITHUB_CHANGED",
            "PR does not identify the reviewed commit; check the remote branch",
            409,
          );
        await this.chat.recordMissionEvent(missionId, {
          type: "github:pull-request",
          level: "success",
          message: `PR #${pullRequest.number}`,
          payload: { pullRequest, repo },
        });
        return pullRequest;
      } catch (error) {
        await this.chat.recordMissionEvent(missionId, {
          type: "github:failed",
          level: "error",
          message: error instanceof Error ? error.message : "GitHub publication failed",
        });
        throw error;
      }
    });
  }
  async checks(missionId: string) {
    const { project, conversation } = this.context(missionId);
    return this.chat.withProjectOperation(project.id, async () => {
      const summary = await this.chat.missionSummary(missionId);
      if (!summary?.pullRequest || !conversation.branch || !project.baseBranch)
        throw new GitHubError(
          "GITHUB_NO_PR",
          "Create a pull request before querying CI checks",
          404,
        );
      const repo = await this.client.repository(project.rootPath);
      if (repo.toLowerCase() !== summary.githubRepo?.toLowerCase())
        throw new GitHubError("GITHUB_REMOTE", "Origin changed after PR creation", 409);
      if (
        !(await this.chat
          .broker(project.id, missionId)
          .authorize(
            "net",
            "GitHub",
            `Read CI checks for ${repo} PR #${summary.pullRequest.number}`,
            new AbortController().signal,
          ))
      )
        throw new GitHubError("PERMISSION_DENIED", "GitHub query denied by autonomy policy", 403);
      const snapshot = await this.client.checks(
        project.rootPath,
        repo,
        summary.pullRequest.number,
        summary.head,
      );
      if (
        snapshot.pullRequest.isCrossRepository ||
        snapshot.pullRequest.headRefName !== conversation.branch ||
        snapshot.pullRequest.baseRefName !== project.baseBranch
      )
        throw new GitHubError("GITHUB_CHANGED", "PR branch does not match this mission", 409);
      await this.chat.recordMissionEvent(missionId, {
        type: "github:checks",
        level: snapshot.status === "failed" ? "warn" : "info",
        message: `CI: ${snapshot.status}`,
        payload: { ci: snapshot },
      });
      return snapshot;
    });
  }
}
