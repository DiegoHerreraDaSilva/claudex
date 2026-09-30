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
const output = path.resolve(process.argv[2] || path.join(root, ".claudex", "qa", "phase6"));
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
  head: "a".repeat(40),
  branch: conversation.branch,
  baseBranch: "main",
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
const pullRequest = {
  number: 17,
  url: "https://github.com/owner/repo/pull/17",
  title: "Add health",
  state: "OPEN",
  isDraft: true,
  isCrossRepository: false,
  headRefName: conversation.branch,
  baseRefName: "main",
  headRefOid: summary.head,
};
let authenticated = true;
let ciStatus = "pending";
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://localhost");
    if (req.method !== "GET") {
      let raw = "";
      for await (const chunk of req) raw += chunk;
      const body = raw ? JSON.parse(raw) : {};
      requests.push({ path: url.pathname, body });
      if (url.pathname.endsWith("/browser-qa")) {
        const verification = { id: "12345678-1234-1234-1234-123456789abc", missionId: conversation.id,
          kind: "browser", status: "passed", summary: "Page loaded", output: "Fixture <script>unsafe()</script>",
          at: Date.now(), head: body.expectedHead,
          screenshot: `/api/missions/${conversation.id}/browser-qa/12345678-1234-1234-1234-123456789abc/screenshot` };
        summary.verification = [...summary.verification.filter(item => item.kind !== "browser"), verification];
        summary.revision++;
        broadcast({ type: "mission:summary", summary });
        res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(verification)); return;
      }
      if (url.pathname.endsWith("/pr")) {
        summary.pullRequest = { ...pullRequest, title: body.title, isDraft: body.draft };
        summary.revision++;
        broadcast({ type: "mission:summary", summary });
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify(summary.pullRequest));
        return;
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
    if (url.pathname.endsWith("/pr/preview")) {
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          repo: "owner/repo",
          branch: conversation.branch,
          baseBranch: "main",
          expectedHead: summary.head,
          title: "Add health",
          body: "First line\n\nTests passed",
          draft: true,
          authenticated,
        }),
      );
      return;
    }
    if (url.pathname.endsWith("/checks")) {
      if (ciStatus === "unavailable") {
        res.writeHead(502, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "GitHub fixture unavailable" }));
        return;
      }
      summary.ci = {
        pullRequest,
        status: ciStatus,
        headMatchesReview: ciStatus !== "failed",
        checkedAt: Date.now(),
        checks:
          ciStatus === "none"
            ? []
            : [
                {
                  name: "Tests <script>bad()</script>",
                  bucket:
                    ciStatus === "pending" ? "pending" : ciStatus === "failed" ? "fail" : "pass",
                  state: ciStatus,
                  link: "https://github.com/owner/repo/actions/runs/1",
                },
              ],
      };
      summary.revision++;
      broadcast({ type: "mission:summary", summary });
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(summary.ci));
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
      if (level >= 2 && !(ciStatus === "unavailable" && message.includes("502")))
        errors.push(message);
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
      "[...document.querySelectorAll('.nav-item')].find(node => node.textContent.toLowerCase().includes('missões')).click()",
    );
    await waitFor(
      "!!document.querySelector('.pr-prepare') && !document.querySelector('.pr-prepare').disabled",
    );
    await evaluate("document.querySelector('.browser-qa-open').click()");
    await waitFor("!!document.querySelector('.browser-qa-dialog[open]')");
    await evaluate("{ const dialog = document.querySelector('.browser-qa-dialog'); dialog.querySelector('input').value = 'http://localhost:3000'; dialog.querySelector('select').value = 'msedge'; dialog.querySelector('form').requestSubmit(); }");
    await waitFor("!!document.querySelector('.browser-qa-capture') && !document.querySelector('.browser-qa-open').disabled");
    const qaRequest = requests.find(item => item.path.endsWith('/browser-qa'));
    assert.deepEqual(qaRequest.body, { url: 'http://localhost:3000', channel: 'msedge', expectedHead: summary.head });
    assert.equal(await evaluate("!!document.querySelector('.browser-qa-section script')"), false);
    assert.equal(await evaluate("document.querySelector('.browser-qa-capture').getAttribute('href')"), `/api/missions/${conversation.id}/browser-qa/12345678-1234-1234-1234-123456789abc/screenshot`);
    await capture("phase6-browser-qa");
    await evaluate("document.querySelector('.pr-prepare').click()");
    await waitFor("!!document.querySelector('.pr-dialog[open]')");
    assert.equal(
      await evaluate("document.querySelector('.pr-dialog textarea').value"),
      "First line\n\nTests passed",
    );
    await evaluate(
      "{ const title = document.querySelector('.pr-dialog input:not([type])'); title.value = 'Health endpoint'; document.querySelector('.pr-dialog textarea').value = 'Edited first line\\n\\nEdited second line'; } document.querySelector('.pr-dialog form').requestSubmit()",
    );
    await waitFor(() => requests.some((item) => item.path.endsWith("/pr")));
    assert.equal(
      requests.find((item) => item.path.endsWith("/pr")).body.body,
      "Edited first line\n\nEdited second line",
    );
    assert.equal(
      requests.find((item) => item.path.endsWith("/pr")).body.expectedHead,
      summary.head,
    );
    await waitFor(
      "!!document.querySelector('.ci-refresh') && !document.querySelector('.ci-refresh').disabled && !document.querySelector('.pr-dialog')",
    );
    await evaluate("document.querySelector('.ci-refresh').click()");
    await waitFor("document.querySelector('.ci-status')?.textContent.includes('andamento')");
    assert.equal(await evaluate("document.querySelector('.ci-check script')"), null);
    assert.match(await evaluate("document.querySelector('.ci-check').textContent"), /<script>/);
    await capture("phase6-pr-ci-dark");
    await waitFor("!document.querySelector('.ci-refresh').disabled");
    ciStatus = "failed";
    await evaluate("document.querySelector('.ci-refresh').click()");
    await waitFor("document.querySelector('.ci-status')?.textContent.includes('falhou')");
    assert.match(
      await evaluate("document.querySelector('.github-section').textContent"),
      /commit diferente/,
    );
    await waitFor("!document.querySelector('.ci-refresh').disabled");
    ciStatus = "none";
    await evaluate("document.querySelector('.ci-refresh').click()");
    await waitFor("document.querySelector('.ci-status')?.textContent.toLowerCase().includes('nenhum check')");
    await waitFor("!document.querySelector('.ci-refresh').disabled");
    ciStatus = "passed";
    await evaluate("document.querySelector('.ci-refresh').click()");
    await waitFor(
      "document.querySelector('.ci-status')?.textContent.includes('passou') && !document.querySelector('.ci-refresh').disabled",
    );
    ciStatus = "unavailable";
    await evaluate("document.querySelector('.ci-refresh').click()");
    await waitFor(
      "document.querySelector('.github-error')?.textContent.includes('fixture unavailable')",
    );
    assert.equal(await evaluate("!!document.querySelector('.ci-status.passed')"), false);
    authenticated = false;
    await evaluate("document.querySelector('.pr-prepare').click()");
    await waitFor("document.querySelector('.pr-dialog')?.textContent.includes('gh auth login')");
    assert.equal(await evaluate("document.querySelector('.pr-publish').disabled"), true);
    await capture("phase6-github-login");
    await evaluate("document.querySelector('.pr-dialog .ghost-btn').click()");
    ciStatus = "none";
    await evaluate("document.querySelector('.ci-refresh').click()");
    await waitFor(
      "document.querySelector('.ci-status')?.textContent.toLowerCase().includes('nenhum check') && !document.querySelector('.ci-refresh').disabled",
    );
    await evaluate(
      "document.getElementById('lang-toggle').click(); document.getElementById('theme-toggle').click()",
    );
    await waitFor(
      "document.querySelector('.github-section')?.textContent.toLowerCase().includes('no checks published')",
    );
    for (const width of [320, 768, 1440]) {
      win.setContentSize(width, 1100);
      await new Promise((resolve) => setTimeout(resolve, 150));
      assert.equal(
        await evaluate(
          "document.querySelector('.github-section').scrollWidth > document.querySelector('.github-section').clientWidth",
        ),
        false,
        `GitHub panel overflow at ${width}`,
      );
    }
    win.setContentSize(1440, 1100);
    await capture("phase6-pr-ci-light-en");
    conversation.autonomy = "manual";
    broadcast({ type: "projects", data: [project] });
    await waitFor(
      "document.querySelector('.pr-prepare').disabled && document.querySelector('.ci-refresh').disabled && document.querySelector('.browser-qa-open').disabled",
    );
    assert.deepEqual(errors, []);
    console.log(
      JSON.stringify({
        status: "passed",
        checks: [
          "Browser QA form, capture, reviewed head, escaped output and manual block",
          "PR preview",
          "exact multiline body",
          "reviewed head",
          "CI pending/failed/absent/unavailable",
          "commit mismatch",
          "unauthed publish disabled",
          "escaped check names",
          "manual disabled",
          "PT/EN dark/light",
          "320/768/1440 widths",
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
