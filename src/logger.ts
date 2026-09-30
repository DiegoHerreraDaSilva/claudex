import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";

export type LogLevel = "debug" | "info" | "warn" | "error";

let logFile: string | undefined;

export function initLogger(dir: string): void {
  logFile = path.join(dir, "claudex.log");
  void mkdir(dir, { recursive: true }).catch(() => undefined);
}

const SECRET_ENV_KEYS = ["TYPESAFE_API_KEY", "ANTHROPIC_API_KEY", "OPENAI_API_KEY"];

function redact(text: string): string {
  let out = text;
  for (const key of SECRET_ENV_KEYS) {
    const value = process.env[key];
    if (value && value.length >= 8) out = out.split(value).join("***");
  }
  out = out.replace(/\bsk-[A-Za-z0-9_-]{6,}/g, "sk-***");
  out = out.replace(/\bapik[A-Za-z0-9_-]{6,}/g, "apik***");
  return out;
}

function redactMeta(meta: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(meta)) {
    out[key] = typeof value === "string" ? redact(value) : value;
  }
  return out;
}

function write(level: LogLevel, message: string, meta?: Record<string, unknown>): void {
  const entry = {
    ts: new Date().toISOString(),
    level,
    message: redact(message),
    ...(meta ? { meta: redactMeta(meta) } : {}),
  };
  const line = JSON.stringify(entry);
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
  if (logFile) void appendFile(logFile, `${line}\n`).catch(() => undefined);
}

export const logger = {
  debug: (message: string, meta?: Record<string, unknown>) => write("debug", message, meta),
  info: (message: string, meta?: Record<string, unknown>) => write("info", message, meta),
  warn: (message: string, meta?: Record<string, unknown>) => write("warn", message, meta),
  error: (message: string, meta?: Record<string, unknown>) => write("error", message, meta),
};
