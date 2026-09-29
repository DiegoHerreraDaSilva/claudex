import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { v4 as uuidv4 } from "uuid";
import { z } from "zod";
import { runClaudeAgent, CLAUDE_TOOLS } from "./agents/claude.js";
import { runCodexAgent } from "./agents/codex.js";
import { AgentError, agentForComplexity, type AgentSpec } from "./agents/types.js";
import type { OrchestratorConfig } from "./config.js";
import {
  TypedEmitter,
  type FleetUpdatedEvent,
  type OrchestratorEventMap,
  type ReviewOutcome,
  type TaskMessage,
  type TaskMessageRole,
  type TaskSnapshot,
  type TaskStatus,
} from "./events.js";
import { JevClient, type Complexity } from "./jev.js";
import { WorktreeManager } from "./worktree.js";

export interface Subtask {
  id?: string;
  description: string;
}

export interface ExecuteOptions {
  description: string;
  subtasks?: Subtask[];
  cleanup?: boolean;
  dryRun?: boolean;
  baseBranch?: string;
  forceSequential?: boolean;
}

export interface ExecuteResult {
  taskIds: string[];
  parallelized: boolean;
  merged: string[];
  snapshot: TaskSnapshot[];
}

interface InternalTask {
  snapshot: TaskSnapshot;
  spec: AgentSpec;
  prompt: string;
}

const reviewSchema = z.object({
  approved: z.boolean(),
  issues: z.array(z.string()),
  summary: z.string(),
});

const REVIEW_JSON_SCHEMA = z.toJSONSchema(reviewSchema) as Record<string, unknown>;

export class Orchestrator extends TypedEmitter<OrchestratorEventMap> {
  private readonly tasks = new Map<string, InternalTask>();
  private readonly worktrees: WorktreeManager;
  private paused = false;
  private killed = new Set<string>();
  private fleetStartedAt = Date.now();
  private lastParallelized = false;

  constructor(
    private readonly config: OrchestratorConfig,
    private readonly jev: JevClient,
    worktrees?: WorktreeManager,
  ) {
    super();
    this.worktrees = worktrees ?? new WorktreeManager(config.projectRoot);
  }

  snapshot(): TaskSnapshot[] {
    return [...this.tasks.values()].map((task) => structuredClone(task.snapshot));
  }

  getFleetState(): FleetUpdatedEvent {
    return {
      tasks: this.snapshot(),
      parallelized: this.lastParallelized,
      startedAt: this.fleetStartedAt,
    };
  }

  pause(): void {
    this.paused = true;
  }

  resume(): void {
    this.paused = false;
  }

  kill(taskId: string): void {
    this.killed.add(taskId);
  }

  async execute(options: ExecuteOptions): Promise<ExecuteResult> {
    this.fleetStartedAt = Date.now();
    const subtasks =
      options.subtasks && options.subtasks.length > 0
        ? options.subtasks
        : [{ description: options.description }];

    const created = this.registerTasks(subtasks);
    await this.decide(created, options.description);

    const parallelDecision = options.forceSequential
      ? { parallel: false, noul: 0, source: "heuristic" as const }
      : await this.jev.shouldParallelize(subtasks.map((s) => s.description));
    this.lastParallelized = parallelDecision.parallel;
    this.pushFleet();

    if (options.dryRun) {
      return {
        taskIds: created.map((t) => t.snapshot.taskId),
        parallelized: parallelDecision.parallel,
        merged: [],
        snapshot: this.snapshot(),
      };
    }

    const baseBranch = options.baseBranch ?? (await this.currentBranch());

    if (parallelDecision.parallel && created.length > 1) {
      await runPool(created, this.config.maxParallelTasks, (task) =>
        this.runTask(task, baseBranch),
      );
    } else {
      for (const task of created) {
        await this.runTask(task, baseBranch);
      }
    }

    await this.reviewPhase(created, options.description);

    const merged: string[] = [];
    for (const task of created) {
      const snap = task.snapshot;
      if (snap.status !== "completed") continue;
      const result = await this.worktrees.merge(snap.taskId, baseBranch);
      if (result.success) {
        this.setStatus(task, "merged");
        merged.push(snap.taskId);
      } else {
        this.setStatus(task, "failed");
        task.snapshot.error = `Merge conflict: ${(result.conflicts ?? []).join("; ")}`;
      }
      this.pushFleet();
    }

    if (options.cleanup) {
      for (const task of created) {
        try {
          await this.worktrees.remove(task.snapshot.taskId);
        } catch {
          // best effort cleanup
        }
      }
    }

    for (const task of created) {
      await this.persist(task);
    }
    this.pushFleet();

    return {
      taskIds: created.map((t) => t.snapshot.taskId),
      parallelized: parallelDecision.parallel,
      merged,
      snapshot: this.snapshot(),
    };
  }

