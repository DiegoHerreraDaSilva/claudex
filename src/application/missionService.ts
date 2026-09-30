import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { v4 as uuid } from "uuid";
import { z } from "zod";
import { runClaudeAgent, CLAUDE_TOOLS } from "../agents/claude.js";
import { runCodexAgent } from "../agents/codex.js";
import type { ClaudeModel } from "../agents/types.js";
import {
  addWorktree,
  branchExists,
  commitAll,
  commitWorkingTree,
  createInitialCommit,
  currentBranch,
  diffAgainst,
  hasCommits,
  removeWorktree,
  runGit,
} from "../app/git.js";
import type { ChatRole, Conversation, Project, ProjectRegistry } from "../app/projects.js";
import type { OrchestratorConfig } from "../config.js";
import type { AgentRun, TokenUsage } from "../domain/agent.js";
import { diffStats, parseDiffFiles } from "../domain/diff.js";
import type { MissionEventInput, TaskEvent } from "../domain/event.js";
import type { MissionSummary } from "../domain/missionSummary.js";
import { verifyMission } from "./verificationService.js";
import { reviewMission } from "./reviewService.js";
import { validateMission } from "./missionValidation.js";
import type { EventStore } from "../infrastructure/persistence/eventStore.js";
import { estimateCostUsd } from "../infrastructure/pricing.js";
import { JevClient } from "../jev.js";
import { agentKindOf } from "./orchestrationService.js";

export interface MissionRoutingEvent {
  agent: string;
  model: string;
  label: string;
  stage: "route" | "plan";
  confidence: number;
  source: string;
}

/** Sink used by the mission flow to communicate with the UI layer. */
export interface MissionChannel {
  message(role: ChatRole, text: string, meta?: string, code?: string): Promise<void>;
  routing(event: MissionRoutingEvent): void;
  diff(diff: string, files: string[], branch: string, baseBranch: string): void;
  event(event: TaskEvent): void;
  summary(summary: MissionSummary): void;
}

export interface MissionRunInput {
  projectId: string;
  conversationId: string;
  text: string;
  signal: AbortSignal;
  channel: MissionChannel;
}

const planSchema = z.object({
  complexity: z.enum(["complex", "simple"]),
  plan: z.string(),
  subtasks: z.array(z.string()).optional(),
});

const PLAN_JSON_SCHEMA = (() => {
  const schema = z.toJSONSchema(planSchema) as Record<string, unknown>;
  delete schema["$schema"];
  delete schema["$id"];
  return schema;
})();

interface UsageInfo {
  label: string;
  model: string;
  usage: TokenUsage;
  startedAt?: number;
}

/**
 * Owns the execution of a single mission (one conversation = one isolated
 * worktree + continuous session). ChatService and, later, the CLI call this.
 */
export class MissionService {
  private readonly lastAssistantText = new Map<string, string>();

  constructor(
    private readonly registry: ProjectRegistry,
    private readonly jev: JevClient,
    private readonly config: OrchestratorConfig,
    private readonly worktreesBase: string,
    private readonly events: EventStore,
  ) {}

  async eventsFor(missionId: string): Promise<TaskEvent[]> {
    return this.events.read(missionId);
  }

  async run(input: MissionRunInput): Promise<void> {
    try {
      await this.execute(input);
    } catch (err) {
      await this.record(input.conversationId, input.channel, {
        type: input.signal.aborted ? "mission:stopped" : "mission:failed",
        level: input.signal.aborted ? "warn" : "error",
        message: input.signal.aborted ? "Mission interrupted" : err instanceof Error ? err.message : String(err),
      });
      throw err;
    } finally {
      this.lastAssistantText.delete(input.conversationId);
    }
  }

