import { describe, it, expect } from "vitest";
import {
  heuristicComplexity,
  heuristicRoute,
  COMPLEXITY_CRITERIA,
  ROUTE_CRITERIA,
} from "../src/jev.ts";

describe("heuristic routing (Jev fallback)", () => {
  it("classifies trivial tasks as fast", () => {
    expect(heuristicComplexity("corrigir typo no readme").complexity).toBe("fast");
  });

  it("classifies integration tasks as strong", () => {
    expect(heuristicComplexity("integrar autenticacao oauth no backend").complexity).toBe("strong");
  });

  it("classifies architecture tasks as judgment", () => {
    expect(heuristicComplexity("refatorar a arquitetura do sistema").complexity).toBe("judgment");
  });

  it("routes simple tasks to implement", () => {
    expect(heuristicRoute("corrigir typo").route).toBe("implement");
  });

  it("routes complex tasks to plan", () => {
    expect(heuristicRoute("implementar oauth e refatorar a arquitetura").route).toBe("plan");
  });

  it("exposes criteria for both stages", () => {
    expect(Object.keys(COMPLEXITY_CRITERIA)).toContain("judgment");
    expect(Object.keys(ROUTE_CRITERIA)).toEqual(["implement", "plan"]);
  });
});