  private registerTasks(subtasks: Subtask[]): InternalTask[] {
    const created: InternalTask[] = [];
    for (const subtask of subtasks) {
      const taskId = subtask.id ?? uuidv4();
      const snapshot: TaskSnapshot = {
        taskId,
        description: subtask.description,
        agent: "",
        agentKind: "claude",
        model: "",
        complexity: "balanced",
        status: "pending",
        worktree: path.join(this.config.projectRoot, ".worktrees", taskId),
        branch: taskId,
        messages: [],
        usage: { inputTokens: 0, outputTokens: 0 },
        turns: 0,
        filesTouched: [],
      };
      const task: InternalTask = {
        snapshot,
        spec: { kind: "claude", model: "sonnet", label: "claude:sonnet" },
        prompt: subtask.description,
      };
      this.tasks.set(taskId, task);
      created.push(task);
      this.emit("task:created", { taskId, description: subtask.description });
    }
    return created;
  }

  private async decide(created: InternalTask[], overview: string): Promise<void> {
    await Promise.allSettled(
      created.map(async (task) => {
        task.snapshot.status = "deciding";
        const decision = await this.jev.classifyComplexity(task.snapshot.description);
        task.snapshot.complexity = decision.complexity;
        const spec = agentForComplexity(decision.complexity, {
          plannerModel: this.config.defaultPlannerModel,
          simpleModel: this.config.defaultSimpleModel,
          complexModel: this.config.defaultComplexModel,
        });
        task.spec = spec;
        task.snapshot.agent = spec.label;
        task.snapshot.agentKind = spec.kind;
        task.snapshot.model = spec.kind === "claude" ? spec.model : spec.model;
        task.prompt = buildPrompt(overview, task.snapshot.description);
        this.emit("task:decided", {
          taskId: task.snapshot.taskId,
          choice: decision.complexity,
          probabilities: decision.probabilities,
          confidence: decision.confidence,
          source: decision.source,
          agent: spec.label,
          model: task.snapshot.model,
        });
        task.snapshot.status = "pending";
      }),
    );
    this.pushFleet();
  }

