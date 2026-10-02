import { describe, expect, it, vi } from "vitest";
import { JevClient, heuristicComplexity } from "../src/jev.js";
import { agentForComplexity } from "../src/agents/types.js";
import type { OrchestratorConfig } from "../src/config.js";
const { post } = vi.hoisted(() => ({ post: vi.fn() }));
vi.mock("axios", () => ({ default: { post } }));
const config = {
  typesafeApiKey: "test",
  typesafeBaseUrl: "https://api.typesafe.ai",
  jevModel: "jev-latest",
  jevCacheTtlMs: 1000,
} as OrchestratorConfig;
describe("Jev model routing", () => {
  it("uses Sonnet for simple changes, Codex for integrations and Opus for architecture", () => {
    const models = { simpleModel: "sonnet", plannerModel: "opus", complexModel: "chosen-codex" };
    expect(
      agentForComplexity(heuristicComplexity("corrigir typo no readme").complexity, models).label,
    ).toBe("claude:sonnet");
    expect(
      agentForComplexity(heuristicComplexity("integrar autenticacao oauth").complexity, models)
        .label,
    ).toBe("codex:chosen-codex");
    expect(
      agentForComplexity(heuristicComplexity("refatorar a arquitetura").complexity, models).label,
    ).toBe("claude:opus");
  });
  it("sends the request to Jev and caches a validated decision", async () => {
    post.mockReset();
    post.mockResolvedValue({
      status: 200,
      data: {
        answers: {
          complexity: {
            type: "choice",
            choice: "strong",
            confidence: 0.9,
            probabilities: { strong: 0.9 },
          },
        },
      },
    });
    const jev = new JevClient(config);
    expect((await jev.classifyComplexity("request")).source).toBe("jev");
    await jev.classifyComplexity("request");
    expect(post).toHaveBeenCalledTimes(1);
    expect(post.mock.calls[0][1].state).toBe("request");
  });
  it("labels invalid provider answers and missing keys as local fallback", async () => {
    post.mockReset();
    post.mockResolvedValue({
      status: 200,
      data: {
        answers: {
          complexity: {
            type: "choice",
            choice: "unexpected-model",
            confidence: 42,
            probabilities: {},
          },
        },
      },
    });
    expect((await new JevClient(config).classifyComplexity("arquitetura")).source).toBe(
      "heuristic",
    );
    expect(post).toHaveBeenCalledTimes(1);
    expect(
      (await new JevClient({ ...config, typesafeApiKey: "" }).classifyComplexity("texto"))
        .complexity,
    ).toBe("fast");
    expect(post).toHaveBeenCalledTimes(1);
  });
  it("keeps historical context separate so the fallback routes the current request", async () => {
    const jev = new JevClient({ ...config, typesafeApiKey: "" });
    expect(
      (await jev.classifyComplexity("oi", undefined, "architecture migration authentication"))
        .complexity,
    ).toBe("fast");
  });
  it("reports certificate and authentication failures without exposing credentials", async () => {
    post.mockReset();
    post.mockRejectedValue(
      Object.assign(new Error("contains test credential"), { code: "SELF_SIGNED_CERT_IN_CHAIN" }),
    );
    const decision = await new JevClient(config).classifyComplexity("oi");
    expect(decision.reason).toContain("certificado");
    expect(post).toHaveBeenCalledTimes(1);
    post.mockResolvedValue({ status: 401, data: {}, headers: {} });
    expect((await new JevClient(config).classifyComplexity("oi")).reason).toContain("HTTP 401");
  });
});
