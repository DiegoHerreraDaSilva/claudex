import { createHash } from "node:crypto";
import axios from "axios";
import type { OrchestratorConfig } from "./config.js";

export type Json =
  | string
  | number
  | boolean
  | null
  | Json[]
  | { [key: string]: Json };

export interface NoulQuestion {
  type: "noul";
  instructions: Json;
  criteria?: { true: Json; false: Json };
}

export interface ChoiceQuestion {
  type: "choice";
  instructions: Json;
  criteria: Record<string, Json>;
}

export interface ScoreQuestion {
  type: "score";
  instructions: Json;
  criteria: Json[];
}

export type Question = NoulQuestion | ChoiceQuestion | ScoreQuestion;
export type QuestionMap = Record<string, Question>;

export interface NoulAnswer {
  type: "noul";
  noul: number;
}

export interface ChoiceAnswer {
  type: "choice";
  choice: string;
  probabilities: Record<string, number>;
  confidence: number;
}

export interface ScoreAnswer {
  type: "score";
  score: number;
  legend: Record<string, string>;
  probabilities: Record<string, number>;
  confidence: number;
}

export type Answer = NoulAnswer | ChoiceAnswer | ScoreAnswer;
export type AnswerMap = Record<string, Answer>;

export interface JevUsage {
  input_tokens: number;
  output_tokens: number;
}

export interface JevResponse {
  model: string;
  answers: AnswerMap;
  usage: JevUsage;
}

export interface SystemOneRequest {
  state: Json;
  model: string;
  questions: QuestionMap;
}

export class JevError extends Error {
  readonly status: number | undefined;
  readonly request: SystemOneRequest | undefined;

  constructor(
    message: string,
    options: { status?: number; request?: SystemOneRequest; cause?: unknown } = {},
  ) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "JevError";
    this.status = options.status;
    this.request = options.request;
  }
}

export type Complexity = "fast" | "balanced" | "strong" | "judgment";
export type DecisionSource = "jev" | "heuristic";
export type RouteStage = "implement" | "plan";

export interface RouteDecision {
  route: RouteStage;
  probabilities: Record<string, number>;
  confidence: number;
  source: DecisionSource;
}

export interface ComplexityDecision {
  complexity: Complexity;
  probabilities: Record<string, number>;
  confidence: number;
  source: DecisionSource;
}

export interface ParallelDecision {
  parallel: boolean;
  noul: number;
  source: DecisionSource;
}

export interface ReviewDecision {
  approved: boolean;
  noul: number;
  source: DecisionSource;
}

export const COMPLEXITY_CRITERIA: Record<string, string> = {
  fast: "Trivial, 1-2 arquivos, sem logica de negocio",
  balanced: "Moderada, poucos arquivos, logica simples",
  strong: "Complexa, multiplos arquivos, logica densa ou integracao entre sistemas",
  judgment: "Requer raciocinio arquitetural profundo ou diagnostico dificil",
};

export const ROUTE_CRITERIA: Record<string, string> = {
  implement:
    "Simples implementacao: mudanca direta, bem definida e localizada, sem necessidade de planejar antes",
  plan: "Precisa planejar algo: exige decisoes de arquitetura, desenho ou investigacao antes de implementar",
};

const PARALLEL_THRESHOLD = 0.8;
const REVIEW_THRESHOLD = 0.7;
const RETRY_MAX_ATTEMPTS = 3;
const REQUEST_TIMEOUT_MS = 30_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function backoffMs(attempt: number): number {
  const base = 500 * 2 ** (attempt - 1);
  return base + Math.floor(Math.random() * 250);
}

function parseRetryAfter(headers: Record<string, unknown>): number | null {
  const raw = headers["retry-after"];
  if (typeof raw !== "string") return null;
  const seconds = Number.parseFloat(raw);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(raw);
  if (Number.isFinite(date)) return Math.max(0, date - Date.now());
  return null;
}

function isAnswer(value: unknown): value is Answer {
  if (typeof value !== "object" || value === null) return false;
  const type = (value as { type?: unknown }).type;
  return type === "noul" || type === "choice" || type === "score";
}