  private async execute(input: MissionRunInput): Promise<void> {
    const { projectId, conversationId, text, signal, channel } = input;
    const project = this.registry.get(projectId);
    const conversation = this.registry.getConversation(projectId, conversationId);
    if (!project || !conversation) throw new Error("project or conversation not found");

    await this.record(conversationId, channel, {
      type: "mission:started",
      level: "info",
      message: text,
      payload: { projectId },
    });

    const { worktreePath, baseBranch, branch } = await this.ensureWorktree(project, conversation, channel);
    signal.throwIfAborted();
    const route = await this.jev.routeTask(text);
    signal.throwIfAborted();
    let plan = text;

    if (route.route === "implement") {
      channel.routing({
        agent: "claude:sonnet",
        model: "sonnet",
        label: "simples implementacao",
        stage: "route",
        confidence: route.confidence,
        source: route.source,
      });
      await channel.message(
        "routing",
        `Jev: simples implementacao -> Sonnet (conf ${route.confidence.toFixed(2)}, ${route.source})`,
        undefined,
        "route.implement",
      );
      await this.record(conversationId, channel, {
        type: "router:decided",
        level: "info",
        message: `simples implementacao -> Sonnet (${route.source})`,
        payload: { route: route.route, confidence: route.confidence, source: route.source },
      });
      await this.runClaude({
        projectId,
        conversationId,
        sessionId: conversation.claudeSessionId,
        channel,
        worktreePath,
        label: "claude:sonnet",
        model: "sonnet",
        prompt: text,
        tools: [...CLAUDE_TOOLS.implementer],
        maxTurns: 30,
        signal,
      });
    } else {
      channel.routing({
        agent: "claude:opus",
        model: "opus",
        label: "precisa planejar",
        stage: "route",
        confidence: route.confidence,
        source: route.source,
      });
      await channel.message(
        "routing",
        `Jev: precisa planejar -> Opus (conf ${route.confidence.toFixed(2)}, ${route.source})`,
        undefined,
        "route.plan",
      );
      await this.record(conversationId, channel, {
        type: "router:decided",
        level: "info",
        message: `precisa planejar -> Opus (${route.source})`,
        payload: { route: route.route, confidence: route.confidence, source: route.source },
      });

      plan = await this.runPlanner({ projectId, conversationId, channel, worktreePath, text, signal });
    }

    await validateMission({ signal }, {
      captureDiff: async () => {
        signal.throwIfAborted();
        await commitAll(worktreePath, text);
        const diff = await diffAgainst(worktreePath, baseBranch);
        const files = parseDiffFiles(diff);
        const head = (await runGit(worktreePath, ["rev-parse", "HEAD"])).stdout.trim();
        channel.diff(diff, files, branch, baseBranch);
        await this.record(conversationId, channel, {
          type: "diff:created", level: files.length > 0 ? "success" : "info",
          message: `${files.length} arquivo(s) alterado(s)`,
          payload: { files, branch, baseBranch, head, ...diffStats(diff) },
        });
        return diff;
      },
      verify: () => verifyMission({ missionId: conversationId, worktreePath, signal, timeoutMs: this.config.agentTimeoutMs, onEvent: event => this.record(conversationId, channel, event) }),
      review: diff => reviewMission({ missionId: conversationId, worktreePath, diff, plan, signal, timeoutMs: this.config.agentTimeoutMs }, { jev: this.jev }),
      correct: prompt => this.correct(input, worktreePath, prompt),
      record: event => this.record(conversationId, channel, event),
      onReviewUsage: (run, startedAt) => this.addUsage(projectId, conversationId, channel, { label: "claude:opus (reviewer)", model: "opus", usage: run.usage, startedAt }),
    });
    await this.record(conversationId, channel, {
      type: "mission:completed",
      level: "success",
      message: "missao concluida",
    });
  }

