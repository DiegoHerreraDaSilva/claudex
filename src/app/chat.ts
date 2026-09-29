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
  type ProjectSummary,
} from "./projects.js";

export interface ChatDiff {
  projectId: string;
  diff: string;
  files: string[];
  branch: string;
  baseBranch: string;
}

export interface ChatEvents {
  "projects:updated": { projects: ProjectSummary[] };
  "chat:message": { projectId: string; message: ChatMessage };
  "chat:routing": {
    projectId: string;
    agent: string;
    model: string;
    label: string;
    stage: "route" | "plan";
    confidence: number;
    source: string;
  };
  "chat:turn": { projectId: string; status: "started" | "completed" | "failed"; error?: string };
  "chat:diff": ChatDiff;
  "chat:status": { projectId: string; text: string };
}

export interface ChatSnapshot {
  project: Project;
  running: boolean;
  diff: string;
  files: string[];
  branch?: string;
  baseBranch?: string;
}

const planSchema = z.object({
  complexity: z.enum(["complex", "simple"]),
  plan: z.string(),
});
const PLAN_JSON_SCHEMA = z.toJSONSchema(planSchema) as Record<string, unknown>;

export class ChatService extends TypedEmitter<ChatEvents> {
  private readonly running = new Set<string>();
  private readonly diffs = new Map<string, ChatDiff>();

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

  isRunning(projectId: string): boolean {
    return this.running.has(projectId);
  }

  emitProjects(): void {
    this.emit("projects:updated", { projects: this.registry.summaries(this.running) });
  }

  async snapshot(projectId: string): Promise<ChatSnapshot | null> {
    const project = this.registry.get(projectId);
    if (!project) return null;
    const cached = this.diffs.get(projectId);
    let diff = cached?.diff ?? "";
    let files = cached?.files ?? [];
    if (!cached && project.worktreePath && project.baseBranch && existsSync(project.worktreePath)) {
      try {
        diff = await diffAgainst(project.worktreePath, project.baseBranch);
        files = parseFiles(diff);
      } catch {
        diff = "";
        files = [];
      }
    }
    return {
      project,
      running: this.running.has(projectId),
      diff,
      files,
      ...(project.branch ? { branch: project.branch } : {}),
      ...(project.baseBranch ? { baseBranch: project.baseBranch } : {}),
    };
  }

