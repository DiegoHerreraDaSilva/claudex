import type { OrchestratorConfig } from "../config.js";
import type { Complexity, ComplexityDecision, RouteDecision } from "../jev.js";

export interface MissionPreview {
  route: RouteDecision["route"];
  routeConfidence: number;
  routeSource: string;
  complexity: Complexity;
  complexityConfidence: number;
  complexitySource: string;
  probabilities: Record<string, number>;
  subtasks: string[];
  agents: string[];
  estimatedFiles: number;
  estimatedMinutes: number;
  impact: "low" | "medium" | "high";
}

const IMPACT: Record<Complexity, { files: number; minutes: number; impact: MissionPreview["impact"] }> = {
  fast: { files: 2, minutes: 3, impact: "low" },
  balanced: { files: 5, minutes: 6, impact: "medium" },
  strong: { files: 12, minutes: 12, impact: "high" },
  judgment: { files: 18, minutes: 18, impact: "high" },
};

/**
 * Best-effort operational preview shown before a mission starts: route, impact
 * estimate, likely agents and a first guess at subtasks (heuristic, not an LLM call).
 */
export function buildPreview(
  route: RouteDecision,
  complexity: ComplexityDecision,
  config: OrchestratorConfig,
): MissionPreview {
  const estimate = IMPACT[complexity.complexity];
  const agents: string[] = [];
  const subtasks: string[] = [];

  if (route.route === "implement") {
    agents.push("claude:sonnet");
    subtasks.push("implementar mudança");
  } else {
    agents.push("claude:opus");
    if (complexity.complexity === "strong") {
      agents.push(`codex:${config.defaultComplexModel}`);
      subtasks.push("planejar", "implementar (codex)", "validar");
    } else if (complexity.complexity === "judgment") {
      agents.push("claude:opus");
      subtasks.push("planejar arquitetura", "implementar", "revisar");
    } else {
      agents.push("claude:sonnet");
      subtasks.push("planejar", "implementar");
    }
  }

  return {
    route: route.route,
    routeConfidence: route.confidence,
    routeSource: route.source,
    complexity: complexity.complexity,
    complexityConfidence: complexity.confidence,
    complexitySource: complexity.source,
    probabilities: complexity.probabilities,
    subtasks,
    agents,
    estimatedFiles: estimate.files,
    estimatedMinutes: estimate.minutes,
    impact: estimate.impact,
  };
}