  private async runPlanner(args: {
    projectId: string;
    conversationId: string;
    channel: MissionChannel;
    worktreePath: string;
    text: string;
    signal: AbortSignal;
  }): Promise<string> {
    const { projectId, conversationId, channel, worktreePath, text, signal } = args;
    const startedAt = Date.now();
    await this.record(conversationId, channel, {
      type: "agent:started",
      level: "info",
      message: "claude:opus (planner)",
      payload: { label: "claude:opus", model: "opus", role: "planner" },
    });
    const planner = await runClaudeAgent({
      prompt: buildPlannerPrompt(text),
      model: "opus",
      worktreePath,
      allowedTools: [...CLAUDE_TOOLS.planner],
      maxTurns: 8,
      timeoutMs: this.config.agentTimeoutMs,
      signal,
      outputSchema: PLAN_JSON_SCHEMA,
    });
    await this.addUsage(projectId, conversationId, channel, {
      label: "claude:opus",
      model: "opus",
      usage: planner.usage,
      startedAt,
    });
    const plan = parsePlan(planner.result);
    await this.record(conversationId, channel, {
      type: "plan:created",
      level: "info",
      message: plan.plan,
      payload: { complexity: plan.complexity, subtasks: plan.subtasks },
    });
    const workerPrompt = `${text}\n\nPlano aprovado:\n${plan.plan}`;
    await channel.message("assistant", plan.plan);

    const conversation = this.registry.getConversation(projectId, conversationId);
    if (plan.complexity === "complex") {
      const label = `codex:${this.config.defaultComplexModel}`;
      channel.routing({
        agent: label,
        model: this.config.defaultComplexModel,
        label: "feature complexa",
        stage: "plan",
        confidence: 1,
        source: "planner",
      });
      await channel.message("routing", `Opus: feature complexa -> ${this.config.defaultComplexModel}`, undefined, "plan.complex");
      const started = Date.now();
      await this.record(conversationId, channel, {
        type: "agent:started",
        level: "info",
        message: label,
        payload: { label, model: this.config.defaultComplexModel, role: "implementer" },
      });
      const run = await runCodexAgent({
        prompt: workerPrompt,
        worktreePath,
        model: this.config.defaultComplexModel,
        timeoutMs: this.config.agentTimeoutMs,
        signal,
        ...(conversation?.codexThreadId ? { resumeThreadId: conversation.codexThreadId } : {}),
        onEvent: (event) => this.streamCodex(conversationId, channel, event),
      });
      await this.registry.updateConversation(projectId, conversationId, {
        codexThreadId: run.threadId,
        activeAgent: label,
      });
      await this.addUsage(projectId, conversationId, channel, {
        label,
        model: this.config.defaultComplexModel,
        usage: run.usage,
        startedAt: started,
      });
    } else {
      channel.routing({
        agent: "claude:sonnet",
        model: "sonnet",
        label: "feature mais simples",
        stage: "plan",
        confidence: 1,
        source: "planner",
      });
      await channel.message("routing", "Opus: feature mais simples -> Sonnet", undefined, "plan.simple");
      await this.runClaude({
        projectId,
        conversationId,
        sessionId: conversation?.claudeSessionId,
        channel,
        worktreePath,
        label: "claude:sonnet",
        model: "sonnet",
        prompt: workerPrompt,
        tools: [...CLAUDE_TOOLS.implementer],
        maxTurns: 30,
        signal,
      });
    }
    return plan.plan;
  }

  private async correct(input: MissionRunInput, worktreePath: string, prompt: string): Promise<void> {
    const { projectId, conversationId, channel, signal } = input;
    const conversation = this.registry.getConversation(projectId, conversationId);
    if (conversation?.activeAgent?.startsWith("codex:")) {
      const label = conversation.activeAgent;
      const startedAt = Date.now();
      await this.record(conversationId, channel, { type: "agent:started", level: "info", message: `${label} (correction)`, payload: { role: "implementer" } });
      const run = await runCodexAgent({ prompt, worktreePath, model: this.config.defaultComplexModel, timeoutMs: this.config.agentTimeoutMs, signal, resumeThreadId: conversation.codexThreadId, onEvent: event => this.streamCodex(conversationId, channel, event) });
      await this.registry.updateConversation(projectId, conversationId, { codexThreadId: run.threadId });
      await this.addUsage(projectId, conversationId, channel, { label, model: this.config.defaultComplexModel, usage: run.usage, startedAt });
    } else {
      await this.runClaude({ projectId, conversationId, channel, signal, worktreePath, prompt, model: "sonnet", label: "claude:sonnet (correction)", tools: [...CLAUDE_TOOLS.implementer], maxTurns: 20, sessionId: conversation?.claudeSessionId });
    }
  }

