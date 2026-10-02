import { expect, it, vi } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
const { query } = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("@anthropic-ai/claude-agent-sdk", () => ({ query }));
import { runClaudeAgent } from "../src/agents/claude.js";
it("sends attached images as native image blocks", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "claudex-image-"));
  try {
    const file = path.join(dir, "image.png");
    await writeFile(file, "image bytes");
    let received: unknown;
    query.mockImplementation(({ prompt }) =>
      (async function* () {
        for await (const message of prompt) received = message.message.content;
        yield {
          type: "result",
          subtype: "success",
          result: "done",
          session_id: "image",
          usage: { input_tokens: 1, output_tokens: 1 },
        };
      })(),
    );
    await runClaudeAgent({
      prompt: "Look",
      model: "sonnet",
      cwd: dir,
      images: [{ id: "test", name: "image.png", path: file, mimeType: "image/png", size: 11 }],
    });
    expect(received).toEqual([
      { type: "text", text: "Look" },
      {
        type: "image",
        source: {
          type: "base64",
          media_type: "image/png",
          data: Buffer.from("image bytes").toString("base64"),
        },
      },
    ]);
  } finally {
    query.mockClear();
    await rm(dir, { recursive: true, force: true });
  }
});
it("uses the last API input and the SDK window rather than cumulative token consumption", async () => {
  query.mockImplementation(() =>
    (async function* () {
      yield {
        type: "assistant",
        session_id: "test",
        message: {
          model: "claude-opus-5-5",
          content: [],
          usage: {
            input_tokens: 40,
            cache_read_input_tokens: 80,
            cache_creation_input_tokens: 20,
            output_tokens: 10,
          },
        },
      };
      yield {
        type: "result",
        subtype: "success",
        result: "Done",
        session_id: "test",
        usage: { input_tokens: 5000, output_tokens: 1000 },
        modelUsage: { "claude-opus-5-5": { contextWindow: 200000 } },
      };
    })(),
  );
  const result = await runClaudeAgent({
    prompt: "test",
    model: "claude-opus-5-5",
    cwd: process.cwd(),
  });
  expect(result.context).toMatchObject({
    usedTokens: 150,
    limitTokens: 200000,
    limitSource: "sdk",
    source: "estimate",
  });
  query.mockClear();
});
it("runs Claude directly and resumes the saved session with the selected model", async () => {
  query.mockImplementation(() =>
    (async function* () {
      yield {
        type: "result",
        subtype: "success",
        result: "Feito",
        session_id: "new",
        usage: { input_tokens: 1, output_tokens: 2 },
      };
    })(),
  );
  const options = { prompt: "edit", model: "claude-opus-5-5", cwd: process.cwd() };
  const first = await runClaudeAgent(options);
  const teamBridge = { command: "node", args: ["bridge.js"], env: { TEST: "1" } };
  const result = await runClaudeAgent({
    ...options,
    resumeSessionId: first.sessionId,
    teamBridge,
    readOnly: true,
    effort: "max",
  });
  expect(query).toHaveBeenCalledTimes(2);
  expect(query.mock.calls[0][0].options).toMatchObject({
    cwd: options.cwd,
    model: "claude-opus-5-5",
    permissionMode: "bypassPermissions",
  });
  expect(query.mock.calls[1][0].options.resume).toBe("new");
  expect(query.mock.calls[1][0].options.model).toBe("claude-opus-5-5");
  expect(query.mock.calls[0][0].options.effort).toBeUndefined();
  expect(query.mock.calls[1][0].options.effort).toBe("max");
  expect(query.mock.calls[1][0].options.mcpServers).toEqual({ claudex: teamBridge });
  expect(query.mock.calls[1][0].options.disallowedTools).toContain("Write");
  expect(result.result).toBe("Feito");
});
