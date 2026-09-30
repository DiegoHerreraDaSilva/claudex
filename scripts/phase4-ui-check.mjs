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
const output = path.resolve(process.argv[2] || path.join(root, ".claudex", "qa", "phase4"));
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
const events = [
  {
    id: "context",
    missionId: conversation.id,
    at: Date.now(),
    type: "context:loaded",
    payload: {
      memory: [{ kind: "convention", text: "Use ESM" }],
      worktreePath: "C:/worktrees/health",
      branch: conversation.branch,
    },
  },
];
const sent = [];
const errors = [];
let memories = [{ id: "memory-1", kind: "convention", text: "Use ESM", createdAt: Date.now() }];
const requests = [];
let win;
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://localhost");
    if (req.method !== "GET") {
      let raw = "";
      for await (const chunk of req) raw += chunk;
      const body = raw ? JSON.parse(raw) : {};
      requests.push({ path: url.pathname, body });
      if (url.pathname.endsWith("/memory") && req.method === "POST")
        memories.push({ id: "memory-2", ...body });
      if (url.pathname.includes("/memory/") && req.method === "PUT")
        Object.assign(
          memories.find((entry) => url.pathname.endsWith(entry.id)),
          body,
        );
      if (url.pathname.includes("/memory/") && req.method === "DELETE")
        memories = memories.filter((entry) => !url.pathname.endsWith(entry.id));
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify(
          url.pathname === "/api/repo/ask"
            ? {
                matches: [
                  { file: "src/health.ts", line: 1, snippet: "export function health() {}" },
                ],
                confidence: 1,
                method: "lexical",
              }
            : { ok: true, code: 0 },
        ),
      );
      return;
    }
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
        ? memories
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
    if (typeof expression === "function" ? await expression() : await evaluate(expression)) return;
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
    const nav = async (label) =>
      evaluate(
        `[...document.querySelectorAll('.nav-item')].find(node => node.textContent.toLowerCase().includes(${JSON.stringify(label)})).click()`,
      );
    await nav("inteligência");
    await waitFor("!!document.querySelector('.architecture-map')");
    await evaluate(
      "const input = document.querySelector('.tool-form input'); input.value = 'health'; input.dispatchEvent(new Event('input')); document.querySelector('.tool-form').requestSubmit()",
    );
    await waitFor("!!document.querySelector('.search-match')");
    assert.match(
      await evaluate("document.querySelector('.search-match').textContent"),
      /src\/health.ts:1/,
    );
    await capture("phase4-intelligence-dark");
    for (const width of [320, 768, 1024, 1440]) {
      win.setContentSize(width, 1100);
      await new Promise((resolve) => setTimeout(resolve, 150));
      assert.equal(
        await evaluate(
          "document.documentElement.scrollWidth > innerWidth || document.querySelector('.tools-view').scrollWidth > document.querySelector('.tools-view').clientWidth",
        ),
        false,
        `Overflow at ${width}`,
      );
    }
    win.setContentSize(1440, 1100);
    await nav("memória");
    await waitFor(
      "[...document.querySelectorAll('.tools-view textarea')].some(node => node.value === 'Use ESM')",
    );
    await evaluate(
      "{ const draft = document.querySelector('.memory-form textarea'); draft.value = 'Local JSON persistence'; draft.dispatchEvent(new Event('input')); } document.querySelector('.memory-form').requestSubmit()",
    );
    await waitFor(
      "[...document.querySelectorAll('.tool-card:has(.tool-actions) textarea')].some(node => node.value === 'Local JSON persistence')",
    );
    await evaluate(
      "{ const entry = [...document.querySelectorAll('.tool-card')].find(node => node.querySelector('textarea')?.value === 'Use ESM'); entry.querySelector('textarea').value = 'Use ESM updated'; entry.querySelector('.tool-actions button').click(); }",
    );
    await waitFor(() => memories.some(entry => entry.text === "Use ESM updated"));
    await waitFor("[...document.querySelectorAll('.tool-card:has(.tool-actions) textarea')].some(node => node.value === 'Use ESM updated')");
    await evaluate(
      "{ const entry = [...document.querySelectorAll('.tool-card')].find(node => node.querySelector('.tool-actions') && node.querySelector('textarea')?.value === 'Local JSON persistence'); entry.querySelectorAll('.tool-actions button')[1].click(); }",
    );
    await waitFor(
      "![...document.querySelectorAll('.tool-card:has(.tool-actions) textarea')].some(node => node.value === 'Local JSON persistence')",
    );
    await capture("phase4-memory");
    await nav("worktrees");
    await waitFor("document.querySelector('.tools-view').textContent.includes('refs/heads/main')");
    await nav("histórico");
    await waitFor(
      "document.querySelector('.tools-view').textContent.includes('Adicionar endpoint')",
    );
    await evaluate("document.querySelector('[data-tab=context]').click()");
    await waitFor("!!document.querySelector('.checkpoint-row')");
    await evaluate("document.querySelector('.checkpoint-row button').click()");
    await waitFor("!!document.querySelector('.confirm-card')");
    await evaluate("document.querySelector('.confirm-card .primary-btn').click()");
    await waitFor("document.body.textContent.includes('checkpoint restaurado')");
    assert(
      requests.some(
        (request) =>
          request.path.endsWith("/restore") && request.body.checkpointId === "checkpoint-1",
      ),
    );
    await evaluate("document.querySelector('[data-tab=terminal]').click()");
    await evaluate(
      "{ const terminalInput = document.querySelector('.terminal-form input'); terminalInput.value = 'echo hello'; terminalInput.dispatchEvent(new Event('input')); } document.querySelector('.terminal-form').requestSubmit()",
    );
    await new Promise((resolve) => setTimeout(resolve, 200));
    assert(
      requests.some(
        (request) => request.path.endsWith("/terminal") && request.body.command === "echo hello",
      ),
    );
    broadcast({
      type: "terminal:out",
      projectId: project.id,
      runId: "run-1",
      stream: "stdout",
      text: "<img onerror=alert(1)>hello\n",
    });
    broadcast({
      type: "terminal:out",
      projectId: project.id,
      runId: "run-1",
      stream: "system",
      result: { code: 0 },
    });
    await waitFor("document.querySelector('.terminal-output').textContent.includes('hello')");
    assert.equal(await evaluate("document.querySelector('.terminal-output img') === null"), true);
    await capture("phase4-terminal");
    await evaluate(
      "document.getElementById('lang-toggle').click(); document.getElementById('theme-toggle').click()",
    );
    await nav("intelligence");
    await waitFor("!!document.querySelector('.architecture-map')");
    await capture("phase4-intelligence-light-en");
    win.setContentSize(320, 1100);
    await capture("phase4-mobile");
    assert.deepEqual(errors, []);
    console.log(
      JSON.stringify({
        result: "OK",
        checks: [
          "repository search",
          "architecture",
          "memory CRUD",
          "git",
          "history",
          "checkpoints",
          "terminal escaping",
          "PT/EN",
          "themes",
          "320/768/1024/1440",
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
