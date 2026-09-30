import {
  PermissionBroker,
  isAutonomy,
  type PermissionAction,
} from "../application/permissionBroker.js";
import {
  PermissionCoordinator,
  type PermissionNotice,
} from "../application/permissionCoordinator.js";
import type { AutonomyMode } from "../domain/mission.js";
import { CheckpointService, assertMissionWorktree } from "../application/checkpointService.js";
import { existsSync } from "node:fs";
import path from "node:path";
import { v4 as uuid } from "uuid";
import { MissionService } from "../application/missionService.js";
import type { MissionChannel } from "../application/missionService.js";
import { buildPreview, type MissionPreview } from "../application/missionPreview.js";
import type { OrchestratorConfig } from "../config.js";
import { parseDiffFiles } from "../domain/diff.js";
import type { MissionSummary } from "../domain/missionSummary.js";
import type { MissionEventInput, TaskEvent } from "../domain/event.js";
import { TypedEmitter } from "../events.js";
import { EventStore } from "../infrastructure/persistence/eventStore.js";
import type { JevClient } from "../jev.js";
import {
  checkout,
  currentBranch,
  deleteBranch,
  diffAgainst,
  mergeBranch,
  removeWorktree,
  resetHard,
  runGit,
} from "./git.js";
import { ProjectRegistry, type ChatMessage, type ChatRole, type Project } from "./projects.js";

export interface ChatDiff {
  projectId: string;
  conversationId: string;
  diff: string;
  files: string[];
  branch: string;
  baseBranch: string;
}

export interface ChatEvents {
  "permission:notice": PermissionNotice;
  "projects:updated": { projects: ReturnType<ProjectRegistry["summaries"]> };
  "chat:message": { projectId: string; conversationId: string; message: ChatMessage };
  "chat:routing": {
    projectId: string;
    conversationId: string;
    agent: string;
    model: string;
    label: string;
    stage: "route" | "plan";
    confidence: number;
    source: string;
  };
  "chat:turn": {
    projectId: string;
    conversationId: string;
    status: "started" | "completed" | "failed" | "stopped";
    error?: string;
  };
  "chat:diff": ChatDiff;
  "mission:event": TaskEvent;
  "mission:summary": MissionSummary;
}

export interface ConversationDiff {
  diff: string;
  files: string[];
  branch?: string;
  baseBranch?: string;
}

export interface ChatSnapshot {
  project: Project;
  running: string[];
  diffs: Record<string, ConversationDiff>;
}

export class ChatService extends TypedEmitter<ChatEvents> {
  readonly permissions: PermissionCoordinator;
  private readonly operations = new Set<string>();
  private readonly running = new Set<string>();
  private readonly diffs = new Map<string, ChatDiff>();
  private readonly aborts = new Map<string, AbortController>();
  private readonly store: EventStore;
  private readonly missions: MissionService;

  constructor(
    private readonly registry: ProjectRegistry,
    private readonly jev: JevClient,
    private readonly config: OrchestratorConfig,
    private readonly worktreesBase: string,
    eventStore?: EventStore,
  ) {
    super();
    this.permissions = new PermissionCoordinator((notice) =>
      this.emit("permission:notice", notice),
    );
    this.store = eventStore ?? new EventStore(path.join(config.dataDir, "missions"));
    this.missions = new MissionService(
      registry,
      jev,
      config,
      worktreesBase,
      this.store,
      this.permissions,
    );
  }

  get registryRef(): ProjectRegistry {
    return this.registry;
  }

  isRunning(conversationId: string): boolean {
    return this.running.has(conversationId);
  }

  emitProjects(): void {
    this.emit("projects:updated", { projects: this.registry.summaries(this.running) });
  }

  async missionEvents(missionId: string): Promise<TaskEvent[]> {
    return this.store.read(missionId);
  }

  async missionSummary(missionId: string): Promise<MissionSummary | undefined> {
    const project = this.registry
      .list()
      .find((item) => item.conversations.some((conversation) => conversation.id === missionId));
    if (!project) return undefined;
    return this.store.readSummary(missionId);
  }

  async preview(text: string): Promise<MissionPreview> {
    const [route, complexity] = await Promise.all([
      this.jev.routeTask(text),
      this.jev.classifyComplexity(text),
    ]);
    return buildPreview(route, complexity, this.config);
  }

  async snapshot(projectId: string): Promise<ChatSnapshot | null> {
    const project = this.registry.get(projectId);
    if (!project) return null;
    const diffs: Record<string, ConversationDiff> = {};
    for (const conversation of project.conversations) {
      const cached = this.diffs.get(conversation.id);
      if (cached) {
        diffs[conversation.id] = {
          diff: cached.diff,
          files: cached.files,
          branch: cached.branch,
          baseBranch: cached.baseBranch,
        };
        continue;
      }
      if (
        conversation.worktreePath &&
        project.baseBranch &&
        existsSync(conversation.worktreePath)
      ) {
        try {
          const diff = await diffAgainst(conversation.worktreePath, project.baseBranch);
          diffs[conversation.id] = {
            diff,
            files: parseDiffFiles(diff),
            branch: conversation.branch,
            baseBranch: project.baseBranch,
          };
        } catch {
          /* ignore */
        }
      }
    }
    return { project, running: [...this.running], diffs };
  }