  async send(projectId: string, text: string): Promise<void> {
    const project = this.registry.get(projectId);
    if (!project) throw new Error("project not found");
    if (this.running.has(projectId)) throw new Error("project is already running a turn");

    await this.push(projectId, "user", text);
    this.running.add(projectId);
    this.emitProjects();
    this.emit("chat:turn", { projectId, status: "started" });

    try {
      const { worktreePath, baseBranch, branch } = await this.ensureWorktree(project);

      const route = await this.jev.routeTask(text);

      if (route.route === "implement") {
        this.emitRouting(projectId, {
          agent: "claude:sonnet",
          model: "sonnet",
          label: "simples implementacao",
          stage: "route",
          confidence: route.confidence,
          source: route.source,
        });
        await this.push(
          projectId,
          "routing",
          `Jev: simples implementacao -> Sonnet (conf ${route.confidence.toFixed(2)}, ${route.source})`,
        );
        const run = await runClaudeAgent({
          prompt: text,
          model: "sonnet",
          worktreePath,
          allowedTools: [...CLAUDE_TOOLS.implementer],
          maxTurns: 30,
          timeoutMs: this.config.agentTimeoutMs,
          ...(project.claudeSessionId ? { resumeSessionId: project.claudeSessionId } : {}),
          onMessage: (message) => this.streamClaude(projectId, message),
        });
        await this.registry.update(projectId, {
          claudeSessionId: run.sessionId,
          activeAgent: "claude:sonnet",
        });
      } else {
        this.emitRouting(projectId, {
          agent: "claude:opus",
          model: "opus",
          label: "precisa planejar",
          stage: "route",
          confidence: route.confidence,
          source: route.source,
        });
        await this.push(
          projectId,
          "routing",
          `Jev: precisa planejar -> Opus (conf ${route.confidence.toFixed(2)}, ${route.source})`,
        );

        const planner = await runClaudeAgent({
          prompt: buildPlannerPrompt(text),
          model: "opus",
          worktreePath,
          allowedTools: [...CLAUDE_TOOLS.planner],
          maxTurns: 8,
          timeoutMs: this.config.agentTimeoutMs,
          outputSchema: PLAN_JSON_SCHEMA,
        });
        const plan = parsePlan(planner.result);
        const complex = plan.complexity === "complex";
        const workerPrompt = `${text}\n\nPlano aprovado:\n${plan.plan}`;
        await this.push(projectId, "assistant", plan.plan);

        if (complex) {
          const label = `codex:${this.config.defaultComplexModel}`;
          this.emitRouting(projectId, {
            agent: label,
            model: this.config.defaultComplexModel,
            label: "feature complexa",
            stage: "plan",
            confidence: 1,
            source: "planner",
          });
          await this.push(
            projectId,
            "routing",
            `Opus: feature complexa -> ${this.config.defaultComplexModel}`,
          );
          const run = await runCodexAgent({
            prompt: workerPrompt,
            worktreePath,
            model: this.config.defaultComplexModel,
            timeoutMs: this.config.agentTimeoutMs,
            ...(project.codexThreadId ? { resumeThreadId: project.codexThreadId } : {}),
            onEvent: (event) => this.streamCodex(projectId, event),
          });
          await this.registry.update(projectId, {
            codexThreadId: run.threadId,
            activeAgent: label,
          });
        } else {
          this.emitRouting(projectId, {
            agent: "claude:sonnet",
            model: "sonnet",
            label: "feature mais simples",
            stage: "plan",
            confidence: 1,
            source: "planner",
          });
          await this.push(projectId, "routing", "Opus: feature mais simples -> Sonnet");
          const run = await runClaudeAgent({
            prompt: workerPrompt,
            model: "sonnet",
            worktreePath,
            allowedTools: [...CLAUDE_TOOLS.implementer],
            maxTurns: 30,
            timeoutMs: this.config.agentTimeoutMs,
            ...(project.claudeSessionId ? { resumeSessionId: project.claudeSessionId } : {}),
            onMessage: (message) => this.streamClaude(projectId, message),
          });
          await this.registry.update(projectId, {
            claudeSessionId: run.sessionId,
            activeAgent: "claude:sonnet",
          });
        }
      }

      await commitAll(worktreePath, text);
      const diff = await diffAgainst(worktreePath, baseBranch);
      const chatDiff: ChatDiff = {
        projectId,
        diff,
        files: parseFiles(diff),
        branch,
        baseBranch,
      };
      this.diffs.set(projectId, chatDiff);
      this.emit("chat:diff", chatDiff);
      this.emit("chat:turn", { projectId, status: "completed" });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await this.push(projectId, "error", message);
      this.emit("chat:turn", { projectId, status: "failed", error: message });
    } finally {
      this.running.delete(projectId);
      this.emitProjects();
    }
  }

  async apply(projectId: string): Promise<{ ok: boolean; reason?: string }> {
    const project = this.registry.get(projectId);
    if (!project || !project.branch || !project.baseBranch) {
      return { ok: false, reason: "project has no branch yet" };
    }
    const current = await currentBranch(project.rootPath);
    if (current !== project.baseBranch) {
      await this.push(projectId, "system", `checkout ${project.baseBranch} (was ${current})`);
      await checkout(project.rootPath, project.baseBranch);
    }
    const result = await mergeBranch(project.rootPath, project.branch);
    if (result.ok) {
      await this.push(projectId, "system", `applied ${project.branch} into ${project.baseBranch}`);
      this.diffs.delete(projectId);
      this.emit("chat:diff", {
        projectId,
        diff: "",
        files: [],
        branch: project.branch,
        baseBranch: project.baseBranch,
      });
      return { ok: true };
    }
    const reason = result.conflicts?.join("; ") ?? result.reason ?? "merge failed";
    await this.push(projectId, "error", `apply failed: ${reason}`);
    return { ok: false, reason };
  }

