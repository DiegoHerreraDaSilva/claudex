import { getConfig } from "../config.js";
import { runClaudeAgent } from "../agents/claude.js";
import { runCodexAgent } from "../agents/codex.js";

const config = getConfig();

if (process.env["SMOKE_AGENTS"] !== "1") {
  console.log("[agents smoke] set SMOKE_AGENTS=1 to actually run paid agents.");
  process.exit(0);
}

console.log("[agents smoke] Claude: liste os arquivos do repo");
try {
  const claude = await runClaudeAgent({
    prompt: "Liste os arquivos do repositório. Responda em uma linha por arquivo.",
    model: "sonnet",
    worktreePath: config.projectRoot,
    allowedTools: ["Read", "Glob", "Grep"],
    maxTurns: 5,
  });
  console.log(claude.result.slice(0, 500));
  console.log(`session_id=${claude.sessionId} tokens=${claude.usage.inputTokens}/${claude.usage.outputTokens}`);
} catch (err) {
  console.error("Claude smoke failed:", err instanceof Error ? err.message : err);
}

console.log("[agents smoke] Codex: descreva o que este repo faz");
try {
  const codex = await runCodexAgent({
    prompt: "Descreva em poucas frases o que este repositório faz.",
    worktreePath: config.projectRoot,
    model: config.defaultComplexModel,
  });
  console.log(codex.result.slice(0, 500));
  console.log(`thread_id=${codex.threadId}`);
} catch (err) {
  console.error("Codex smoke failed:", err instanceof Error ? err.message : err);
}
