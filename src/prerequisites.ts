import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { EDITABLE_ENV_KEYS, maskSecret, type OrchestratorConfig } from "./config.js";
import { effortLevels } from "./agents/effort.js";
export type ProviderMode = "subscription" | "apiKey" | "none";
export interface ProviderStatus {
  mode: ProviderMode;
  detail: string;
  account?: string;
  plan?: string;
}
export interface CredentialStatus {
  claude: ProviderStatus;
  codex: ProviderStatus;
  typesafe: { configured: boolean; hint: string | null; baseUrl: string };
  complexModel: string;
  simpleModel: string;
  plannerModel: string;
  simpleEffort: string;
  complexEffort: string;
  plannerEffort: string;
  effortLevels: typeof effortLevels;
  editableKeys: readonly string[];
}
function readCodexIdentity(): { account?: string; plan?: string } {
  try {
    const file = path.join(homedir(), ".codex", "auth.json");
    if (!existsSync(file)) return {};
    const raw = JSON.parse(readFileSync(file, "utf8")) as {
      tokens?: { id_token?: string; access_token?: string };
    };
    const jwt = raw.tokens?.id_token ?? raw.tokens?.access_token;
    const segment = jwt?.split(".")[1];
    if (!segment) return {};
    const payload = JSON.parse(Buffer.from(segment, "base64url").toString("utf8")) as Record<
      string,
      unknown
    >;
    const auth = payload["https://api.openai.com/auth"] as Record<string, unknown> | undefined;
    return {
      account: typeof payload["email"] === "string" ? payload["email"] : undefined,
      plan:
        typeof auth?.["chatgpt_plan_type"] === "string"
          ? String(auth["chatgpt_plan_type"])
          : undefined,
    };
  } catch {
    return {};
  }
}
export function getCredentialStatus(config: OrchestratorConfig): CredentialStatus {
  const hasAnthropicKey = Boolean(process.env["ANTHROPIC_API_KEY"]);
  const claudeCreds = existsSync(path.join(homedir(), ".claude", ".credentials.json"));
  const claude: ProviderStatus = hasAnthropicKey
    ? {
        mode: "apiKey",
        detail: "ANTHROPIC_API_KEY takes precedence over the subscription (token billing)",
      }
    : claudeCreds
      ? {
          mode: "subscription",
          detail: "Claude Pro/Max subscription (~/.claude/.credentials.json)",
        }
      : { mode: "none", detail: "No Claude credentials (run `claude auth login`)" };
  const hasOpenAiKey = Boolean(process.env["OPENAI_API_KEY"]);
  const codexCreds = existsSync(path.join(homedir(), ".codex", "auth.json"));
  const identity = readCodexIdentity();
  const codex: ProviderStatus = hasOpenAiKey
    ? { mode: "apiKey", detail: "OPENAI_API_KEY is set (token billing)", ...identity }
    : codexCreds
      ? { mode: "subscription", detail: "Signed in with ChatGPT (~/.codex/auth.json)", ...identity }
      : { mode: "none", detail: "No Codex credentials (run `codex login`)" };
  return {
    claude,
    codex,
    typesafe: {
      configured: config.typesafeApiKey.trim().length > 0,
      hint: maskSecret(config.typesafeApiKey),
      baseUrl: config.typesafeBaseUrl,
    },
    complexModel: config.defaultComplexModel,
    simpleModel: config.defaultSimpleModel,
    plannerModel: config.defaultPlannerModel,
    simpleEffort: config.defaultSimpleEffort ?? "",
    complexEffort: config.defaultComplexEffort ?? "",
    plannerEffort: config.defaultPlannerEffort ?? "",
    effortLevels,
    editableKeys: EDITABLE_ENV_KEYS,
  };
}