  private async runClaude(args: {
    projectId: string;
    conversationId: string;
    sessionId?: string;
    channel: MissionChannel;
    worktreePath: string;
    label: string;
    model: ClaudeModel;
    prompt: string;
    tools: string[];
    maxTurns: number;
    signal: AbortSignal;
  }): Promise<void> {
    const startedAt = Date.now();
    await this.record(args.conversationId, args.channel, {
      type: "agent:started",
      level: "info",
      message: args.label,
      payload: { label: args.label, model: args.model, role: "implementer" },
    });
    const run = await runClaudeAgent({
      prompt: args.prompt,
      model: args.model,
      worktreePath: args.worktreePath,
      allowedTools: args.tools,
      maxTurns: args.maxTurns,
      timeoutMs: this.config.agentTimeoutMs,
      signal: args.signal,
      ...(args.sessionId ? { resumeSessionId: args.sessionId } : {}),
      onMessage: (message) => this.streamClaude(args.conversationId, args.channel, message),
    });
    await this.registry.updateConversation(args.projectId, args.conversationId, {
      claudeSessionId: run.sessionId,
      activeAgent: args.label,
    });
    await this.addUsage(args.projectId, args.conversationId, args.channel, {
      label: args.label,
      model: args.model,
      usage: run.usage,
      startedAt,
    });
  }

  private async ensureWorktree(
    project: Project,
    conversation: Conversation,
    channel: MissionChannel,
  ): Promise<{ worktreePath: string; branch: string; baseBranch: string }> {
    const root = project.rootPath;
    if (!(await hasCommits(root))) {
      await createInitialCommit(root);
      await channel.message(
        "system",
        "repositório sem commits: criei um commit inicial com os arquivos atuais",
      );
    } else if (await commitWorkingTree(root, "chore: claudex snapshot before task")) {
      await channel.message(
        "system",
        "havia alterações não commitadas: criei um snapshot para o worktree espelhar a pasta",
      );
    }
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
    channel: MissionChannel,
    info: UsageInfo,
  ): Promise<void> {
    const costUsd = estimateCostUsd(info.model, info.usage);
    const conversation = this.registry.getConversation(projectId, conversationId);
    if (conversation) {
      const previous = conversation.usage ?? { inputTokens: 0, outputTokens: 0, runs: 0 };
      await this.registry.updateConversation(projectId, conversationId, {
        usage: {
          inputTokens: previous.inputTokens + info.usage.inputTokens,
          outputTokens: previous.outputTokens + info.usage.outputTokens,
          runs: previous.runs + 1,
        },
        costUsd: (conversation.costUsd ?? 0) + costUsd,
      });
    }
    const endedAt = Date.now();
    const agentRun: AgentRun = {
      id: uuid(),
      missionId: conversationId,
      agentKind: agentKindOf(info.label),
      model: info.model,
      label: info.label,
      usage: info.usage,
      costUsd,
      startedAt: info.startedAt ?? endedAt,
      endedAt,
    };
    await this.record(conversationId, channel, {
      type: "agent:completed",
      level: "success",
      message: `${info.label} — ${info.usage.inputTokens} in / ${info.usage.outputTokens} out (~$${costUsd.toFixed(4)})`,
      payload: { run: agentRun },
    });
    await this.record(conversationId, channel, {
      type: "cost:updated",
      level: "info",
      message: `+$${costUsd.toFixed(4)}`,
      payload: { model: info.model, costUsd, usage: info.usage },
    });
  }

  private async record(
    missionId: string,
    channel: MissionChannel,
    event: MissionEventInput,
  ): Promise<void> {
    try {
      const stored = await this.events.append(missionId, event);
      channel.event(stored);
      const summary = await this.events.readSummary(missionId);
      if (summary) channel.summary(summary);
    } catch {
      // best effort — never break a mission because the log failed
    }
  }