function validateResponse(data: unknown, request: SystemOneRequest): JevResponse {
  if (typeof data !== "object" || data === null) {
    throw new JevError("Jev returned a non-object response", { request, cause: data });
  }
  const record = data as Record<string, unknown>;
  const answers = record["answers"];
  if (typeof answers !== "object" || answers === null) {
    throw new JevError("Jev response is missing an 'answers' map", { request, cause: data });
  }
  for (const [id, answer] of Object.entries(answers as Record<string, unknown>)) {
    if (!isAnswer(answer)) {
      throw new JevError(`Jev answer '${id}' has an unexpected shape`, { request, cause: answer });
    }
  }
  const usage = record["usage"];
  const inputTokens =
    typeof usage === "object" && usage !== null
      ? Number((usage as Record<string, unknown>)["input_tokens"] ?? 0)
      : 0;
  const outputTokens =
    typeof usage === "object" && usage !== null
      ? Number((usage as Record<string, unknown>)["output_tokens"] ?? 0)
      : 0;
  return {
    model: typeof record["model"] === "string" ? record["model"] : "unknown",
    answers: answers as AnswerMap,
    usage: { input_tokens: inputTokens, output_tokens: outputTokens },
  };
}

export class JevClient {
  private readonly cache = new Map<string, { expiresAt: number; value: JevResponse }>();

  constructor(private readonly config: OrchestratorConfig) {}

  get enabled(): boolean {
    return this.config.typesafeApiKey.trim().length > 0;
  }

  async decide(
    state: Json,
    questions: QuestionMap,
    model: string = this.config.jevModel,
  ): Promise<JevResponse> {
    if (!this.enabled) {
      throw new JevError("TYPESAFE_API_KEY is not set; Jev is disabled");
    }
    const request: SystemOneRequest = { state, model, questions };
    const key = createHash("sha256").update(JSON.stringify(request)).digest("hex");
    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.value;
    }
    const response = await this.requestWithRetry(request);
    if (this.config.jevCacheTtlMs > 0) {
      this.cache.set(key, { expiresAt: Date.now() + this.config.jevCacheTtlMs, value: response });
    }
    return response;
  }

  async classifyComplexity(description: string): Promise<ComplexityDecision> {
    try {
      const response = await this.decide(description, {
        complexity: {
          type: "choice",
          instructions: "Classifique a subtarefa pela complexidade de implementacao",
          criteria: COMPLEXITY_CRITERIA,
        },
      });
      const answer = response.answers["complexity"];
      if (answer?.type !== "choice") {
        throw new JevError("Expected a choice answer for complexity", {
          request: { state: description, model: this.config.jevModel, questions: {} },
        });
      }
      const complexity = (Object.keys(COMPLEXITY_CRITERIA) as Complexity[]).includes(
        answer.choice as Complexity,
      )
        ? (answer.choice as Complexity)
        : "balanced";
      return {
        complexity,
        probabilities: answer.probabilities,
        confidence: answer.confidence,
        source: "jev",
      };
    } catch {
      return heuristicComplexity(description);
    }
  }

  async routeTask(description: string): Promise<RouteDecision> {
    try {
      const response = await this.decide(description, {
        route: {
          type: "choice",
          instructions:
            "A tarefa pede uma simples implementacao direta, ou precisa de planejamento antes de implementar?",
          criteria: ROUTE_CRITERIA,
        },
      });
      const answer = response.answers["route"];
      if (answer?.type !== "choice") {
        throw new JevError("Expected a choice answer for route", {
          request: { state: description, model: this.config.jevModel, questions: {} },
        });
      }
      const route: RouteStage = answer.choice === "plan" ? "plan" : "implement";
      return {
        route,
        probabilities: answer.probabilities,
        confidence: answer.confidence,
        source: "jev",
      };
    } catch {
      return heuristicRoute(description);
    }
  }

  async shouldParallelize(subtasks: string[]): Promise<ParallelDecision> {
    if (subtasks.length < 2) return { parallel: false, noul: 0, source: "heuristic" };
    try {
      const response = await this.decide(
        { subtasks },
        {
          parallelizable: {
            type: "noul",
            instructions:
              "As subtarefas abaixo sao independentes e podem ser executadas em paralelo sem conflito de arquivos ou dependencia de ordem?",
            criteria: {
              true: "Subtarefas independentes, tocam arquivos distintos e nao dependem uma da outra",
              false: "Subtarefas dependem de ordem, compartilham arquivos ou uma precisa do resultado da outra",
            },
          },
        },
      );
      const answer = response.answers["parallelizable"];
      if (answer?.type !== "noul") {
        return { parallel: subtasks.length > 1, noul: 0, source: "heuristic" };
      }
      return { parallel: answer.noul >= PARALLEL_THRESHOLD, noul: answer.noul, source: "jev" };
    } catch {
      return { parallel: true, noul: 0, source: "heuristic" };
    }
  }

  async reviewDiff(diff: string, plan: string): Promise<ReviewDecision> {
    try {
      const response = await this.decide(
        { plan, diff },
        {
          approved: {
            type: "noul",
            instructions:
              "O diff implementa corretamente e por completo o plano descrito, sem regressões evidentes?",
            criteria: {
              true: "O diff corresponde ao plano, esta completo e nao introduz regressoes claras",
              false: "O diff esta incompleto, incorreto ou introduz problema evidente",
            },
          },
        },
      );
      const answer = response.answers["approved"];
      if (answer?.type !== "noul") return { approved: true, noul: 0, source: "heuristic" };
      return { approved: answer.noul >= REVIEW_THRESHOLD, noul: answer.noul, source: "jev" };
    } catch {
      return { approved: true, noul: 0, source: "heuristic" };
    }
  }

  private async requestWithRetry(request: SystemOneRequest): Promise<JevResponse> {
    const url = `${this.config.typesafeBaseUrl.replace(/\/+$/, "")}/v1/systemone`;
    let lastError: JevError | undefined;
    for (let attempt = 1; attempt <= RETRY_MAX_ATTEMPTS; attempt++) {
      let status = 0;
      let data: unknown;
      let retryAfterMs: number | null = null;
      try {
        const res = await axios.post(url, request, {
          headers: {
            Authorization: `Bearer ${this.config.typesafeApiKey}`,
            "Content-Type": "application/json",
          },
          timeout: REQUEST_TIMEOUT_MS,
          validateStatus: () => true,
        });
        status = res.status;
        data = res.data;
        retryAfterMs = parseRetryAfter(res.headers as Record<string, unknown>);
      } catch (err) {
        const message = axios.isAxiosError(err) ? err.message : String(err);
        lastError = new JevError(`Network error calling Jev: ${message}`, {
          request,
          cause: err,
        });
        if (attempt < RETRY_MAX_ATTEMPTS) {
          await sleep(backoffMs(attempt));
          continue;
        }
        throw lastError;
      }
      if (status >= 200 && status < 300) return validateResponse(data, request);
      const retryable = status === 429 || status === 529 || status >= 500;
      const error = new JevError(`Jev returned HTTP ${status}`, { status, request, cause: data });
      if (retryable && attempt < RETRY_MAX_ATTEMPTS) {
        lastError = error;
        await sleep(retryAfterMs ?? backoffMs(attempt));
        continue;
      }
      throw error;
    }
    throw lastError ?? new JevError("Jev request failed", { request });
  }
}