  async send(projectId: string, conversationId: string, text: string): Promise<void> {
    const project = this.registry.get(projectId);
    const conversation = this.registry.getConversation(projectId, conversationId);
    if (!project || !conversation) throw new Error("project or conversation not found");
    if (this.operations.has(projectId))
      throw new Error("project has an active workspace operation");
    if (this.running.has(conversationId)) throw new Error("this conversation is already running");

    this.running.add(conversationId);

    const controller = new AbortController();
    this.aborts.set(conversationId, controller);

    const channel: MissionChannel = {
      message: async (role, message, meta, code) => {
        await this.push(projectId, conversationId, role, message, meta, code);
      },
      routing: (event) => this.emit("chat:routing", { projectId, conversationId, ...event }),
      diff: (diff, files, branch, baseBranch) => {
        const chatDiff: ChatDiff = { projectId, conversationId, diff, files, branch, baseBranch };
        this.diffs.set(conversationId, chatDiff);
        this.emit("chat:diff", chatDiff);
      },
      event: (event) => this.emit("mission:event", event),
      summary: (summary) => this.emit("mission:summary", summary),
    };

    try {
      await this.registry.updateConversation(projectId, conversationId, {
        validationRequired: true,
      });
      await this.push(projectId, conversationId, "user", text);
      this.emitProjects();
      this.emit("chat:turn", { projectId, conversationId, status: "started" });
      await this.missions.run({
        projectId,
        conversationId,
        text,
        signal: controller.signal,
        channel,
      });
      this.emit("chat:turn", { projectId, conversationId, status: "completed" });
    } catch (err) {
      const stopped = controller.signal.aborted;
      const message = err instanceof Error ? err.message : String(err);
      await this.push(
        projectId,
        conversationId,
        stopped ? "system" : "error",
        stopped ? "stopped by user" : message,
      );
      this.emit("chat:turn", {
        projectId,
        conversationId,
        status: stopped ? "stopped" : "failed",
        ...(stopped ? {} : { error: message }),
      });
    } finally {
      this.aborts.delete(conversationId);
      this.running.delete(conversationId);
      this.emitProjects();
    }
  }

  stop(projectId: string, conversationId: string): void {
    this.aborts.get(conversationId)?.abort();
    void projectId;
  }

  async setAutonomy(projectId: string, conversationId: string, mode: AutonomyMode): Promise<void> {
    if (!isAutonomy(mode)) throw new Error("invalid autonomy mode");
    await this.withProjectOperation(projectId, async () => {
      const conversation = this.registry.getConversation(projectId, conversationId);
      if (!conversation) throw new Error("conversation not found");
      if ((conversation.autonomy ?? "autonomous") === mode) return;
      await this.registry.updateConversation(projectId, conversationId, {
        autonomy: mode,
        claudeSessionId: undefined,
        codexThreadId: undefined,
      });
      await this.registry.flush();
      this.emitProjects();
    });
  }

  broker(projectId: string, conversationId: string, root?: string): PermissionBroker {
    const project = this.registry.get(projectId);
    const conversation = this.registry.getConversation(projectId, conversationId);
    if (!project || !conversation) throw new Error("project or conversation not found");
    return new PermissionBroker(
      conversation.autonomy ?? "autonomous",
      projectId,
      conversationId,
      root ?? conversation.worktreePath ?? project.rootPath,
      (input, signal) => this.permissions.request(input, signal),
      async (event) => {
        const stored = await this.store.append(conversationId, event);
        this.emit("mission:event", stored);
        const summary = await this.store.readSummary(conversationId);
        if (summary) this.emit("mission:summary", summary);
      },
    );
  }

  private async requireAction(
    projectId: string,
    conversationId: string,
    action: PermissionAction,
    detail: string,
  ): Promise<void> {
    if (
      !(await this.broker(projectId, conversationId).authorize(
        action,
        "Git",
        detail,
        new AbortController().signal,
      ))
    )
      throw new Error("action denied by autonomy policy");
  }

  async withProjectOperation<T>(projectId: string, action: () => Promise<T>): Promise<T> {
    const project = this.registry.get(projectId);
    if (!project) throw new Error("project not found");
    if (
      this.operations.has(projectId) ||
      project.conversations.some((item) => this.running.has(item.id))
    )
      throw new Error("project is busy");
    this.operations.add(projectId);
    try {
      return await action();
    } finally {
      this.operations.delete(projectId);
    }
  }

