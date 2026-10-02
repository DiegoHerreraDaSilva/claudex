import { expect, it, vi } from "vitest";
const sdk = vi.hoisted(() => ({ startThread: vi.fn(), resumeThread: vi.fn(), construct: vi.fn() }));
vi.mock("@openai/codex-sdk", () => ({
  Codex: class {
    constructor(options: unknown) {
      sdk.construct(options);
    }
    startThread = sdk.startThread;
    resumeThread = sdk.resumeThread;
  },
}));
import { runCodexAgent } from "../src/agents/codex.js";
it("starts Codex once and resumes the same thread for subsequent model requests", async () => {
  const run = vi.fn(async () => ({
    items: [],
    finalResponse: "ok",
    usage: { input_tokens: 1, output_tokens: 2, cached_input_tokens: 0 },
  }));
  sdk.startThread.mockReturnValue({
    id: "t",
    run,
  });
  sdk.resumeThread.mockReturnValue(sdk.startThread.getMockImplementation()!());
  const options = {
    prompt: "edit",
    cwd: process.cwd(),
    model: "test-model",
    skipGitRepoCheck: true,
  };
  const result = await runCodexAgent(options);
  const teamBridge = { command: "node", args: ["bridge.js"], env: { TEST: "1" } };
  await runCodexAgent({
    ...options,
    resumeThreadId: result.threadId,
    teamBridge,
    sandboxMode: "read-only",
    effort: "ultra",
    imagePaths: ["C:/reference.png"],
  });
  expect(sdk.startThread).toHaveBeenCalledTimes(1);
  expect(sdk.resumeThread.mock.calls[0][0]).toBe("t");
  expect(sdk.construct.mock.calls[1][0].config.mcp_servers).toEqual({ claudex: teamBridge });
  expect(sdk.resumeThread.mock.calls[0][1].sandboxMode).toBe("read-only");
  expect(sdk.startThread.mock.calls[0][0].modelReasoningEffort).toBeUndefined();
  expect(sdk.resumeThread.mock.calls[0][1].modelReasoningEffort).toBe("ultra");
  expect(run.mock.calls[1][0]).toEqual([
    { type: "text", text: "edit" },
    { type: "local_image", path: "C:/reference.png" },
  ]);
  expect(sdk.startThread.mock.calls[0][0]).toMatchObject({
    workingDirectory: options.cwd,
    skipGitRepoCheck: true,
    model: "test-model",
    sandboxMode: "workspace-write",
  });
  expect(result.usage).toEqual({ inputTokens: 1, outputTokens: 2 });
});
