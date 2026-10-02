import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path, { resolve } from "node:path";
import { appDataDir } from "./app/paths.js";
import { configuredEffort, type AgentEffort } from "./agents/effort.js";
export interface OrchestratorConfig {
  typesafeApiKey: string;
  typesafeBaseUrl: string;
  jevModel: string;
  jevCacheTtlMs: number;
  wsPort: number;
  agentTimeoutMs: number;
  defaultPlannerModel: string;
  defaultSimpleModel: string;
  defaultComplexModel: string;
  defaultPlannerEffort?: AgentEffort;
  defaultSimpleEffort?: AgentEffort;
  defaultComplexEffort?: AgentEffort;
  projectRoot: string;
  dataDir: string;
  logsDir: string;
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
const PLACEHOLDER_KEYS = new Set([
  "sua-chave",
  "your-key",
  "your-api-key",
  "changeme",
  "api-key",
  "sk-...",
  "<api-key>",
  "xxx",
]);
function cleanApiKey(raw: string | undefined): string {
  const value = (raw ?? "").trim();
  if (!value) return "";
  if (PLACEHOLDER_KEYS.has(value.toLowerCase())) return "";
  return value;
}
let cached: OrchestratorConfig | undefined;
export function getConfig(): OrchestratorConfig {
  if (cached) return cached;
  const projectRoot =
    process.env["CLAUDEX_ROOT"] ?? process.env["JEV_PROJECT_ROOT"] ?? process.cwd();
  const dataDir = process.env["CLAUDEX_DATA_DIR"]?.trim() || appDataDir();
  loadDotEnv(dataDir);
  loadDotEnv(projectRoot);
  const cacheTtlSeconds = intEnv("JEV_CACHE_TTL", 3600);
  cached = {
    typesafeApiKey: cleanApiKey(process.env["TYPESAFE_API_KEY"]),
    typesafeBaseUrl: process.env["TYPESAFE_BASE_URL"] ?? "https://api.typesafe.ai",
    jevModel: process.env["JEV_MODEL"] ?? "jev-latest",
    jevCacheTtlMs: cacheTtlSeconds * 1000,
    wsPort: intEnv("WS_PORT", 8080),
    agentTimeoutMs: intEnv("AGENT_TIMEOUT_MS", 600_000),
    defaultPlannerModel: process.env["DEFAULT_PLANNER_MODEL"] ?? "opus",
    defaultSimpleModel: process.env["DEFAULT_SIMPLE_MODEL"] ?? "sonnet",
    defaultComplexModel: process.env["DEFAULT_COMPLEX_MODEL"] ?? "gpt-6-sol",
    defaultPlannerEffort: configuredEffort(process.env["DEFAULT_PLANNER_EFFORT"]),
    defaultSimpleEffort: configuredEffort(process.env["DEFAULT_SIMPLE_EFFORT"]),
    defaultComplexEffort: configuredEffort(process.env["DEFAULT_COMPLEX_EFFORT"]),
    projectRoot,
    dataDir,
    logsDir: path.join(dataDir, "logs"),
  };
  return cached;
}
export function updateConfig(patch: Partial<OrchestratorConfig>): OrchestratorConfig {
  const config = getConfig();
  Object.assign(config, patch);
  return config;
}
export function reloadConfig(): OrchestratorConfig {
  const cfg = getConfig();
  Object.assign(cfg, {
    typesafeApiKey: cleanApiKey(process.env["TYPESAFE_API_KEY"]),
    typesafeBaseUrl: process.env["TYPESAFE_BASE_URL"] ?? cfg.typesafeBaseUrl,
    jevModel: process.env["JEV_MODEL"] ?? cfg.jevModel,
    wsPort: intEnv("WS_PORT", cfg.wsPort),
    agentTimeoutMs: intEnv("AGENT_TIMEOUT_MS", cfg.agentTimeoutMs),
    defaultPlannerModel: process.env["DEFAULT_PLANNER_MODEL"] ?? cfg.defaultPlannerModel,
    defaultSimpleModel: process.env["DEFAULT_SIMPLE_MODEL"] ?? cfg.defaultSimpleModel,
    defaultComplexModel: process.env["DEFAULT_COMPLEX_MODEL"] ?? cfg.defaultComplexModel,
    defaultPlannerEffort: configuredEffort(process.env["DEFAULT_PLANNER_EFFORT"]),
    defaultSimpleEffort: configuredEffort(process.env["DEFAULT_SIMPLE_EFFORT"]),
    defaultComplexEffort: configuredEffort(process.env["DEFAULT_COMPLEX_EFFORT"]),
  });
  return cfg;
}
export function maskSecret(value: string | undefined): string | null {
  const trimmed = (value ?? "").trim();
  if (!trimmed) return null;
  if (trimmed.length <= 8) return "****";
  return `${trimmed.slice(0, 4)}...${trimmed.slice(-4)}`;
}
/** Keys the settings UI is allowed to write. */
export const EDITABLE_ENV_KEYS = [
  "TYPESAFE_API_KEY",
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "TYPESAFE_BASE_URL",
  "DEFAULT_COMPLEX_MODEL",
  "DEFAULT_SIMPLE_MODEL",
  "DEFAULT_PLANNER_MODEL",
  "DEFAULT_PLANNER_EFFORT",
  "DEFAULT_SIMPLE_EFFORT",
  "DEFAULT_COMPLEX_EFFORT",
] as const;
/**
 * Persists the given keys to .env and applies them to process.env immediately.
 * An empty string clears the key. Only whitelisted keys are accepted.
 */
export function setEnvValues(root: string, updates: Record<string, string>): void {
  const allowed = new Set<string>(EDITABLE_ENV_KEYS);
  const sanitized: Record<string, string> = {};
  for (const [key, value] of Object.entries(updates)) {
    if (allowed.has(key))
      sanitized[key] = typeof value === "string" ? value.trim() : String(value ?? "");
  }
  const file = resolve(root, ".env");
  mkdirSync(root, { recursive: true });
  const existing = existsSync(file) ? readFileSync(file, "utf8").split(/\r?\n/) : [];
  const keys = Object.keys(sanitized);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const line of existing) {
    const match = /^([A-Z0-9_]+)\s*=/.exec(line.trim());
    const key = match?.[1];
    if (key && keys.includes(key)) {
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(`${key}=${sanitized[key]}`);
    } else {
      out.push(line);
    }
  }
  for (const key of keys) {
    if (!seen.has(key)) out.push(`${key}=${sanitized[key]}`);
    const value = sanitized[key] ?? "";
    if (value === "") delete process.env[key];
    else process.env[key] = value;
  }
  while (out.length > 0 && out[out.length - 1] === "") out.pop();
  writeFileSync(file, out.join("\n") + "\n", "utf8");
  reloadConfig();
}
