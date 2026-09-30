import { expect, it, vi } from "vitest";
const sdk = vi.hoisted(() => ({ startThread: vi.fn(), resumeThread: vi.fn() }));
vi.mock("@openai/codex-sdk", () => ({
  Codex: class {
    startThread = sdk.startThread;
    resumeThread = sdk.resumeThread;
  },
}));
import { runCodexAgent } from "../src/agents/codex.js";
import { codexPermissions } from "../src/application/permissionBroker.js";
it("passes explicit sandbox and network policies to new and resumed threads", async () => {
  const thread = {
    id: "t",
    run: async () => ({
      items: [],
      finalResponse: "ok",
      usage: { input_tokens: 1, output_tokens: 1, cached_input_tokens: 0 },
    }),
  };
  sdk.startThread.mockReturnValue(thread);
  sdk.resumeThread.mockReturnValue(thread);
  await runCodexAgent({
    prompt: "read",
    worktreePath: process.cwd(),
    ...codexPermissions("manual"),
  });
  expect(sdk.startThread.mock.calls[0]?.[0]).toMatchObject({
    sandboxMode: "read-only",
    approvalPolicy: "never",
    networkAccessEnabled: false,
    webSearchMode: "disabled",
  });
  await runCodexAgent({
    prompt: "work",
    worktreePath: process.cwd(),
    resumeThreadId: "t",
    ...codexPermissions("autonomous"),
  });
  expect(sdk.resumeThread.mock.calls[0]).toMatchObject([
    "t",
    { sandboxMode: "danger-full-access", networkAccessEnabled: true, webSearchMode: "live" },
  ]);
});