  async discard(projectId: string): Promise<{ ok: boolean; reason?: string }> {
    const project = this.registry.get(projectId);
    if (!project || !project.worktreePath || !project.baseBranch) {
      return { ok: false, reason: "nothing to discard" };
    }
    await resetHard(project.worktreePath, project.baseBranch);
    this.diffs.delete(projectId);
    await this.push(projectId, "system", "discarded pending changes");
    this.emit("chat:diff", {
      projectId,
      diff: "",
      files: [],
      branch: project.branch ?? "",
      baseBranch: project.baseBranch,
    });
    return { ok: true };
  }

  async removeProject(projectId: string): Promise<void> {
    const project = this.registry.get(projectId);
    if (project?.worktreePath) {
      await removeWorktree(project.rootPath, project.worktreePath);
    }
    await this.registry.remove(projectId);
    this.diffs.delete(projectId);
    this.emitProjects();
  }

  private async ensureWorktree(
    project: Project,
  ): Promise<{ worktreePath: string; branch: string; baseBranch: string }> {
    const root = project.rootPath;
    const baseBranch = project.baseBranch ?? (await currentBranch(root));
    const branch = project.branch ?? `claudex/chat-${project.id.slice(0, 8)}`;
    const worktreePath = project.worktreePath ?? path.join(this.worktreesBase, project.id);

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
    await this.registry.update(project.id, { baseBranch, branch, worktreePath });
    return { worktreePath, branch, baseBranch };
  }

  private emitRouting(
    projectId: string,
    data: Omit<ChatEvents["chat:routing"], "projectId">,
  ): void {
    this.emit("chat:routing", { projectId, ...data });
  }

  private async push(
    projectId: string,
    role: ChatRole,
    text: string,
    meta?: string,
  ): Promise<ChatMessage> {
    const message: ChatMessage = {
      id: uuid(),
      at: Date.now(),
      role,
      text,
      ...(meta ? { meta } : {}),
    };
    await this.registry.addMessage(projectId, message);
    this.emit("chat:message", { projectId, message });
    return message;
  }

  private streamClaude(projectId: string, message: unknown): void {
    const record = message as { type?: string; subtype?: string; session_id?: string };
    if (record.type === "system" && record.subtype === "init") {
      void this.push(projectId, "system", `session ${record.session_id ?? "?"}`);
      return;
    }
    if (record.type === "assistant") {
      const content = (message as { message?: { content?: unknown[] } }).message?.content ?? [];
      for (const block of content) {
        const item = block as { type?: string; text?: string; name?: string; input?: unknown };
        if (item.type === "text" && item.text) void this.push(projectId, "assistant", item.text);
        else if (item.type === "tool_use") {
          void this.push(projectId, "tool", item.name ?? "tool", shortJson(item.input));
        }
      }
      return;
    }
    if (record.type === "result" && record.subtype === "success") {
      const text = (message as { result?: string }).result ?? "";
      if (text) void this.push(projectId, "result", text);
    }
  }

  private streamCodex(projectId: string, event: unknown): void {
    const e = event as {
      type?: string;
      thread_id?: string;
      item?: { type?: string; text?: string; command?: string; changes?: unknown[] };
    };
    if (e.type === "thread.started") {
      void this.push(projectId, "system", `thread ${e.thread_id ?? "?"}`);
      return;
    }
    if (e.type !== "item.completed" && e.type !== "item.started" && e.type !== "item.updated") return;
    const item = e.item;
    if (!item) return;
    if (item.type === "agent_message" && item.text) void this.push(projectId, "assistant", item.text);
    else if (item.type === "reasoning" && item.text) void this.push(projectId, "assistant", item.text);
    else if (item.type === "command_execution" && item.command) void this.push(projectId, "tool", item.command);
    else if (item.type === "file_change" && item.changes) {
      void this.push(projectId, "tool", "file_change", shortJson(item.changes));
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
      const parsed = JSON.parse(text.slice(start, end + 1)) as {
        complexity?: unknown;
        plan?: unknown;
      };
      return {
        complexity: parsed.complexity === "complex" ? "complex" : "simple",
        plan: typeof parsed.plan === "string" ? parsed.plan : text,
      };
    } catch {
      // fall through
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
