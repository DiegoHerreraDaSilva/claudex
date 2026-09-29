#!/usr/bin/env node
import path from "node:path";
import process from "node:process";
import chalk from "chalk";
import { getConfig, setEnvValues } from "./config.js";
import { runAccountAction } from "./accounts.js";
import { ProjectRegistry } from "./app/projects.js";
import { ChatService } from "./app/chat.js";
import { createAppServer } from "./server/appServer.js";
import { JevClient } from "./jev.js";
import { Orchestrator, type Subtask } from "./orchestrator.js";
import { attachRealtime, type RealtimeHooks } from "./server/ws.js";
import { createStaticServer } from "./server/static.js";
import { checkPrerequisites, getCredentialStatus, type PrerequisiteReport } from "./prerequisites.js";
import { WorktreeManager } from "./worktree.js";
import type { TaskSnapshot } from "./events.js";

const claudeColor = chalk.hex("#b48ead");
const codexColor = chalk.hex("#5e81ac");
const ok = chalk.green;
const warn = chalk.yellow;
const bad = chalk.red;
const dim = chalk.gray;

interface CliArgs {
  command: string;
  positional: string[];
  subtasks?: Subtask[];
  cleanup: boolean;
  dryRun: boolean;
  noServer: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { command: "", positional: [], cleanup: false, dryRun: false, noServer: false };
  const rest = argv.slice(2);
  const first = rest[0];
  if (!first || first.startsWith("-")) {
    args.command = "help";
    return args;
  }
  args.command = first;
  for (let i = 1; i < rest.length; i++) {
    const token = rest[i] ?? "";
    if (token === "--cleanup") args.cleanup = true;
    else if (token === "--dry-run") args.dryRun = true;
    else if (token === "--no-server") args.noServer = true;
    else if (token === "--subtasks") {
      const value = rest[++i];
      if (!value) throw new Error("--subtasks requires a JSON argument");
      args.subtasks = parseSubtasks(value);
    } else if (!token.startsWith("-")) {
      args.positional.push(token);
    }
  }
  return args;
}

function parseSubtasks(value: string): Subtask[] {
  const parsed = JSON.parse(value) as unknown;
  if (!Array.isArray(parsed)) throw new Error("--subtasks must be a JSON array of strings or {description} objects");
  return parsed.map((entry) => {
    if (typeof entry === "string") return { description: entry };
    if (typeof entry === "object" && entry !== null && typeof (entry as { description?: unknown }).description === "string") {
      const obj = entry as { id?: string; description: string };
      return obj.id ? { id: obj.id, description: obj.description } : { description: obj.description };
    }
    throw new Error("each subtask must be a string or an object with a description");
  });
}

function printChecks(report: PrerequisiteReport): void {
  console.log(chalk.bold("\nPrerequisites"));
  for (const check of report.checks) {
    const tag = check.status === "ok" ? ok("  ok  ") : check.status === "warn" ? warn(" warn ") : bad(" fail ");
    console.log(`${tag} ${chalk.bold(check.name)} ${dim("-")} ${check.detail}`);
  }
  console.log("");
}

function renderStatus(tasks: TaskSnapshot[]): void {
  if (tasks.length === 0) {
    console.log(dim("No tasks in the fleet."));
    return;
  }
  for (const task of tasks) {
    const color = task.agentKind === "codex" ? codexColor : claudeColor;
    const status = statusLabel(task.status);
    console.log(
      `${color(task.agent.padEnd(18))} ${status} ${chalk.bold(task.taskId.slice(0, 8))} ${dim(task.description.slice(0, 60))}`,
    );
    console.log(
      dim(
        `  complexity=${task.complexity} turns=${task.turns} in=${task.usage.inputTokens} out=${task.usage.outputTokens} files=${task.filesTouched.length}`,
      ),
    );
    if (task.error) console.log(bad(`  error: ${task.error}`));
  }
}

function statusLabel(status: TaskSnapshot["status"]): string {
  switch (status) {
    case "completed":
    case "merged":
      return ok(status.padEnd(10));
    case "failed":
      return bad(status.padEnd(10));
    case "running":
    case "deciding":
    case "reviewing":
      return warn(status.padEnd(10));
    default:
      return dim(status.padEnd(10));
  }
}

