import { expect, it, vi } from "vitest";

const claude = vi.fn(async () => ({
  result: "ok",
  durationMs: 1,
  usage: { inputTokens: 0, outputTokens: 0 },
}));
const codex = vi.fn(async () => ({
  result: "ok",
  durationMs: 1,
  usage: { inputTokens: 0, outputTokens: 0 },
}));
vi.mock("../src/agents/claude.js", () => ({ runClaudeAgent: claude }));
vi.mock("../src/agents/codex.js", () => ({ runCodexAgent: codex }));

const { runSessionAgent, PROCESS_SAFETY } = await import("../src/application/sessionAgent.js");

it("summarizes in read-only mode and carries the continuity summary into future requests", async () => {
  claude.mockClear();
  codex.mockClear();
  const base = {
    cwd: process.cwd(),
    text: "Summarize only",
    signal: new AbortController().signal,
    timeoutMs: 1000,
    activity: () => {},
    rememberSession: () => {},
  };
  await runSessionAgent({
    ...base,
    mode: "compact",
    agent: { kind: "claude", model: "sonnet", label: "claude:sonnet", effort: "max" },
  });
  await runSessionAgent({
    ...base,
    mode: "compact",
    agent: { kind: "codex", model: "gpt", label: "codex:gpt", effort: "ultra" },
  });
  expect((claude.mock.calls[0] as any)[0]).toMatchObject({
    prompt: "Summarize only",
    readOnly: true,
    effort: "max",
  });
  expect((codex.mock.calls[0] as any)[0]).toMatchObject({
    prompt: "Summarize only",
    sandboxMode: "read-only",
    networkAccessEnabled: false,
    effort: "ultra",
  });
  await runSessionAgent({
    ...base,
    summary: "Keep the contract",
    agent: { kind: "codex", model: "gpt", label: "codex:gpt" },
  });
  expect((codex.mock.calls[1] as any)[0].prompt).toContain("Keep the contract");
  claude.mockClear();
  codex.mockClear();
});

it("warns every provider not to kill processes by name, which would close Claudex", async () => {
  const base = {
    cwd: process.cwd(),
    text: "Gere o ícone",
    signal: new AbortController().signal,
    timeoutMs: 1000,
    activity: () => {},
    rememberSession: () => {},
  };
  await runSessionAgent({
    ...base,
    agent: { kind: "claude", model: "sonnet", label: "claude:sonnet" },
  });
  await runSessionAgent({ ...base, agent: { kind: "codex", model: "gpt", label: "codex:gpt" } });
  for (const run of [claude, codex]) {
    const prompt = (run.mock.calls[0] as unknown as [{ prompt: string }])[0].prompt;
    expect(prompt).toContain(PROCESS_SAFETY);
    expect(prompt).toMatch(/taskkill \/IM/);
    expect(prompt.indexOf(PROCESS_SAFETY)).toBeLessThan(prompt.indexOf("Pedido:\nGere o ícone"));
  }
});
