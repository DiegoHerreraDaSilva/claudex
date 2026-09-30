import { existsSync } from "node:fs";
import path from "node:path";
import { v4 as uuid } from "uuid";
import { MissionService } from "../application/missionService.js";
import type { MissionChannel } from "../application/missionService.js";
import type { OrchestratorConfig } from "../config.js";
import { parseDiffFiles } from "../domain/diff.js";
import type { TaskEvent } from "../domain/event.js";
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
} from "./git.js";
import {
  ProjectRegistry,
  type ChatMessage,
  type ChatRole,
  type Project,
} from "./projects.js";

export interface ChatDiff {
  projectId: string;
  conversationId: string;
  diff: string;
  files: string[];
  branch: string;
  baseBranch: string;
}

export interface ChatEvents {
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
    this.store = eventStore ?? new EventStore(path.join(config.dataDir, "missions"));
    this.missions = new MissionService(registry, jev, config, worktreesBase, this.store);
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
      if (conversation.worktreePath && project.baseBranch && existsSync(conversation.worktreePath)) {
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
    if (this.running.has(conversationId)) throw new Error("this conversation is already running");

    await this.push(projectId, conversationId, "user", text);
    this.running.add(conversationId);
    this.emitProjects();
    this.emit("chat:turn", { projectId, conversationId, status: "started" });

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
    };

    try {
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

  async apply(projectId: string, conversationId: string): Promise<{ ok: boolean; reason?: string }> {
    const project = this.registry.get(projectId);
    const conversation = this.registry.getConversation(projectId, conversationId);
    if (!project || !conversation || !conversation.branch || !project.baseBranch) {
      return { ok: false, reason: "conversation has no branch yet" };
    }
    const current = await currentBranch(project.rootPath);
    if (current !== project.baseBranch) {
      await this.push(projectId, conversationId, "system", `checkout ${project.baseBranch} (was ${current})`);
      await checkout(project.rootPath, project.baseBranch);
    }
    const result = await mergeBranch(project.rootPath, conversation.branch);
    if (result.ok) {
      await this.push(projectId, conversationId, "system", `applied ${conversation.branch} into ${project.baseBranch}`);
      this.diffs.delete(conversationId);
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

  async discard(projectId: string, conversationId: string): Promise<{ ok: boolean; reason?: string }> {
    const project = this.registry.get(projectId);
    const conversation = this.registry.getConversation(projectId, conversationId);
    if (!project || !conversation || !conversation.worktreePath || !project.baseBranch) {
      return { ok: false, reason: "nothing to discard" };
    }
    await resetHard(conversation.worktreePath, project.baseBranch);
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
    const project = this.registry.get(projectId);
    const conversation = this.registry.getConversation(projectId, conversationId);
    if (project && conversation) {
      if (conversation.worktreePath) await removeWorktree(project.rootPath, conversation.worktreePath);
      if (conversation.branch) await deleteBranch(project.rootPath, conversation.branch);
    }
    await this.registry.deleteConversation(projectId, conversationId);
    this.diffs.delete(conversationId);
    this.emitProjects();
  }

  async removeProject(projectId: string): Promise<void> {
    const project = this.registry.get(projectId);
    if (project) {
      for (const conversation of project.conversations) {
        if (conversation.worktreePath) await removeWorktree(project.rootPath, conversation.worktreePath);
        if (conversation.branch) await deleteBranch(project.rootPath, conversation.branch);
        this.diffs.delete(conversation.id);
      }
    }
    await this.registry.remove(projectId);
    this.emitProjects();
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