function wireConsole(orchestrator: Orchestrator): void {
  orchestrator.on("task:created", (e) => {
    console.log(dim(`[task] created ${e.taskId.slice(0, 8)} :: ${e.description}`));
  });
  orchestrator.on("task:decided", (e) => {
    const color = e.agent.startsWith("codex") ? codexColor : claudeColor;
    console.log(
      `${chalk.bold("[jev]")} ${e.taskId.slice(0, 8)} -> ${color(e.agent)} (${e.choice}, conf ${e.confidence.toFixed(2)}, ${e.source})`,
    );
  });
  orchestrator.on("task:started", (e) => {
    console.log(dim(`[run] ${e.taskId.slice(0, 8)} worktree=${e.worktree}`));
  });
  orchestrator.on("task:completed", (e) => {
    console.log(
      ok(`[done] ${e.taskId.slice(0, 8)} in ${(e.durationMs / 1000).toFixed(1)}s, ${e.diff.split("\n").length} diff lines`),
    );
  });
  orchestrator.on("task:failed", (e) => {
    console.log(bad(`[fail] ${e.taskId.slice(0, 8)} ${e.error}`));
  });
}

function buildHooks(): RealtimeHooks {
  return {
    getCredentialStatus: () => getCredentialStatus(getConfig()),
    applySettings: (values) => {
      setEnvValues(getConfig().projectRoot, values);
      return getCredentialStatus(getConfig());
    },
    runAccountAction: (provider, action, onLine) =>
      runAccountAction(provider, action, getConfig().projectRoot, onLine),
  };
}

async function startServer(orchestrator: Orchestrator, port: number): Promise<void> {
  const server = createStaticServer(orchestrator, { startedAt: Date.now() });
  attachRealtime(server, orchestrator, buildHooks());
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, () => resolve());
  });
  console.log(ok(`dashboard: http://localhost:${port}`) + dim(`  (ws + http on the same port)`));
}

async function commandRun(args: CliArgs): Promise<number> {
  const description = args.positional.join(" ").trim();
  if (!description && (!args.subtasks || args.subtasks.length === 0)) {
    console.error(bad("Usage: claudex run \"<description>\" [--subtasks <json>] [--cleanup] [--dry-run]"));
    return 2;
  }
  const config = getConfig();
  const report = await checkPrerequisites(config, {
    requireClaude: !args.dryRun,
    requireCodex: !args.dryRun,
  });
  printChecks(report);
  if (!report.ok) {
    console.error(bad("Aborting: critical prerequisites missing."));
    return 1;
  }

  const jev = new JevClient(config);
  const orchestrator = new Orchestrator(config, jev);
  wireConsole(orchestrator);

  if (!args.noServer && !args.dryRun) {
    try {
      await startServer(orchestrator, config.wsPort);
    } catch (err) {
      console.error(warn(`Could not start dashboard: ${err instanceof Error ? err.message : err}`));
    }
  }

  const result = await orchestrator.execute({
    description: description || "fleet",
    subtasks: args.subtasks,
    cleanup: args.cleanup,
    dryRun: args.dryRun,
  });

  console.log("");
  renderStatus(result.snapshot);
  console.log("");
  if (args.dryRun) {
    console.log(warn(`Dry run: routed ${result.taskIds.length} subtask(s), parallel=${result.parallelized}. No agents executed.`));
  } else {
    console.log(ok(`Fleet complete. merged=${result.merged.length}/${result.taskIds.length}`));
  }
  if (!args.noServer && !args.dryRun) {
    console.log(dim("Dashboard still running. Press Ctrl+C to exit."));
    await new Promise<void>((resolve) => {
      process.on("SIGINT", () => resolve());
      process.on("SIGTERM", () => resolve());
    });
  }
  return 0;
}

async function commandDashboard(): Promise<number> {
  const config = getConfig();
  const jev = new JevClient(config);
  const orchestrator = new Orchestrator(config, jev);
  await startServer(orchestrator, config.wsPort);
  console.log(dim("Idle orchestrator serving. Press Ctrl+C to exit."));
  await new Promise<void>((resolve) => {
    process.on("SIGINT", () => resolve());
    process.on("SIGTERM", () => resolve());
  });
  return 0;
}

