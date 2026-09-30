import { mkdirSync } from "node:fs";
import { app, BrowserWindow } from "electron";
import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { WebSocketServer } from "ws";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ui = path.join(root, "dist", "chat");
const output = path.resolve(process.argv[2] || path.join(root, ".claudex", "qa", "phase3"));
mkdirSync(path.join(output, "profile"), { recursive: true });
app.setPath("userData", path.join(output, "profile"));
const credentials = {
  claude: { mode: "none" },
  codex: { mode: "none" },
  typesafe: { configured: false },
};
const conversation = {
  id: "mission-fixture",
  name: "Endpoint de saúde",
  createdAt: Date.now(),
  messages: [],
  branch: "claudex/health",
  usage: { inputTokens: 2000, outputTokens: 700 },
  validationRequired: true,
};
const project = {
  id: "project-fixture",
  name: "Projeto de exemplo",
  rootPath: "C:\\projetos\\exemplo",
  baseBranch: "main",
  conversations: [conversation],
  activeConversationId: conversation.id,
};
const diff =
  "diff --git a/src/health.ts b/src/health.ts\n--- a/src/health.ts\n+++ b/src/health.ts\n@@ -1 +1,2 @@\n-export const status = 'starting';\n+export const status = 'ok';\n+export const uptime = 0;";