const HEURISTIC_JUDGMENT = [
  "arquitet",
  "architecture",
  "diagn",
  "investigat",
  "root cause",
  "refactor",
  "migrat",
  "design",
  "trade-off",
  "tradeoff",
  "decis",
];

const HEURISTIC_STRONG = [
  "integrat",
  "autentica",
  "auth",
  "database",
  "banco de dados",
  "concurren",
  "transac",
  "websocket",
  "pipeline",
  "distribu",
  "crypt",
  "oauth",
  "sincroniz",
];

const HEURISTIC_FAST = [
  "typo",
  "rename",
  "renomear",
  "comentario",
  "comment",
  "readme",
  "format",
  "log ",
  "constante",
  "texto",
  "label",
];

export function heuristicComplexity(description: string): ComplexityDecision {
  const text = description.toLowerCase();
  const words = text.split(/\s+/).filter(Boolean).length;
  let complexity: Complexity = "balanced";
  if (HEURISTIC_JUDGMENT.some((k) => text.includes(k))) {
    complexity = "judgment";
  } else if (HEURISTIC_STRONG.some((k) => text.includes(k))) {
    complexity = "strong";
  } else if (HEURISTIC_FAST.some((k) => text.includes(k)) || words <= 3) {
    complexity = "fast";
  }
  const probabilities: Record<string, number> = {
    fast: 0,
    balanced: 0,
    strong: 0,
    judgment: 0,
  };
  probabilities[complexity] = 1;
  return { complexity, probabilities, confidence: 0.5, source: "heuristic" };
}

export function heuristicRoute(description: string): RouteDecision {
  const { complexity } = heuristicComplexity(description);
  const route: RouteStage = complexity === "fast" || complexity === "balanced" ? "implement" : "plan";
  return {
    route,
    probabilities: { implement: route === "implement" ? 1 : 0, plan: route === "plan" ? 1 : 0 },
    confidence: 0.4,
    source: "heuristic",
  };
}