  private streamClaude(conversationId: string, channel: MissionChannel, message: unknown): void {
    const record = message as { type?: string; subtype?: string; session_id?: string };
    if (record.type === "system" && record.subtype === "init") {
      void channel.message("system", `session ${record.session_id ?? "?"}`);
      return;
    }
    if (record.type === "assistant") {
      const content = (message as { message?: { content?: unknown[] } }).message?.content ?? [];
      for (const block of content) {
        const item = block as { type?: string; text?: string; name?: string; input?: unknown };
        if (item.type === "text" && item.text) {
          this.lastAssistantText.set(conversationId, item.text.trim());
          void channel.message("assistant", item.text);
        } else if (item.type === "tool_use") {
          const name = item.name ?? "tool";
          const input = shortJson(item.input);
          void channel.message("tool", name, input);
          void this.record(conversationId, channel, {
            type: "agent:tool",
            level: "info",
            message: name,
            payload: { input },
          });
        }
      }
      return;
    }
    if (record.type === "result" && record.subtype === "success") {
      const text = ((message as { result?: string }).result ?? "").trim();
      if (text && text !== this.lastAssistantText.get(conversationId)) {
        void channel.message("result", text);
      }
    }
  }

  private streamCodex(conversationId: string, channel: MissionChannel, event: unknown): void {
    const e = event as {
      type?: string;
      thread_id?: string;
      item?: { type?: string; text?: string; command?: string; changes?: unknown[] };
    };
    if (e.type === "thread.started") {
      void channel.message("system", `thread ${e.thread_id ?? "?"}`);
      return;
    }
    if (e.type !== "item.completed" && e.type !== "item.started" && e.type !== "item.updated") return;
    const item = e.item;
    if (!item) return;
    if (item.type === "agent_message" && item.text) void channel.message("assistant", item.text);
    else if (item.type === "reasoning" && item.text) void channel.message("assistant", item.text);
    else if (item.type === "command_execution" && item.command) {
      void channel.message("tool", item.command);
      void this.record(conversationId, channel, {
        type: "agent:tool",
        level: "info",
        message: item.command,
      });
    } else if (item.type === "file_change" && item.changes) {
      void channel.message("tool", "file_change", shortJson(item.changes));
    }
  }
}

function buildPlannerPrompt(task: string): string {
  return [
    "Voce e um arquiteto de software. Analise a tarefa e produza um plano de implementacao conciso.",
    "Decida se e uma FEATURE COMPLEXA (multiplos arquivos, integracoes, logica densa) ou uma FEATURE MAIS SIMPLES (mudanca focada).",
    "Liste de 1 a 6 subtarefas curtas que representam o trabalho.",
    'Responda APENAS com JSON valido no formato: { "complexity": "complex" | "simple", "plan": string, "subtasks": string[] }',
    "",
    `Tarefa: ${task}`,
  ].join("\n");
}

function parsePlan(text: string): { complexity: "complex" | "simple"; plan: string; subtasks: string[] } {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start !== -1 && end > start) {
    try {
      const parsed = JSON.parse(text.slice(start, end + 1)) as {
        complexity?: unknown;
        plan?: unknown;
        subtasks?: unknown;
      };
      return {
        complexity: parsed.complexity === "complex" ? "complex" : "simple",
        plan: typeof parsed.plan === "string" ? parsed.plan : text,
        subtasks: Array.isArray(parsed.subtasks)
          ? parsed.subtasks.filter((item): item is string => typeof item === "string").slice(0, 8)
          : [],
      };
    } catch {
      // fall through
    }
  }
  return { complexity: "simple", plan: text.slice(0, 800), subtasks: [] };
}

function shortJson(value: unknown): string {
  try {
    const text = typeof value === "string" ? value : JSON.stringify(value);
    return text.slice(0, 300);
  } catch {
    return "";
  }
}
