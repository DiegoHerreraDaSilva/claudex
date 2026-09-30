import { app, BrowserWindow } from "electron";
import { createServer } from "node:http";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { WebSocketServer } from "ws";
import { WorkService } from "../dist/application/workService.js";
import { ProjectRegistry } from "../dist/app/projects.js";
import { workRoutes } from "../dist/server/workRoutes.js";
const root = path.resolve(import.meta.dirname, "..");
const output = path.join(root, ".claudex", "qa", "experience");
app.setPath("userData", path.join(output, "profile"));
async function main() {
  await mkdir(output, { recursive: true });
  const dir = await mkdtemp(path.join(output, "data-"));
  const registry = new ProjectRegistry(dir);
  await registry.load();
  const project = await registry.create("Meu primeiro projeto", dir);
  await registry.flush();
  let connected = false;
  const active = new Set(),
    locks = new Set(),
    summaries = new Map();
  const credentials = () => ({
    claude: { mode: connected ? "api-key" : "none" },
    codex: { mode: "none" },
    typesafe: { configured: false },
  });
  const chat = {
    missionSummary: async (id) => summaries.get(id),
    isRunning: (id) => active.has(id),
    projectBusy: (id) => locks.has(id) || active.size > 0,
    withProjectOperation: async (id, action) => {
      if (locks.has(id) || active.size) throw new Error("project is busy");
      locks.add(id);
      try {
        return await action();
      } finally {
        locks.delete(id);
      }
    },
    send: async (_projectId, id) => {
      active.add(id);
      await new Promise((resolve) => setTimeout(resolve, 100));
      active.delete(id);
      summaries.set(id, {
        id,
        status: "ready",
        tasks: ["Entender o pedido", "Preparar as alterações"],
        verification: [],
        agentRuns: [],
        revision: 1,
      });
    },
    stop: (_projectId, id) => active.delete(id),
  };
  const broadcast = (message) => {
    for (const client of wss.clients) client.send(JSON.stringify(message));
  };
  const work = new WorkService(
    chat,
    registry,
    dir,
    () => broadcast({ type: "work:updated" }),
    () => connected,
  );
  const route = workRoutes(work, chat, registry, credentials);
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://${req.headers.host}`);
      if (await route(req, res, url)) return;
      if (url.pathname.startsWith("/api/")) {
        let data = {};
        if (url.pathname === "/api/projects") data = registry.list();
        else if (url.pathname === `/api/projects/${project.id}`)
          data = { project: registry.get(project.id), running: [...active], diffs: {} };
        else if (url.pathname === "/api/credentials") data = credentials();
        else if (url.pathname.endsWith("/summary")) data = null;
        else if (
          ["/events", "/memory", "/worktrees", "/checkpoints"].some((suffix) =>
            url.pathname.endsWith(suffix),
          )
        )
          data = [];
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify(data));
        return;
      }
      const ui = path.join(root, "dist", "chat"),
        file = path.resolve(ui, url.pathname === "/" ? "index.html" : url.pathname.slice(1));
      if (!file.startsWith(ui + path.sep)) throw new Error("Invalid path");
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
    } catch (error) {
      res.writeHead(500);
      res.end(String(error));
    }
  });
  const wss = new WebSocketServer({ server });
  wss.on("connection", (socket) =>
    socket.send(JSON.stringify({ type: "projects", data: registry.list() })),
  );
  let win;
  const errors = [];
  const evaluate = (code) => win.webContents.executeJavaScript(code);
  async function waitFor(expression) {
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
      if (await evaluate(expression)) return;
      await new Promise((resolve) => setTimeout(resolve, 80));
    }
    throw new Error(`Timed out: ${expression}`);
  }
  async function navigate(view) {
    await evaluate(`document.querySelector('[data-view="${view}"]').click()`);
    await waitFor(
      `document.querySelector('.automation-view h1') && !document.querySelector('.automation-view [role="status"]')`,
    );
  }
  async function capture(name) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    await writeFile(
      path.join(output, `${name}.png`),
      (await win.webContents.capturePage()).toPNG(),
    );
  }
  async function submitTask(title, run = false) {
    await evaluate(`document.querySelector('[data-action="new-task"]').click()`);
    await waitFor(`!!document.querySelector('.friendly-dialog[open]')`);
    await evaluate(
      `{ const form = document.querySelector('.friendly-form'); form.querySelector('input').value = ${JSON.stringify(title)}; form.querySelector('textarea').value = 'Melhore o texto da página inicial'; form.querySelector('select').value = ${JSON.stringify(project.id)}; form.requestSubmit(${run ? "form.querySelector('[data-start]')" : "form.querySelectorAll('button[type=submit]')[1]"}); }`,
    );
    await waitFor(`!document.querySelector('.friendly-dialog')`);
    await waitFor(
      `document.querySelector('.task-card')?.textContent.includes(${JSON.stringify(title)})`,
    );
  }
  try {
    await app.whenReady();
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    win = new BrowserWindow({
      show: false,
      width: 1440,
      height: 1050,
      webPreferences: { backgroundThrottling: false, offscreen: true },
    });
    win.webContents.on("console-message", (_event, level, message) => {
      if (level >= 2) errors.push(message);
    });
    const url = `http://127.0.0.1:${server.address().port}`;
    await win.loadURL(url);
    await evaluate("localStorage.clear()");
    await win.loadURL(url);
    await waitFor("!!document.querySelector('.onboarding')");
    await capture("home-dark");
    await evaluate(
      "{ const field = document.querySelector('.hero-input'); field.value = 'Um pedido em progresso'; field.dispatchEvent(new Event('input')); }",
    );
    broadcast({ type: "work:updated" });
    await new Promise((resolve) => setTimeout(resolve, 150));
    assert.equal(
      await evaluate("document.querySelector('.hero-input').value"),
      "Um pedido em progresso",
    );
    await navigate("tasks");
    await submitTask("Minha primeira tarefa");
    assert.equal((await work.overview()).tasks[0].status, "todo");
    await evaluate(
      "[...document.querySelectorAll('.task-card button')].find(node => node.textContent === 'Começar agora').click()",
    );
    await waitFor(
      "document.querySelector('.automation-view [role=alert]')?.textContent.includes('Conecte')",
    );
    assert.equal((await work.overview()).tasks[0].status, "todo");
    connected = true;
    broadcast({ type: "credentials", data: credentials() });
    await waitFor("!document.querySelector('.automation-view [role=alert]')");
    await evaluate(
      "[...document.querySelectorAll('.task-card button')].find(node => node.textContent === 'Começar agora').click()",
    );
    await waitFor(
      "document.querySelector('.task-card .friendly-badge')?.textContent === 'Para revisar'",
    );
    assert.equal(
      registry.getConversation(project.id, (await work.overview()).tasks[0].conversationId)
        .autonomy,
      "assisted",
    );
    await capture("tasks-dark");
    await navigate("schedules");
    await evaluate("document.querySelector('[data-action=new-schedule]').click()");
    await evaluate(
      `{ const form = document.querySelector('.friendly-form'); form.querySelector('input').value = 'Revisão diária'; form.querySelector('textarea').value = 'Revise o projeto e sugira melhorias'; form.querySelector('select').value = ${JSON.stringify(project.id)}; form.querySelectorAll('select')[2].value = 'daily'; form.requestSubmit(); }`,
    );
    await waitFor(
      "!!document.querySelector('.schedule-card') && !document.querySelector('.friendly-dialog')",
    );
    await evaluate(
      "[...document.querySelectorAll('.schedule-card button')].find(node => node.textContent === 'Pausar').click()",
    );
    await waitFor(
      "document.querySelector('.schedule-card .friendly-badge')?.textContent === 'Pausado'",
    );
    assert.equal((await work.overview()).schedules[0].enabled, false);
    await capture("schedules-dark");
    await navigate("agents");
    await waitFor("document.querySelectorAll('.assistant-card').length === 3");
    assert.equal(
      await evaluate(
        "document.querySelector('[data-provider=claude]').textContent.includes('Conta conectada')",
      ),
      true,
    );
    await capture("assistants-dark");
    await evaluate("document.querySelector('#theme-toggle').click()");
    await capture("assistants-light");
    await navigate("tasks");
    await capture("tasks-light");
    await evaluate("document.querySelector('#lang-toggle').click()");
    await waitFor("document.querySelector('.friendly-heading h1')?.textContent === 'Tasks'");
    await evaluate("document.querySelector('[data-action=new-task]').click()");
    assert.equal(
      await evaluate("document.querySelector('.friendly-form label').textContent"),
      "Task name",
    );
    await evaluate("document.querySelector('.friendly-dialog').close()");
    win.setSize(390, 844);
    await capture("tasks-mobile");
    assert.equal(await evaluate("document.documentElement.scrollWidth <= window.innerWidth"), true);
    assert.equal(
      await evaluate("getComputedStyle(document.querySelector('.mobile-nav')).display"),
      "flex",
    );
    for (const width of [320, 768]) {
      win.setSize(width, 844);
      await new Promise((resolve) => setTimeout(resolve, 150));
      assert.equal(
        await evaluate("document.documentElement.scrollWidth <= window.innerWidth"),
        true,
      );
      await capture(`tasks-${width}`);
    }
    assert.deepEqual(errors, []);
    console.log(
      JSON.stringify({
        passed: true,
        checks: [
          "Real persistent task CRUD",
          "Disconnected error",
          "Assisted execution",
          "Real schedule pause",
          "Account state",
          "Dark and light themes",
          "English dialog",
          "Mobile navigation",
        ],
        output,
      }),
    );
  } catch (error) {
    console.error(error);
    console.error(errors);
    process.exitCode = 1;
  } finally {
    work.stopScheduler();
    await work.idle();
    win?.destroy();
    wss.close();
    await new Promise((resolve) => server.close(resolve));
    app.exit(process.exitCode ?? 0);
  }
}
app
  .whenReady()
  .then(main)
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });
