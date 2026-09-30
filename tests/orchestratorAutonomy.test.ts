import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it, vi } from "vitest";
const agents = vi.hoisted(() => ({ claude: vi.fn(), codex: vi.fn() }));
vi.mock("../src/agents/claude.js", () => ({
  CLAUDE_TOOLS: { implementer: ["Read", "Write", "Bash"], reviewer: ["Read"] },
  runClaudeAgent: agents.claude,
}));
vi.mock("../src/agents/codex.js", () => ({ runCodexAgent: agents.codex }));
import { Orchestrator } from "../src/orchestrator.js";
import type { OrchestratorConfig } from "../src/config.js";
import type { JevClient } from "../src/jev.js";
import type { WorktreeManager } from "../src/worktree.js";
it("routes restricted legacy runs through Claude and leaves manual repositories unchanged", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "claudex-autonomy-"));
  const worktrees = {
    create: vi.fn(),
    getDiff: vi.fn().mockResolvedValue(""),
    commit: vi.fn(),
    merge: vi.fn().mockResolvedValue({ success: true }),
    list: vi.fn().mockResolvedValue([]),
  };
  const jev = {
    classifyComplexity: async () => ({
      complexity: "strong",
      source: "heuristic",
      confidence: 1,
      probabilities: {},
    }),
    shouldParallelize: async () => ({ parallel: false, noul: 0, source: "heuristic" }),
  };
  const config = {
    projectRoot: root,
    defaultPlannerModel: "opus",
    defaultSimpleModel: "sonnet",
    defaultComplexModel: "gpt-6-sol",
    maxParallelTasks: 1,
    agentTimeoutMs: 1000,
  } as OrchestratorConfig;
  agents.claude.mockResolvedValue({
    sessionId: "s",
    usage: { inputTokens: 1, outputTokens: 1 },
    result: "analysis",
  });
  agents.codex.mockResolvedValue({
    threadId: "t",
    usage: { inputTokens: 1, outputTokens: 1 },
    result: "done",
  });
  try {
    const make = () =>
      new Orchestrator(
        config,
        jev as unknown as JevClient,
        worktrees as unknown as WorktreeManager,
      );
    const manual = await make().execute({ description: "analyze", autonomy: "manual" });
    expect(manual.merged).toEqual([]);
    expect(worktrees.create).not.toHaveBeenCalled();
    expect(await readdir(root)).toEqual([]);
    expect(agents.claude.mock.calls.at(-1)?.[0].permissionPolicy.tools).toEqual(["Read"]);
    await make().execute({ description: "implement", autonomy: "assisted" });
    expect(agents.codex).not.toHaveBeenCalled();
    expect(agents.claude.mock.calls.at(-1)?.[0].permissionPolicy.permissionMode).toBe("default");
    await make().execute({ description: "implement", autonomy: "autonomous" });
    expect(agents.codex.mock.calls.at(-1)?.[0]).toMatchObject({
      sandboxMode: "danger-full-access",
      approvalPolicy: "never",
      networkAccessEnabled: true,
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