  async invalidateChangedMissions(projectId: string): Promise<void> {
    const project = this.registry.get(projectId);
    if (!project) return;
    for (const conversation of project.conversations) {
      const summary = await this.missionSummary(conversation.id);
      if (summary?.status !== "ready" || !conversation.worktreePath) continue;
      const head = await runGit(conversation.worktreePath, ["rev-parse", "HEAD"], true);
      const status = await runGit(conversation.worktreePath, ["status", "--porcelain"], true);
      if (
        head.code !== 0 ||
        head.stdout.trim() !== summary.head ||
        status.code !== 0 ||
        status.stdout.trim()
      ) {
        await this.recordAction(
          conversation.id,
          "mission:stopped",
          "Workspace changed; validation required",
        );
        this.diffs.delete(conversation.id);
      }
    }
  }

  async restore(missionId: string, checkpointId: string): Promise<void> {
    const project = this.registry
      .list()
      .find((item) => item.conversations.some((conversation) => conversation.id === missionId));
    if (!project) throw new Error("mission not found");
    await this.withProjectOperation(project.id, async () => {
      const conversation = this.registry.getConversation(project.id, missionId)!;
      await this.requireAction(project.id, missionId, "git", "Restore mission checkpoint");
      if (!conversation.worktreePath || !conversation.branch || !project.baseBranch)
        throw new Error("mission has no worktree");
      await assertMissionWorktree(
        project.rootPath,
        this.worktreesBase,
        conversation.worktreePath,
        conversation.branch,
      );
      const checkpoint = (
        await new CheckpointService(path.join(this.config.dataDir, "checkpoints")).list(missionId)
      ).find((item) => item.id === checkpointId && item.missionId === missionId);
      if (!checkpoint || !/^[a-f0-9]{40,64}$/.test(checkpoint.commit))
        throw new Error("checkpoint not found");
      await runGit(conversation.worktreePath, ["cat-file", "-e", `${checkpoint.commit}^{commit}`]);
      await resetHard(conversation.worktreePath, checkpoint.commit);
      await this.registry.updateConversation(project.id, missionId, {
        validationRequired: true,
        claudeSessionId: undefined,
        codexThreadId: undefined,
      });
      await this.recordAction(
        missionId,
        "mission:stopped",
        `Restored checkpoint ${checkpoint.index}; validation required`,
      );
      const diff = await diffAgainst(conversation.worktreePath, project.baseBranch);
      const data: ChatDiff = {
        projectId: project.id,
        conversationId: missionId,
        diff,
        files: parseDiffFiles(diff),
        branch: conversation.branch,
        baseBranch: project.baseBranch,
      };
      this.diffs.set(missionId, data);
      this.emit("chat:diff", data);
      this.emitProjects();
    });
  }

  async apply(
    projectId: string,
    conversationId: string,
  ): Promise<{ ok: boolean; reason?: string }> {
    try {
      return await this.withProjectOperation(projectId, () =>
        this.applyUnlocked(projectId, conversationId),
      );
    } catch (error) {
      return { ok: false, reason: error instanceof Error ? error.message : String(error) };
    }
  }

  private async applyUnlocked(
    projectId: string,
    conversationId: string,
  ): Promise<{ ok: boolean; reason?: string }> {
    const project = this.registry.get(projectId);
    const conversation = this.registry.getConversation(projectId, conversationId);
    if (!project || !conversation || !conversation.branch || !project.baseBranch) {
      return { ok: false, reason: "conversation has no branch yet" };
    }
    if (this.running.has(conversationId)) return { ok: false, reason: "mission is still running" };
    await this.requireAction(projectId, conversationId, "git", "Apply mission changes");
    const summary = await this.missionSummary(conversationId);
    if (
      (conversation.validationRequired && !summary) ||
      (summary && (summary.status !== "ready" ||
        summary.verification.some((run) => run.status === "failed" || run.status === "running")))
    )
      return { ok: false, reason: "mission has not passed verification and review" };
    if (conversation.worktreePath) {
      const status = await runGit(conversation.worktreePath, ["status", "--porcelain"]);
      if (status.stdout.trim())
        return { ok: false, reason: "mission worktree changed after review; run a new validation" };
    }
    if (summary?.head) {
      const head = (
        await runGit(project.rootPath, ["rev-parse", conversation.branch])
      ).stdout.trim();
      if (head !== summary.head)
        return { ok: false, reason: "mission branch changed after review; run a new validation" };
    }
    const current = await currentBranch(project.rootPath);
    if (current !== project.baseBranch) {
      await this.push(
        projectId,
        conversationId,
        "system",
        `checkout ${project.baseBranch} (was ${current})`,
      );
      await checkout(project.rootPath, project.baseBranch);
    }
    const result = await mergeBranch(project.rootPath, conversation.branch);
    if (result.ok) {
      await this.push(
        projectId,
        conversationId,
        "system",
        `applied ${conversation.branch} into ${project.baseBranch}`,
      );
      this.diffs.delete(conversationId);
      await this.recordAction(conversationId, "mission:applied", "Changes applied");
      this.emit("chat:diff", {
        projectId,
        conversationId,
        diff: "",
        files: [],
        branch: conversation.branch,
        baseBranch: project.baseBranch,
      });
      return { ok: true };
    }
    const reason = result.conflicts?.join("; ") ?? result.reason ?? "merge failed";
    await this.push(projectId, conversationId, "error", `apply failed: ${reason}`);
    return { ok: false, reason };
  }

