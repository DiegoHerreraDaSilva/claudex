import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { v4 as uuid } from "uuid";
import { z } from "zod";
import { runClaudeAgent, CLAUDE_TOOLS } from "../agents/claude.js";
import { runCodexAgent } from "../agents/codex.js";
import type { OrchestratorConfig } from "../config.js";
import { TypedEmitter } from "../events.js";
import { JevClient } from "../jev.js";
import {
  addWorktree,
  branchExists,
  checkout,
  commitAll,
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
  type Conversation,
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

const planSchema = z.object({
  complexity: z.enum(["complex", "simple"]),
  plan: z.string(),
});
const PLAN_JSON_SCHEMA = z.toJSONSchema(planSchema) as Record<string, unknown>;

export class ChatService extends TypedEmitter<ChatEvents> {
  private readonly running = new Set<string>();
  private readonly diffs = new Map<string, ChatDiff>();
  private readonly aborts = new Map<string, AbortController>();

  constructor(
    private readonly registry: ProjectRegistry,
    private readonly jev: JevClient,
    private readonly config: OrchestratorConfig,
    private readonly worktreesBase: string,
  ) {
    super();
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
            files: parseFiles(diff),
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

    try {
      const { worktreePath, baseBranch, branch } = await this.ensureWorktree(project, conversation);
      const route = await this.jev.routeTask(text);

      if (route.route === "implement") {
        this.emitRouting(projectId, conversationId, {
          agent: "claude:sonnet",
          model: "sonnet",
          label: "simples implementacao",
          stage: "route",
          confidence: route.confidence,
          source: route.source,
        });
        await this.push(
          projectId,
          conversationId,
          "routing",
          `Jev: simples implementacao -> Sonnet (conf ${route.confidence.toFixed(2)}, ${route.source})`,
          undefined,
          "route.implement",
        );
        const run = await runClaudeAgent({
          prompt: text,
          model: "sonnet",
          worktreePath,
          allowedTools: [...CLAUDE_TOOLS.implementer],
          maxTurns: 30,
          timeoutMs: this.config.agentTimeoutMs,
          signal: controller.signal,
          ...(conversation.claudeSessionId ? { resumeSessionId: conversation.claudeSessionId } : {}),
          onMessage: (message) => this.streamClaude(projectId, conversationId, message),
        });
        await this.registry.updateConversation(projectId, conversationId, {
          claudeSessionId: run.sessionId,
          activeAgent: "claude:sonnet",
        });
        await this.addUsage(projectId, conversationId, run.usage);
      } else {
        this.emitRouting(projectId, conversationId, {
          agent: "claude:opus",
          model: "opus",
          label: "precisa planejar",
          stage: "route",
          confidence: route.confidence,
          source: route.source,
        });
        await this.push(
          projectId,
          conversationId,
          "routing",
          `Jev: precisa planejar -> Opus (conf ${route.confidence.toFixed(2)}, ${route.source})`,
          undefined,
          "route.plan",
        );

        const planner = await runClaudeAgent({
          prompt: buildPlannerPrompt(text),
          model: "opus",
          worktreePath,
          allowedTools: [...CLAUDE_TOOLS.planner],
          maxTurns: 8,
          timeoutMs: this.config.agentTimeoutMs,
          signal: controller.signal,
          outputSchema: PLAN_JSON_SCHEMA,
        });
        const plan = parsePlan(planner.result);
        await this.addUsage(projectId, conversationId, planner.usage);
        const complex = plan.complexity === "complex";
        const workerPrompt = `${text}\n\nPlano aprovado:\n${plan.plan}`;
        await this.push(projectId, conversationId, "assistant", plan.plan);

        if (complex) {
          const label = `codex:${this.config.defaultComplexModel}`;
          this.emitRouting(projectId, conversationId, {
            agent: label,
            model: this.config.defaultComplexModel,
            label: "feature complexa",
            stage: "plan",
            confidence: 1,
            source: "planner",
          });
          await this.push(
            projectId,
            conversationId,
            "routing",
            `Opus: feature complexa -> ${this.config.defaultComplexModel}`,
            undefined,
            "plan.complex",
          );
          const run = await runCodexAgent({
            prompt: workerPrompt,
            worktreePath,
            model: this.config.defaultComplexModel,
            timeoutMs: this.config.agentTimeoutMs,
            signal: controller.signal,
            ...(conversation.codexThreadId ? { resumeThreadId: conversation.codexThreadId } : {}),
            onEvent: (event) => this.streamCodex(projectId, conversationId, event),
          });
          await this.registry.updateConversation(projectId, conversationId, {
            codexThreadId: run.threadId,
            activeAgent: label,
          });
          await this.addUsage(projectId, conversationId, run.usage);
        } else {
          this.emitRouting(projectId, conversationId, {
            agent: "claude:sonnet",
            model: "sonnet",
            label: "feature mais simples",
            stage: "plan",
            confidence: 1,
            source: "planner",
          });
          await this.push(projectId, conversationId, "routing", "Opus: feature mais simples -> Sonnet", undefined, "plan.simple");
          const run = await runClaudeAgent({
            prompt: workerPrompt,
            model: "sonnet",
            worktreePath,
            allowedTools: [...CLAUDE_TOOLS.implementer],
            maxTurns: 30,
            timeoutMs: this.config.agentTimeoutMs,
            signal: controller.signal,
            ...(conversation.claudeSessionId ? { resumeSessionId: conversation.claudeSessionId } : {}),
            onMessage: (message) => this.streamClaude(projectId, conversationId, message),
          });
          await this.registry.updateConversation(projectId, conversationId, {
            claudeSessionId: run.sessionId,
            activeAgent: "claude:sonnet",
          });
          await this.addUsage(projectId, conversationId, run.usage);
        }
      }

      await commitAll(worktreePath, text);
      const diff = await diffAgainst(worktreePath, baseBranch);
      const chatDiff: ChatDiff = {
        projectId,
        conversationId,
        diff,
        files: parseFiles(diff),
        branch,
        baseBranch,
      };
      this.diffs.set(conversationId, chatDiff);
      this.emit("chat:diff", chatDiff);
      this.emit("chat:turn", { projectId, conversationId, status: "completed" });
    } catch (err) {
      const stopped = controller.signal.aborted;
      const message = err instanceof Error ? err.message : String(err);
      await this.push(projectId, conversationId, stopped ? "system" : "error", stopped ? "stopped by user" : message);
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

  private async ensureWorktree(
    project: Project,
    conversation: Conversation,
  ): Promise<{ worktreePath: string; branch: string; baseBranch: string }> {
    const root = project.rootPath;
    const baseBranch = project.baseBranch ?? (await currentBranch(root));
    const branch = conversation.branch ?? `claudex/${project.id.slice(0, 6)}-${conversation.id.slice(0, 6)}`;
    const worktreePath = conversation.worktreePath ?? path.join(this.worktreesBase, conversation.id);

    await mkdir(this.worktreesBase, { recursive: true });
    const ready = existsSync(worktreePath) && existsSync(path.join(worktreePath, ".git"));
    if (!ready) {
      await removeWorktree(root, worktreePath);
      if (await branchExists(root, branch)) {
        await addWorktree(root, worktreePath, branch);
      } else {
        await addWorktree(root, worktreePath, branch, baseBranch);
      }
    }
    await this.registry.update(project.id, { baseBranch });
    await this.registry.updateConversation(project.id, conversation.id, { branch, worktreePath });
    return { worktreePath, branch, baseBranch };
  }

  private async addUsage(
    projectId: string,
    conversationId: string,
    usage: { inputTokens: number; outputTokens: number },
  ): Promise<void> {
    const conversation = this.registry.getConversation(projectId, conversationId);
    if (!conversation) return;
    const prev = conversation.usage ?? { inputTokens: 0, outputTokens: 0, runs: 0 };
    await this.registry.updateConversation(projectId, conversationId, {
      usage: {
        inputTokens: prev.inputTokens + usage.inputTokens,
        outputTokens: prev.outputTokens + usage.outputTokens,
        runs: prev.runs + 1,
      },
    });
  }

  private emitRouting(
    projectId: string,
    conversationId: string,
    data: Omit<ChatEvents["chat:routing"], "projectId" | "conversationId">,
  ): void {
    this.emit("chat:routing", { projectId, conversationId, ...data });
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

  private streamClaude(projectId: string, conversationId: string, message: unknown): void {
    const record = message as { type?: string; subtype?: string; session_id?: string };
    if (record.type === "system" && record.subtype === "init") {
      void this.push(projectId, conversationId, "system", `session ${record.session_id ?? "?"}`);
      return;
    }
    if (record.type === "assistant") {
      const content = (message as { message?: { content?: unknown[] } }).message?.content ?? [];
      for (const block of content) {
        const item = block as { type?: string; text?: string; name?: string; input?: unknown };
        if (item.type === "text" && item.text) void this.push(projectId, conversationId, "assistant", item.text);
        else if (item.type === "tool_use") {
          void this.push(projectId, conversationId, "tool", item.name ?? "tool", shortJson(item.input));
        }
      }
      return;
    }
    if (record.type === "result" && record.subtype === "success") {
      const text = (message as { result?: string }).result ?? "";
      if (text) void this.push(projectId, conversationId, "result", text);
    }
  }

  private streamCodex(projectId: string, conversationId: string, event: unknown): void {
    const e = event as {
      type?: string;
      thread_id?: string;
      item?: { type?: string; text?: string; command?: string; changes?: unknown[] };
    };
    if (e.type === "thread.started") {
      void this.push(projectId, conversationId, "system", `thread ${e.thread_id ?? "?"}`);
      return;
    }
    if (e.type !== "item.completed" && e.type !== "item.started" && e.type !== "item.updated") return;
    const item = e.item;
    if (!item) return;
    if (item.type === "agent_message" && item.text) void this.push(projectId, conversationId, "assistant", item.text);
    else if (item.type === "reasoning" && item.text) void this.push(projectId, conversationId, "assistant", item.text);
    else if (item.type === "command_execution" && item.command) void this.push(projectId, conversationId, "tool", item.command);
    else if (item.type === "file_change" && item.changes) {
      void this.push(projectId, conversationId, "tool", "file_change", shortJson(item.changes));
    }
  }
}

function buildPlannerPrompt(task: string): string {
  return [
    "Voce e um arquiteto de software. Analise a tarefa e produza um plano de implementacao conciso.",
    "Decida se e uma FEATURE COMPLEXA (multiplos arquivos, integracoes, logica densa) ou uma FEATURE MAIS SIMPLES (mudanca focada).",
    'Responda APENAS com JSON valido no formato: { "complexity": "complex" | "simple", "plan": string }',
    "",
    `Tarefa: ${task}`,
  ].join("\n");
}

function parsePlan(text: string): { complexity: "complex" | "simple"; plan: string } {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start !== -1 && end > start) {
    try {
      const parsed = JSON.parse(text.slice(start, end + 1)) as { complexity?: unknown; plan?: unknown };
      return {
        complexity: parsed.complexity === "complex" ? "complex" : "simple",
        plan: typeof parsed.plan === "string" ? parsed.plan : text,
      };
    } catch {
      /* fall through */
    }
  }
  return { complexity: "simple", plan: text.slice(0, 800) };
}

function shortJson(value: unknown): string {
  try {
    const text = typeof value === "string" ? value : JSON.stringify(value);
    return text.slice(0, 300);
  } catch {
    return "";
  }
}

function parseFiles(diff: string): string[] {
  const files = new Set<string>();
  for (const line of diff.split(/\r?\n/)) {
    const match = /^diff --git a\/(.+?) b\/(.+)$/.exec(line);
    if (match?.[2]) files.add(match[2]);
  }
  return [...files];
}