async function commandApp(): Promise<number> {
  const config = getConfig();
  const dataDir = path.join(config.projectRoot, ".claudex");
  const worktreesBase = path.join(dataDir, "worktrees");
  const registry = new ProjectRegistry(dataDir);
  await registry.load();
  const chat = new ChatService(registry, new JevClient(config), config, worktreesBase);
  const srv = createAppServer({ chat, registry, config });
  try {
    const port = await srv.listen(config.wsPort);
    console.log(ok(`claudex: http://localhost:${port}`) + dim("  (abra no navegador)"));
  } catch (err) {
    console.error(bad(`Could not start app server: ${err instanceof Error ? err.message : err}`));
    return 1;
  }
  await new Promise<void>((resolve) => {
    process.on("SIGINT", () => resolve());
    process.on("SIGTERM", () => resolve());
  });
  return 0;
}

async function commandWorktrees(): Promise<number> {
  const config = getConfig();
  const manager = new WorktreeManager(config.projectRoot);
  const list = await manager.list();
  if (list.length === 0) {
    console.log(dim("No worktrees."));
    return 0;
  }
  for (const wt of list) {
    const flag = wt.dirty ? warn("dirty") : ok("clean");
    console.log(`${chalk.bold(wt.id)} ${flag} ${dim(wt.branch)} ${dim(wt.path)}`);
  }
  return 0;
}

async function commandClean(): Promise<number> {
  const config = getConfig();
  const manager = new WorktreeManager(config.projectRoot);
  const list = await manager.list();
  let removed = 0;
  for (const wt of list) {
    if (wt.id === "." || wt.id === "") continue;
    if (!wt.path.replace(/\\/g, "/").includes("/.worktrees/")) continue;
    try {
      await manager.remove(wt.id);
      removed += 1;
      console.log(ok(`removed ${wt.id}`));
    } catch (err) {
      console.error(warn(`could not remove ${wt.id}: ${err instanceof Error ? err.message : err}`));
    }
  }
  console.log(dim(`Cleaned ${removed} worktree(s).`));
  return 0;
}

function commandHelp(): number {
  console.log(
    [
      chalk.bold("Claudex"),
      "",
      "  claudex run \"<description>\"   full flow: route, execute in worktrees, review, merge",
      "  claudex dashboard            start WS + HTTP dashboard server (works while idle)",
      "  claudex app                  start the chat app (projects + continuous sessions)",
      "  claudex status               print the current fleet snapshot",
      "  claudex worktrees            list active worktrees",
      "  claudex clean                remove orphan worktrees and branches",
      "",
      "Options for `run`:",
      "  --subtasks <json>        manual subtasks, e.g. '[\"a\",\"b\"]'",
      "  --cleanup                remove worktrees after finishing",
      "  --dry-run                ask Jev for routing only, run no agents",
      "  --no-server              do not start the dashboard during run",
    ].join("\n"),
  );
  return 0;
}

async function main(): Promise<void> {
  let args: CliArgs;
  try {
    args = parseArgs(process.argv);
  } catch (err) {
    console.error(bad(err instanceof Error ? err.message : String(err)));
    process.exit(2);
  }
  let code = 0;
  switch (args.command) {
    case "run":
      code = await commandRun(args);
      break;
    case "dashboard":
      code = await commandDashboard();
      break;
    case "app":
      code = await commandApp();
      break;
    case "status": {
      const config = getConfig();
      const orchestrator = new Orchestrator(config, new JevClient(config));
      renderStatus(orchestrator.snapshot());
      break;
    }
    case "worktrees":
      code = await commandWorktrees();
      break;
    case "clean":
      code = await commandClean();
      break;
    default:
      code = commandHelp();
  }
  process.exit(code);
}

main().catch((err: unknown) => {
  console.error(bad(`Fatal: ${err instanceof Error ? err.stack ?? err.message : String(err)}`));
  process.exit(1);
});