let summary = {
  id: conversation.id,
  projectId: project.id,
  title: "Adicionar endpoint de saúde",
  status: "ready",
  revision: 20,
  startedAt: Date.now() - 91_000,
  finishedAt: Date.now(),
  updatedAt: Date.now(),
  files: ["src/health.ts"],
  additions: 2,
  deletions: 1,
  tasks: ["Implementar endpoint", "Adicionar testes"],
  agentRuns: [],
  usage: { inputTokens: 2000, outputTokens: 700 },
  costUsd: 0.027,
  verification: ["typecheck", "build", "tests", "lint", "security"].map((kind) => ({
    id: kind,
    missionId: conversation.id,
    kind,
    status: kind === "security" ? "skipped" : "passed",
    summary: kind === "security" ? "Security audit unavailable" : "Command passed",
    output: kind === "tests" ? "Tests  8 passed (8)" : "",
    testCount: kind === "tests" ? 8 : undefined,
    durationMs: 1200,
    at: Date.now(),
  })),
  review: {
    approved: true,
    source: "claude+jev",
    summary: "O endpoint atende ao plano. Testes e tratamento de erros conferidos.",
    findings: [],
  },
};
const events = [];
const sent = [];
const errors = [];
let win;
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://localhost");
    const toolsPayload = url.pathname.endsWith("/intelligence")
      ? {
          fileCount: 3,
          files: [{ file: "src/health.ts", symbols: ["health"] }],
          dependencies: { express: "5.0" },
          entryPoints: ["src/health.ts"],
          truncated: false,
          graph: {
            nodes: ["src/health.ts", "src/server.ts"],
            edges: [{ from: "src/server.ts", to: "src/health.ts" }],
          },
        }
      : url.pathname.endsWith("/memory")
        ? [{ id: "memory-1", kind: "convention", text: "Use ESM", createdAt: Date.now() }]
        : url.pathname.endsWith("/git")
          ? {
              branches: ["main", "claudex/health"],
              status: " M src/health.ts",
              worktrees: [
                { worktree: project.rootPath, branch: "refs/heads/main", HEAD: "abc123" },
              ],
            }
          : url.pathname.endsWith("/missions")
            ? [
                {
                  id: conversation.id,
                  title: summary.title,
                  status: "ready",
                  costUsd: summary.costUsd,
                  startedAt: summary.startedAt,
                  durationMs: 91000,
                  branch: conversation.branch,
                },
              ]
            : url.pathname.endsWith("/checkpoints")
              ? [
                  {
                    id: "checkpoint-1",
                    index: 1,
                    commit: "a".repeat(40),
                    createdAt: Date.now(),
                    files: ["src/health.ts"],
                  },
                ]
              : url.pathname === "/api/repo/ask"
                ? {
                    matches: [
                      { file: "src/health.ts", line: 1, snippet: "export function health() {}" },
                    ],
                    confidence: 1,
                    method: "lexical",
                  }
                : undefined;
    if (toolsPayload !== undefined) {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(toolsPayload));
      return;
    }
    if (url.pathname.endsWith("/terminal") || url.pathname.endsWith("/restore")) {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ ok: true }));
      return;
    }
    if (url.pathname === "/api/work/overview") {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ tasks: [], schedules: [], timeZone: "UTC", schedulerError: null }));
      return;
    }
    const payload =
      url.pathname === "/api/projects"
        ? [project]
        : url.pathname === `/api/projects/${project.id}`
          ? {
              project,
              running: [],
              diffs: {
                [conversation.id]: {
                  diff,
                  files: summary.files,
                  branch: conversation.branch,
                  baseBranch: "main",
                },
              },
            }
          : url.pathname === "/api/credentials"
            ? credentials
            : url.pathname.endsWith("/summary")
              ? summary
              : url.pathname.endsWith("/events")
                ? events
                : undefined;
    if (payload !== undefined) {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(payload));
      return;
    }
    const relative = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
    const file = path.resolve(ui, relative);
    if (!file.startsWith(ui + path.sep)) throw new Error("Invalid static path");
    let content = await readFile(file);
    if (file.endsWith(".css"))
      content = Buffer.from(content.toString().replace(/^@import .*;\r?\n/, ""));
    res.setHeader(
      "Content-Type",
      file.endsWith(".js")
        ? "application/javascript"
        : file.endsWith(".css")
          ? "text/css"
          : "text/html",
    );
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self' ws://127.0.0.1:*",
    );
    res.end(content);
  } catch (err) {
    res.writeHead(500);
    res.end(String(err));
  }
});
const wss = new WebSocketServer({ server });
wss.on("connection", (socket) => {
  socket.send(JSON.stringify({ type: "projects", data: [project] }));
  socket.send(JSON.stringify({ type: "credentials", data: credentials }));
  socket.on("message", (raw) => sent.push(JSON.parse(raw.toString())));
});
function broadcast(message) {
  for (const client of wss.clients) client.send(JSON.stringify(message));
}
async function evaluate(code) {
  return win.webContents.executeJavaScript(code);
}
async function waitFor(expression) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (await evaluate(expression)) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out: ${expression}`);
}
async function capture(name) {
  win.webContents.invalidate();
  await new Promise((resolve) => setTimeout(resolve, 300));
  const screenshot = await win.webContents.capturePage();
  await writeFile(path.join(output, name + ".png"), screenshot.toPNG());
}

app.whenReady().then(async () => {
  try {
    await mkdir(output, { recursive: true });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    win = new BrowserWindow({
      show: false,
      width: 1440,
      height: 1100,
      webPreferences: { backgroundThrottling: false, offscreen: true },
    });
    win.webContents.on("console-message", (_event, level, message) => {
      if (level >= 2) errors.push(message);
    });
    win.webContents.on("did-fail-load", (_event, code, description) =>
      errors.push(`${code}: ${description}`),
    );
    await win.loadURL(`http://127.0.0.1:${server.address().port}`);
    await evaluate("localStorage.clear()");
    await win.loadURL(`http://127.0.0.1:${server.address().port}`);
    await waitFor("!!document.querySelector('.project-head')");
    await evaluate("document.querySelector('.project-head').click()");
    await waitFor("!!document.querySelector('.workspace-header')");
    await evaluate("document.querySelector('[data-view=missions]').click()");
    await waitFor("!!document.querySelector('.mission-complete.ready')");
    await waitFor(
      "[...document.querySelectorAll('.mission-complete button')].some(button => /^(apply|aplicar)$/.test(button.textContent) && !button.disabled)",
    );
    const ready = await evaluate(
      `({ rows: document.querySelectorAll('.verification-row').length, apply: [...document.querySelectorAll('.mission-complete button')].find(button => /^(apply|aplicar)$/.test(button.textContent))?.disabled, title: document.querySelector('.mission-complete-title').textContent })`,
    );
    assert.equal(ready.rows, 5);
    assert.equal(ready.apply, false);
    assert.match(ready.title, /CONCLUÍDA|COMPLETE/);
    await evaluate("document.documentElement.setAttribute('data-theme', 'dark')");
    assert.equal(
      await evaluate("getComputedStyle(document.body).backgroundColor"),
      "rgb(7, 9, 13)",
    );
    await capture("phase3-ready-dark");
    await evaluate(
      "document.getElementById('lang-toggle').click(); document.getElementById('theme-toggle').click()",
    );
    await capture("phase3-ready-light-en");
    for (const width of [320, 768, 1024, 1440]) {
      win.setContentSize(width, 1100);
      await new Promise((resolve) => setTimeout(resolve, 100));
      const overflow = await evaluate(
        "document.documentElement.scrollWidth > window.innerWidth || document.querySelector('.mission-complete').scrollWidth > document.querySelector('.mission-complete').clientWidth",
      );
      assert.equal(overflow, false, `Overflow at ${width}px`);
    }
    win.setContentSize(320, 1100);
    await capture("phase3-mobile");
    await evaluate(
      "[...document.querySelectorAll('.mission-complete button')].find(button => /review changes|revisar alterações/i.test(button.textContent)).click()",
    );
    assert.equal(
      await evaluate("getComputedStyle(document.getElementById('right')).display !== 'none'"),
      true,
    );
    await evaluate("document.getElementById('inspector-close').click()");
    win.setContentSize(1440, 1100);
    const unsafe = '<img src=x onerror="window.claudexInjected=true">';
    summary = {
      ...summary,
      status: "failed",
      revision: 21,
      error: "Tests failed",
      review: {
        ...summary.review,
        approved: false,
        findings: [
          {
            severity: "error",
            file: "src/health.ts",
            line: 2,
            message: "O endpoint não trata falhas.",
          },
          { severity: "warning", message: unsafe },
        ],
      },
    };
    broadcast({ type: "mission:summary", summary });
    await waitFor("!!document.querySelector('.mission-complete.failed')");
    assert.equal(
      await evaluate(
        "[...document.querySelectorAll('.mission-complete button')].find(button => /^(apply|aplicar)$/.test(button.textContent)).disabled",
      ),
      true,
    );
    assert.equal(
      await evaluate(
        "document.querySelector('.review-finding img') === null && !window.claudexInjected",
      ),
      true,
    );
    await evaluate("document.querySelector('.verification-row summary').click()");
    await capture("phase3-findings");
    await evaluate(
      "[...document.querySelectorAll('.mission-results button')].find(button => /fix automatically|corrigir automaticamente/i.test(button.textContent)).focus()",
    );
    assert.equal(await evaluate("document.activeElement.tagName"), "BUTTON");
    await evaluate("document.activeElement.click()");
    await new Promise((resolve) => setTimeout(resolve, 200));
    assert.equal(
      sent.some(
        (message) =>
          message.type === "chat:send" &&
          message.text.includes(summary.title) &&
          message.text.includes("O endpoint não trata falhas."),
      ),
      true,
    );
    assert.deepEqual(errors, []);
    console.log(
      JSON.stringify({
        result: "OK",
        checks: [
          "ready",
          "failed apply gate",
          "five checks",
          "PT/EN",
          "themes",
          "320/768/1024/1440",
          "mobile diff",
          "text escaping",
          "focus",
          "fix action",
        ],
        screenshots: output,
      }),
    );
    app.exit(0);
  } catch (err) {
    console.error(err);
    console.error(errors);
    app.exit(1);
  }
});
app.on("window-all-closed", () => {});
