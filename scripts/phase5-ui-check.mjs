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
const output = path.resolve(process.argv[2] || path.join(root, ".claudex", "qa", "phase5"));
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
  autonomy: "autonomous",
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
      if (url.pathname.endsWith("/autonomy")) {
        conversation.autonomy = body.mode;
        broadcast({ type: "projects", data: [project] });
      }
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
    await evaluate(
      "{ const select = document.querySelector('.autonomy-select'); select.value = 'manual'; select.dispatchEvent(new Event('change')); }",
    );
    await waitFor(
      "document.querySelector('.autonomy-select').value === 'manual' && [...document.querySelectorAll('.header-actions button')].every(node => node.disabled)",
    );
    assert.equal(conversation.autonomy, "manual");
    for (const width of [320, 768, 1440]) {
      win.setContentSize(width, 1100);
      await new Promise((resolve) => setTimeout(resolve, 120));
      assert.equal(
        await evaluate(
          "document.querySelector('.workspace-header').scrollWidth > document.querySelector('.workspace-header').clientWidth",
        ),
        false,
        `Workspace overflow at ${width}`,
      );
    }
    win.setContentSize(1440, 1100);
    await evaluate(
      "{ const select = document.querySelector('.autonomy-select'); select.value = 'assisted'; select.dispatchEvent(new Event('change')); }",
    );
    await waitFor(() => conversation.autonomy === "assisted");
    await evaluate("document.getElementById('palette-btn').click()");
    await waitFor(
      "[...document.querySelectorAll('.palette-row')].filter(node => node.textContent.includes('autonomia')).length === 3",
    );
    await evaluate(
      "[...document.querySelectorAll('.palette-row')].find(node => node.textContent.includes('autonomia') && node.textContent.includes('autônomo')).click()",
    );
    await waitFor(() => conversation.autonomy === "autonomous");
    await evaluate("document.getElementById('settings-btn').click()");
    await waitFor(
      "document.querySelector('.permission-matrix')?.textContent.includes('aprovação pontual')",
    );
    await capture("phase5-permissions-settings");
    await evaluate("document.getElementById('settings-close').click()");
    const approval = {
      id: "approval-one",
      projectId: project.id,
      conversationId: conversation.id,
      tool: "Bash",
      action: "install",
      detail: "npm install <script>alert(1)</script>",
      createdAt: Date.now(),
      expiresAt: Date.now() + 90000,
    };
    broadcast({ type: "permission:notice", notice: { type: "requested", request: approval } });
    await waitFor("!!document.querySelector('.permission-dialog[open]')");
    assert.equal(await evaluate("document.activeElement.textContent"), "negar");
    assert.equal(await evaluate("document.querySelector('.permission-dialog script')"), null);
    assert.match(
      await evaluate("document.querySelector('.permission-dialog pre').textContent"),
      /<script>/,
    );
    for (const width of [320, 768, 1440]) {
      win.setContentSize(width, 900);
      await new Promise((resolve) => setTimeout(resolve, 120));
      assert.equal(
        await evaluate(
          "document.querySelector('.permission-dialog').scrollWidth > document.querySelector('.permission-dialog').clientWidth",
        ),
        false,
      );
    }
    win.setContentSize(1440, 1100);
    await capture("phase5-approval-dark");
    await evaluate("document.querySelector('.permission-dialog .primary-btn').click()");
    await waitFor(() =>
      requests.some((entry) => entry.path.endsWith("approval-one") && entry.body.approved),
    );
    await waitFor("!document.querySelector('.permission-dialog')");
    broadcast({
      type: "permission:notice",
      notice: { type: "requested", request: { ...approval, id: "approval-two" } },
    });
    await waitFor("!!document.querySelector('.permission-dialog')");
    win.webContents.sendInputEvent({ type: "keyDown", keyCode: "Escape" });
    win.webContents.sendInputEvent({ type: "keyUp", keyCode: "Escape" });
    await waitFor(() =>
      requests.some(
        (entry) => entry.path.endsWith("approval-two") && entry.body.approved === false,
      ),
    );
    await waitFor("!document.querySelector('.permission-dialog')");
    await evaluate("import('/lib/i18n.js').then(module => module.setLang('en'))");
    await evaluate("document.documentElement.dataset.theme = 'light'");
    broadcast({
      type: "permission:notice",
      notice: { type: "requested", request: { ...approval, id: "approval-three" } },
    });
    await waitFor(
      "document.querySelector('.permission-dialog')?.textContent.includes('approve once')",
    );
    await capture("phase5-approval-light-en");
    broadcast({
      type: "permission:notice",
      notice: { type: "resolved", id: "approval-three", approved: false },
    });
    await waitFor("!document.querySelector('.permission-dialog')");
    await evaluate("import('/lib/i18n.js').then(module => module.setLang('pt'))");
    assert.deepEqual(errors, []);
    console.log(
      JSON.stringify({
        status: "passed",
        checks: [
          "autonomy selector",
          "manual actions disabled",
          "command palette",
          "permission matrix",
          "approve once",
          "deny with Escape",
          "expired request removed",
          "escaped command",
          "focus default deny",
          "320/768/1440 widths",
          "PT/EN dark/light",
        ],
        output,
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
