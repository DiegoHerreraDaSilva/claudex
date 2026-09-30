import { readFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { ChatService } from "../app/chat.js";
import type { ProjectRegistry } from "../app/projects.js";
import { runGit } from "../app/git.js";
import { assertMissionWorktree } from "./checkpointService.js";
import { GitHubError } from "../infrastructure/github.js";
import { localBrowserUrl, runBrowserQA, type BrowserChannel } from "../infrastructure/browserQA.js";
import type { VerificationRun } from "../domain/verification.js";

export class MissionBrowserService {
  constructor(
    private readonly chat: ChatService,
    private readonly registry: ProjectRegistry,
    private readonly worktreesBase: string,
    private readonly dataDir: string,
    private readonly run = runBrowserQA,
  ) {}
  async check(
    missionId: string,
    input: { url: string; channel: BrowserChannel; expectedHead: string },
  ) {
    const url = localBrowserUrl(input.url);
    const project = this.registry
      .list()
      .find((item) => item.conversations.some((item) => item.id === missionId));
    const conversation = project && this.registry.getConversation(project.id, missionId);
    if (!project || !conversation)
      throw new GitHubError("MISSION_NOT_FOUND", "Mission not found", 404);
    return this.chat.withProjectOperation(project.id, async () => {
      const validate = async () => {
        const summary = await this.chat.missionSummary(missionId);
        if (
          !summary ||
          !["ready", "failed"].includes(summary.status) ||
          !summary.head ||
          summary.head !== input.expectedHead ||
          !conversation.worktreePath ||
          !conversation.branch ||
          conversation.branch !== summary.branch
        )
          throw new GitHubError("MISSION_CHANGED", "Validate the mission before Browser QA", 409);
        await assertMissionWorktree(
          project.rootPath,
          this.worktreesBase,
          conversation.worktreePath,
          conversation.branch,
        );
        const head = (await runGit(conversation.worktreePath, ["rev-parse", "HEAD"])).stdout.trim();
        const dirty = (
          await runGit(conversation.worktreePath, ["status", "--porcelain"])
        ).stdout.trim();
        if (head !== input.expectedHead || dirty)
          throw new GitHubError("MISSION_CHANGED", "Worktree changed after validation", 409);
      };
      await validate();
      if (
        !(await this.chat
          .broker(project.id, missionId)
          .authorize(
            "tests",
            "Browser QA",
            `${input.channel}: ${url}`,
            new AbortController().signal,
          ))
      )
        throw new GitHubError("PERMISSION_DENIED", "Browser QA denied by autonomy policy", 403);
      await validate();
      const run: VerificationRun = {
        id: randomUUID(),
        missionId,
        kind: "browser",
        status: "running",
        summary: "Browser QA",
        at: Date.now(),
      };
      const record = () =>
        this.chat.recordMissionEvent(missionId, {
          type: "browser:checked",
          level: run.status === "failed" ? "error" : run.status === "passed" ? "success" : "info",
          message: `Browser QA: ${run.status}`,
          payload: { verification: { ...run } },
        });
      await record();
      try {
        const report = await this.run({
          url,
          channel: input.channel,
          screenshot: path.join(this.dataDir, "browser-qa", run.id, "page.png"),
        });
        await validate();
        Object.assign(run, {
          status: report.errors.length ? "failed" : "passed",
          summary: report.errors.length
            ? "Browser QA found errors"
            : "Page loaded without detected errors",
          output: [
            `${report.channel}: ${report.url}`,
            `Title: ${report.title}`,
            ...report.errors,
          ].join("\n"),
          durationMs: report.durationMs,
          screenshot: report.captured
            ? `/api/missions/${encodeURIComponent(missionId)}/browser-qa/${run.id}/screenshot`
            : undefined,
          head: input.expectedHead,
        });
      } catch (error) {
        Object.assign(run, {
          status: "failed",
          summary: "Browser QA unavailable or mission changed",
          output: error instanceof Error ? error.message : String(error),
        });
      }
      await record();
      return run;
    });
  }
  async screenshot(missionId: string, runId: string) {
    if (!/^[a-f0-9-]{36}$/.test(runId))
      throw new GitHubError("QA_NOT_FOUND", "Capture not found", 404);
    const summary = await this.chat.missionSummary(missionId);
    const run = summary?.verification.find(
      (item) => item.kind === "browser" && item.id === runId && item.screenshot,
    );
    if (!run) throw new GitHubError("QA_NOT_FOUND", "Capture not found", 404);
    try {
      return await readFile(path.join(this.dataDir, "browser-qa", runId, "page.png"));
    } catch {
      throw new GitHubError("QA_NOT_FOUND", "Capture not found", 404);
    }
  }
}