  async discard(
    projectId: string,
    conversationId: string,
  ): Promise<{ ok: boolean; reason?: string }> {
    try {
      return await this.withProjectOperation(projectId, () =>
        this.discardUnlocked(projectId, conversationId),
      );
    } catch (error) {
      return { ok: false, reason: error instanceof Error ? error.message : String(error) };
    }
  }

  private async discardUnlocked(
    projectId: string,
    conversationId: string,
  ): Promise<{ ok: boolean; reason?: string }> {
    const project = this.registry.get(projectId);
    const conversation = this.registry.getConversation(projectId, conversationId);
    if (!project || !conversation || !conversation.worktreePath || !project.baseBranch) {
      return { ok: false, reason: "nothing to discard" };
    }
    if (this.running.has(conversationId)) return { ok: false, reason: "mission is still running" };
    await this.requireAction(projectId, conversationId, "git", "Discard mission changes");
    await assertMissionWorktree(
      project.rootPath,
      this.worktreesBase,
      conversation.worktreePath,
      conversation.branch ?? "",
    );
    await resetHard(conversation.worktreePath, project.baseBranch);
    await this.recordAction(conversationId, "mission:stopped", "Changes discarded");
    this.diffs.delete(conversationId);
    await this.push(projectId, conversationId, "system", "discarded pending changes");
    this.emit("chat:diff", {
      projectId,
      conversationId,
      diff: "",
      files: [],
      branch: conversation.branch ?? "",
      baseBranch: project.baseBranch,
    });
    return { ok: true };
  }

  async removeConversation(projectId: string, conversationId: string): Promise<void> {
    return this.withProjectOperation(projectId, () =>
      this.removeConversationUnlocked(projectId, conversationId),
    );
  }

  private async removeConversationUnlocked(
    projectId: string,
    conversationId: string,
  ): Promise<void> {
    const project = this.registry.get(projectId);
    const conversation = this.registry.getConversation(projectId, conversationId);
    if (project && conversation) {
      if (conversation.worktreePath)
        await removeWorktree(project.rootPath, conversation.worktreePath);
      if (conversation.branch) await deleteBranch(project.rootPath, conversation.branch);
    }
    await this.registry.deleteConversation(projectId, conversationId);
    this.diffs.delete(conversationId);
    this.emitProjects();
  }

  async removeProject(projectId: string): Promise<void> {
    return this.withProjectOperation(projectId, () => this.removeProjectUnlocked(projectId));
  }

  private async removeProjectUnlocked(projectId: string): Promise<void> {
    const project = this.registry.get(projectId);
    if (project) {
      for (const conversation of project.conversations) {
        if (conversation.worktreePath)
          await removeWorktree(project.rootPath, conversation.worktreePath);
        if (conversation.branch) await deleteBranch(project.rootPath, conversation.branch);
        this.diffs.delete(conversation.id);
      }
    }
    await this.registry.remove(projectId);
    this.emitProjects();
  }

  async recordMissionEvent(missionId: string, input: MissionEventInput): Promise<void> {
    await this.missions.record(
      missionId,
      {
        event: (event) => this.emit("mission:event", event),
        summary: (summary) => this.emit("mission:summary", summary),
      },
      input,
    );
  }

  private async recordAction(
    missionId: string,
    type: "mission:applied" | "mission:stopped",
    message: string,
  ): Promise<void> {
    const event = await this.store.append(missionId, { type, level: "info", message });
    this.emit("mission:event", event);
    const summary = await this.store.readSummary(missionId);
    if (summary) this.emit("mission:summary", summary);
  }

  private async push(
    projectId: string,
    conversationId: string,
    role: ChatRole,
    text: string,
    meta?: string,
    code?: string,
  ): Promise<ChatMessage> {
    const message: ChatMessage = {
      id: uuid(),
      at: Date.now(),
      role,
      text,
      ...(meta ? { meta } : {}),
      ...(code ? { code } : {}),
    };
    await this.registry.addMessage(projectId, conversationId, message);
    this.emit("chat:message", { projectId, conversationId, message });
    return message;
  }
}