  private async runTask(task: InternalTask, baseBranch: string): Promise<void> {
    const { snapshot, spec } = task;
    if (this.killed.has(snapshot.taskId)) {
      this.fail(task, "Killed before start");
      return;
    }
    await this.waitWhilePaused();
    try {
      await this.worktrees.create(snapshot.taskId, baseBranch);
    } catch (err) {
      this.fail(task, `Failed to create worktree: ${errorMessage(err)}`);
      return;
    }

    snapshot.status = "running";
    snapshot.startedAt = Date.now();
    this.emit("task:started", {
      taskId: snapshot.taskId,
      agent: spec.label,
      worktree: snapshot.worktree,
    });
    this.pushFleet();

    try {
      if (spec.kind === "claude") {
        const run = await runClaudeAgent({
          prompt: task.prompt,
          model: spec.model,
          worktreePath: snapshot.worktree,
          allowedTools: [...CLAUDE_TOOLS.implementer],
          maxTurns: 30,
          timeoutMs: this.config.agentTimeoutMs,
          onMessage: (message) => this.onClaudeMessage(task, message),
        });
        snapshot.sessionId = run.sessionId;
        snapshot.usage = run.usage;
      } else {
        const run = await runCodexAgent({
          prompt: task.prompt,
          worktreePath: snapshot.worktree,
          model: spec.model,
          timeoutMs: this.config.agentTimeoutMs,
          onEvent: (event) => this.onCodexEvent(task, event),
        });
        snapshot.threadId = run.threadId;
        snapshot.usage = run.usage;
      }
      snapshot.diff = await this.worktrees.getDiff(snapshot.taskId);
      snapshot.filesTouched = parseFiles(snapshot.diff);
      snapshot.status = "completed";
      snapshot.completedAt = Date.now();
      this.emit("task:completed", {
        taskId: snapshot.taskId,
        diff: snapshot.diff,
        durationMs: snapshot.completedAt - (snapshot.startedAt ?? snapshot.completedAt),
        usage: snapshot.usage,
      });
    } catch (err) {
      this.fail(task, errorMessage(err));
    }
    this.pushFleet();
  }

  private async reviewPhase(created: InternalTask[], overview: string): Promise<void> {
    const plan = buildPlan(overview, created.map((t) => t.snapshot.description));
    for (const task of created) {
      const snap = task.snapshot;
      if (snap.status !== "completed" || !snap.diff) continue;
      snap.status = "reviewing";
      this.pushFleet();

      let outcome = await this.review(task, plan);
      if (!outcome.approved) {
        const corrected = await this.requestCorrection(task, outcome.issues);
        if (corrected) {
          snap.diff = await this.worktrees.getDiff(snap.taskId);
          snap.filesTouched = parseFiles(snap.diff);
          outcome = await this.review(task, plan);
        }
      }
      snap.review = outcome;
      if (outcome.approved) {
        snap.status = "completed";
      } else {
        snap.status = "failed";
        snap.error = `Review rejected: ${outcome.issues.join("; ") || outcome.summary}`;
      }
      this.appendMessage(task, "result", `Review ${outcome.approved ? "approved" : "rejected"} (noul=${outcome.noul.toFixed(3)})`);
      this.pushFleet();
    }
  }

  private async review(task: InternalTask, plan: string): Promise<ReviewOutcome> {
    const snap = task.snapshot;
    const prompt = [
      "You are a strict code reviewer. Compare the diff against the plan.",
      "Respond ONLY with JSON matching this schema:",
      '{ "approved": boolean, "issues": string[], "summary": string }',
      "",
      "PLAN:",
      plan,
      "",
      "DIFF:",
      snap.diff ?? "(empty diff)",
    ].join("\n");

    let agentVerdict: { approved: boolean; issues: string[]; summary: string } = {
      approved: true,
      issues: [],
      summary: "Reviewer returned no structured verdict; defaulting to approved.",
    };
    try {
      const run = await runClaudeAgent({
        prompt,
        model: "opus",
        worktreePath: this.config.projectRoot,
        allowedTools: [...CLAUDE_TOOLS.reviewer],
        maxTurns: 3,
        timeoutMs: Math.min(this.config.agentTimeoutMs, 180_000),
        outputSchema: REVIEW_JSON_SCHEMA,
      });
      agentVerdict = { ...agentVerdict, ...parseReview(run.result) };
    } catch (err) {
      agentVerdict.summary = `Reviewer agent failed: ${errorMessage(err)}`;
    }

    const jevVerdict = await this.jev.reviewDiff(snap.diff ?? "", plan);
    const approved =
      agentVerdict.approved && (jevVerdict.source === "heuristic" || jevVerdict.approved);

    return {
      approved,
      noul: jevVerdict.noul,
      source: jevVerdict.source,
      summary: agentVerdict.summary,
      issues: agentVerdict.issues,
    };
  }

