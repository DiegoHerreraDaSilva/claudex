import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

export interface OrchestratorConfig {
  typesafeApiKey: string;
  typesafeBaseUrl: string;
  jevModel: string;
  jevCacheTtlMs: number;
  wsPort: number;
  agentTimeoutMs: number;
  maxParallelTasks: number;
  defaultPlannerModel: string;
  defaultSimpleModel: string;
  defaultComplexModel: string;
  projectRoot: string;
}

function loadDotEnv(root: string): void {
  const file = resolve(root, ".env");
  if (!existsSync(file)) return;
  const content = readFileSync(file, "utf8");
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

function intEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

let cached: OrchestratorConfig | undefined;

export function getConfig(): OrchestratorConfig {
  if (cached) return cached;
  const projectRoot = process.env["JEV_PROJECT_ROOT"] ?? process.cwd();
  loadDotEnv(projectRoot);
  const cacheTtlSeconds = intEnv("JEV_CACHE_TTL", 3600);
  cached = {
    typesafeApiKey: process.env["TYPESAFE_API_KEY"] ?? "",
    typesafeBaseUrl: process.env["TYPESAFE_BASE_URL"] ?? "https://api.typesafe.ai",
    jevModel: process.env["JEV_MODEL"] ?? "jev-latest",
    jevCacheTtlMs: cacheTtlSeconds * 1000,
    wsPort: intEnv("WS_PORT", 8080),
    agentTimeoutMs: intEnv("AGENT_TIMEOUT_MS", 600_000),
    maxParallelTasks: intEnv("MAX_PARALLEL_TASKS", 3),
    defaultPlannerModel: process.env["DEFAULT_PLANNER_MODEL"] ?? "opus",
    defaultSimpleModel: process.env["DEFAULT_SIMPLE_MODEL"] ?? "sonnet",
    defaultComplexModel: process.env["DEFAULT_COMPLEX_MODEL"] ?? "gpt-6-sol",
    projectRoot,
  };
  return cached;
}