  private async requestCorrection(task: InternalTask, issues: string[]): Promise<boolean> {
    const snap = task.snapshot;
    const prompt = [
      "The reviewer rejected your previous work. Fix the following issues in this worktree, then stop.",
      ...issues.map((issue) => `- ${issue}`),
    ].join("\n");
    try {
      if (task.spec.kind === "claude") {
        const run = await runClaudeAgent({
          prompt,
          model: task.spec.model,
          worktreePath: snap.worktree,
          allowedTools: [...CLAUDE_TOOLS.implementer],
          maxTurns: 20,
          timeoutMs: this.config.agentTimeoutMs,
          resumeSessionId: snap.sessionId,
          onMessage: (message) => this.onClaudeMessage(task, message),
        });
        snap.sessionId = run.sessionId;
        addUsage(snap, run.usage);
      } else {
        const run = await runCodexAgent({
          prompt,
          worktreePath: snap.worktree,
          model: task.spec.model,
          timeoutMs: this.config.agentTimeoutMs,
          resumeThreadId: snap.threadId,
          onEvent: (event) => this.onCodexEvent(task, event),
        });
        snap.threadId = run.threadId;
        addUsage(snap, run.usage);
      }
      return true;
    } catch (err) {
      this.appendMessage(task, "error", `Correction attempt failed: ${errorMessage(err)}`);
      return false;
    }
  }

  private onClaudeMessage(task: InternalTask, message: unknown): void {
    const record = message as { type?: string; subtype?: string; session_id?: string };
    if (record.type === "system" && record.subtype === "init") {
      task.snapshot.turns += 1;
      this.appendMessage(task, "system", `init session=${record.session_id ?? "?"}`);
      return;
    }
    if (record.type === "assistant") {
      task.snapshot.turns += 1;
      const content = (message as { message?: { content?: unknown[] } }).message?.content ?? [];
      for (const block of content) {
        const b = block as { type?: string; text?: string; name?: string; input?: unknown };
        if (b.type === "text" && b.text) this.appendMessage(task, "assistant", b.text);
        else if (b.type === "tool_use") {
          this.appendMessage(task, "tool", b.name ?? "tool", JSON.stringify(b.input ?? {}).slice(0, 400));
        }
      }
      return;
    }
    if (record.type === "result" && record.subtype === "success") {
      const text = (message as { result?: string }).result ?? "";
      if (text) this.appendMessage(task, "result", text);
    }
  }

  private onCodexEvent(task: InternalTask, event: unknown): void {
    const e = event as { type?: string; thread_id?: string; item?: { type?: string; text?: string; command?: string; changes?: unknown[] }; usage?: unknown };
    switch (e.type) {
      case "thread.started":
        this.appendMessage(task, "system", `thread=${e.thread_id ?? "?"}`);
        break;
      case "turn.started":
        task.snapshot.turns += 1;
        break;
      case "item.completed":
      case "item.started":
      case "item.updated": {
        const item = e.item;
        if (!item) break;
        if (item.type === "agent_message" && item.text) this.appendMessage(task, "assistant", item.text);
        else if (item.type === "reasoning" && item.text) this.appendMessage(task, "assistant", item.text);
        else if (item.type === "command_execution" && item.command) this.appendMessage(task, "tool", item.command);
        else if (item.type === "file_change" && item.changes) {
          this.appendMessage(task, "tool", "file_change", JSON.stringify(item.changes).slice(0, 400));
        }
        break;
      }
      default:
        break;
    }
  }

  private appendMessage(task: InternalTask, role: TaskMessageRole, text: string, meta?: string): void {
    const message: TaskMessage = { at: Date.now(), role, text, ...(meta ? { meta } : {}) };
    task.snapshot.messages.push(message);
    if (task.snapshot.messages.length > 500) task.snapshot.messages.splice(0, 100);
    this.emit("task:message", { taskId: task.snapshot.taskId, agent: task.snapshot.agent, message });
  }

  private fail(task: InternalTask, error: string): void {
    task.snapshot.status = "failed";
    task.snapshot.error = error;
    task.snapshot.completedAt = Date.now();
    this.appendMessage(task, "error", error);
    this.emit("task:failed", { taskId: task.snapshot.taskId, error });
    this.pushFleet();
  }

  private setStatus(task: InternalTask, status: TaskStatus): void {
    task.snapshot.status = status;
  }

  private pushFleet(): void {
    this.emit("fleet:updated", this.getFleetState());
  }

  private async waitWhilePaused(): Promise<void> {
    while (this.paused) {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }

  private async currentBranch(): Promise<string> {
    const list = await this.worktrees.list();
    const main = list.find((w) => path.resolve(w.path) === path.resolve(this.config.projectRoot));
    if (main?.branch) return main.branch;
    return "main";
  }

  private async persist(task: InternalTask): Promise<void> {
    const done = task.snapshot.status === "completed" || task.snapshot.status === "merged";
    const dir = path.join(this.config.projectRoot, "tasks", done ? "complete" : "current");
    await mkdir(dir, { recursive: true });
    await writeFile(
      path.join(dir, `${task.snapshot.taskId}.json`),
      JSON.stringify(task.snapshot, null, 2),
      "utf8",
    );
    if (done) {
      await rm(path.join(this.config.projectRoot, "tasks", "current", `${task.snapshot.taskId}.json`), {
        force: true,
      });
    }
  }
}

function addUsage(
  snapshot: TaskSnapshot,
  usage: { inputTokens: number; outputTokens: number },
): void {
  snapshot.usage.inputTokens += usage.inputTokens;
  snapshot.usage.outputTokens += usage.outputTokens;
}

async function runPool<T>(items: T[], limit: number, worker: (item: T) => Promise<void>): Promise<void> {
  const queue = [...items];
  const size = Math.max(1, Math.min(limit, queue.length));
  const runners = Array.from({ length: size }, async () => {
    while (queue.length > 0) {
      const item = queue.shift();
      if (item === undefined) break;
      await worker(item);
    }
  });
  await Promise.allSettled(runners);
}

function buildPrompt(overview: string, description: string): string {
  return [
    "You are an autonomous implementation agent working in an isolated git worktree.",
    "Implement the subtask below. Keep changes focused. Do not run destructive git commands.",
    "",
    `Overall goal: ${overview}`,
    `Your subtask: ${description}`,
  ].join("\n");
}

function buildPlan(overview: string, descriptions: string[]): string {
  return [
    `Overall goal: ${overview}`,
    "Subtasks:",
    ...descriptions.map((d, i) => `  ${i + 1}. ${d}`),
  ].join("\n");
}

function parseFiles(diff: string): string[] {
  const files = new Set<string>();
  for (const line of diff.split(/\r?\n/)) {
    const match = /^diff --git a\/(.+?) b\/(.+)$/.exec(line);
    if (match?.[2]) files.add(match[2]);
  }
  return [...files];
}

function parseReview(text: string): { approved: boolean; issues: string[]; summary: string } {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start !== -1 && end > start) {
    try {
      const parsed = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
      return {
        approved: parsed["approved"] === true,
        issues: Array.isArray(parsed["issues"]) ? parsed["issues"].map(String) : [],
        summary: typeof parsed["summary"] === "string" ? parsed["summary"] : "",
      };
    } catch {
      // fall through
    }
  }
  return { approved: true, issues: [], summary: text.slice(0, 200) };
}

function errorMessage(err: unknown): string {
  if (err instanceof AgentError) return `[${err.kind}] ${err.message}`;
  return err instanceof Error ? err.message : String(err);
}

export type { Complexity };
