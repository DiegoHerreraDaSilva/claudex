import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { chromium } from "playwright-core";
import { SessionService } from "../dist/application/sessionService.js";
import { createSessionServer } from "../dist/server/sessionServer.js";
const root = path.resolve(import.meta.dirname, "..");
const output = path.join(root, ".claudex", "qa", "direct");
await mkdir(output, { recursive: true });
const data = await mkdtemp(path.join(output, "run-"));
const folder = path.join(data, "Meu projeto sem Git");
await mkdir(folder);
const config = {
  defaultSimpleModel: "sonnet",
  defaultPlannerModel: "opus",
  defaultComplexModel: "gpt-6-sol",
  agentTimeoutMs: 10000,
  projectRoot: root,
  dataDir: path.join(data, "data"),
  typesafeApiKey: "",
  typesafeBaseUrl: "https://api.typesafe.ai",
};
const contexts = [];
const formattedResult = [
  "## Como rodar",
  "",
  "**Tudo pronto.** Abra a pasta e execute:",
  "",
  "1. Abra o terminal do projeto.",
  "2. Rode `npm run dev`.",
  "",
  "```bash",
  "npm run dev",
  "```",
  "",
  "Veja [o servidor local](http://localhost:5173).",
  "",
  "| Recurso | Estado |",
  "| --- | --- |",
  "| Terminal | Pronto |",
  "",
  "> As alterações ficam na pasta do projeto.",
  "",
  '<img src="x" onerror="window.markdownInjected=true"><script>window.markdownInjected=true</script>',
  "[Link inseguro](javascript:alert(1))",
].join("\n");
const sessions = new SessionService(
  path.join(data, "data"),
  config,
  {
    classifyComplexity: async (text) => ({
      complexity: text.includes("Codex")
        ? "strong"
        : text.includes("Opus")
          ? "judgment"
          : "balanced",
      source: "jev",
      confidence: 1,
      probabilities: {},
    }),
  },
  async ({ agent, cwd, text, signal, activity, resumeId, rememberSession, team, mode }) => {
    if (mode === "compact")
      return {
        result:
          "Objetivo: manter os arquivos criados, decisões e verificações. Continuar na pasta escolhida.",
        durationMs: 1,
        usage: { inputTokens: 10, outputTokens: 10 },
      };
    const contextId = resumeId || randomUUID();
    contexts.push({
      model: agent.label,
      effort: agent.effort,
      id: contextId,
      resumed: Boolean(resumeId),
    });
    rememberSession(contextId);
    activity("assistant", "Vou verificar os arquivos da pasta e executar seu pedido.");
    activity("tool", "Read: exemplo.txt");
    if (text.includes("equipe automática")) {
      const a = await team.call("delegate", { text: "Colaborador A", paths: ["a.txt"] });
      const b = await team.call("delegate", { text: "Colaborador B", paths: ["b.txt"] });
      await team.call("message_team", { text: "Use o contrato compartilhado para concluir." });
      await team.call("wait_agents", { ids: [a.id, b.id] });
    }
    if (text.includes("parar"))
      await new Promise((resolve, reject) => {
        if (signal.aborted) reject(new Error("cancelled"));
        else signal.addEventListener("abort", () => reject(new Error("cancelled")), { once: true });
      });
    await new Promise((resolve) => setTimeout(resolve, 300));
    if (text.includes("falhar")) throw new Error("Erro simulado de conexão do agente.");
    await writeFile(
      path.join(
        cwd,
        text === "Colaborador A" ? "a.txt" : text === "Colaborador B" ? "b.txt" : "resultado.txt",
      ),
      text,
    );
    activity("tool", "Write: resultado.txt\nArquivo atualizado diretamente na pasta selecionada.");
    const resultText =
      text === "Confira a formatação."
        ? formattedResult
        : `Pedido concluído. O arquivo resultado.txt foi atualizado.\n${text}`;
    activity("assistant", resultText);
    return {
      ...(agent.kind === "codex" ? { threadId: contextId } : { sessionId: contextId }),
      result: resultText,
      durationMs: 300,
      usage: { inputTokens: 10, outputTokens: 20 },
      context: { usedTokens: 3200, limitTokens: 200000, source: "estimate", limitSource: "sdk" },
    };
  },
);
await sessions.load();
const server = createSessionServer({ sessions, config });
const port = await server.listen(0);
let browser;
const errors = [];
try {
  browser = await chromium.launch({ channel: "chrome", headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.goto(`http://127.0.0.1:${port}`);
  await page.getByRole("heading", { name: "Comece com um pedido" }).waitFor();
  assert.equal(await page.locator("html").getAttribute("data-theme"), "dark");
  await page.getByRole("button", { name: "Tema claro", exact: true }).click();
  await page.getByRole("button", { name: "Adicionar pasta", exact: true }).click();
  await page.getByLabel("Pasta do computador").fill(folder);
  await page.getByLabel("Nome do projeto (opcional)").fill("Meu projeto");
  await page
    .locator("#folder-form")
    .getByRole("button", { name: "Adicionar pasta", exact: true })
    .click();
  await page.locator(".project-select").filter({ hasText: "Meu projeto" }).waitFor();
  await page
    .locator("#attachment-picker")
    .setInputFiles({ name: "remove-me.txt", mimeType: "text/plain", buffer: Buffer.from("draft") });
  await page.getByRole("button", { name: "Remover anexo remove-me.txt", exact: true }).click();
  assert.equal(await page.locator("#attachment-list .attachment-chip").count(), 0);
  await page.locator("#request").evaluate((input) => {
    const transfer = new DataTransfer();
    const encoded =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
    const bytes = Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0));
    transfer.items.add(new File([bytes], "clipboard.png", { type: "image/png" }));
    input.dispatchEvent(
      new ClipboardEvent("paste", { clipboardData: transfer, bubbles: true, cancelable: true }),
    );
  });
  await page.locator("#request-form").evaluate((form) => {
    const transfer = new DataTransfer();
    transfer.items.add(new File(["reference notes"], "reference.txt", { type: "text/plain" }));
    form.dispatchEvent(
      new DragEvent("drop", { dataTransfer: transfer, bubbles: true, cancelable: true }),
    );
  });
  await page.waitForFunction(
    () =>
      document.querySelectorAll("#attachment-list .attachment-chip").length === 2 &&
      !document.querySelector("#send").disabled &&
      document.querySelector("#attachment-list img")?.naturalWidth > 0,
  );
  await page.screenshot({ path: path.join(output, "input-attachments.png") });
  await page.locator("#request").fill("Crie uma página inicial simples.");
  await page.locator("#request").press("End");
  await page.locator("#request").press("Shift+Enter");
  assert.equal(await page.locator("#request").inputValue(), "Crie uma página inicial simples.\n");
  assert.equal(await page.locator("#tabs [role=tab]").count(), 0);
  await page.locator("#request").press("Enter");
  await page.locator("#request").fill("Rascunho que deve sobreviver às atualizações.");
  await page.waitForFunction(() =>
    document.querySelector("#activity-description").textContent.includes("Concluído"),
  );
  assert.equal(
    await page.locator("#request").inputValue(),
    "Rascunho que deve sobreviver às atualizações.",
  );
  assert.equal(await page.locator("#attachment-list .attachment-chip").count(), 0);
  assert.equal(await page.locator(".history-attachments .attachment-chip").count(), 2);
  const attachmentLink = await page
    .locator(".history-attachments a")
    .filter({ hasText: "reference.txt" })
    .getAttribute("href");
  assert.equal(
    await page.evaluate(async (url) => (await fetch(url)).text(), attachmentLink),
    "reference notes",
  );
  await page.locator("#request").fill("Codex: integre o formulário de contato.");
  await page.getByRole("button", { name: "Enviar pedido" }).click();
  await page.waitForFunction(
    () =>
      document.querySelectorAll("#tabs [role=tab]").length === 2 &&
      document.querySelector("#activity-title").textContent.includes("gpt-6-sol") &&
      document.querySelector("#activity-description").textContent.includes("Concluído"),
  );
  assert.equal(
    await readFile(path.join(folder, "resultado.txt"), "utf8"),
    "Codex: integre o formulário de contato.",
  );
  assert.equal(await page.locator("#tabs [role=tab]").count(), 2);
  assert.equal(
    await page.evaluate(() => {
      const panel = document.querySelector("#activity");
      const event = panel.querySelector(".event");
      const style = getComputedStyle(panel);
      const available =
        panel.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
      return Math.abs(event.getBoundingClientRect().width - available) < 2;
    }),
    true,
  );
  assert.equal(
    await page.locator(".event-assistant").filter({ hasText: "Pedido concluído" }).count(),
    0,
  );
  const tabsBefore = await page
    .locator("#tabs [role=tab]")
    .evaluateAll((tabs) => tabs.map((t) => t.id));
  await page.locator("#request").fill("Codex: melhore o formulário de contato.");
  await page.getByRole("button", { name: "Enviar pedido" }).click();
  await page.waitForFunction(
    () =>
      document.querySelector("#activity-description").textContent.includes("Concluído") &&
      [...document.querySelectorAll(".event-result p")]
        .at(-1)
        ?.textContent.includes("Codex: melhore"),
  );
  assert.deepEqual(
    await page.locator("#tabs [role=tab]").evaluateAll((tabs) => tabs.map((t) => t.id)),
    tabsBefore,
  );
  assert.equal(contexts[2].id, contexts[1].id);
  assert.equal(contexts[2].resumed, true);
  await page.locator("#request").fill("Ajuste a cor da página inicial.");
  await page.getByRole("button", { name: "Enviar pedido" }).click();
  await page.waitForFunction(
    () =>
      document.querySelector("#activity-title").textContent.includes("sonnet") &&
      document.querySelector("#activity-description").textContent.includes("Concluído") &&
      [...document.querySelectorAll(".event-result p")]
        .at(-1)
        ?.textContent.includes("Ajuste a cor"),
  );
  assert.equal(contexts[3].id, contexts[0].id);
  assert.equal(contexts[3].resumed, true);
  assert.equal(await page.locator("#tabs [role=tab]").count(), 2);
  await page.screenshot({ path: path.join(output, "desktop-light.png") });
  await page.locator("#tabs [role=tab]").first().click();
  assert.match(await page.locator("#activity").innerText(), /Crie uma página inicial/);
  await page.locator("#tabs [role=tab]").first().focus();
  await page.keyboard.press("ArrowRight");
  await page.waitForFunction(() =>
    document.querySelector("#activity").textContent.includes("Codex: integre"),
  );
  await page.reload();
  await page.waitForFunction(
    () =>
      document.querySelectorAll("#tabs [role=tab]").length === 2 &&
      document.querySelector("#activity").textContent.includes("Ajuste a cor"),
  );
  await page.getByRole("button", { name: "Tema escuro", exact: true }).click();
  assert.equal(await page.locator("html").getAttribute("data-theme"), "dark");
  await page.screenshot({ path: path.join(output, "desktop-dark.png") });
  for (const width of [320, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth),
      false,
    );
    await page.screenshot({ path: path.join(output, `width-${width}.png`) });
  }
  await page.locator("#request").fill("Opus: investigar e parar");
  await page.getByRole("button", { name: "Enviar pedido" }).click();
  await page.waitForFunction(
    () =>
      document.querySelector("#activity-title").textContent.includes("opus") &&
      document.querySelector("#activity-description").textContent.includes("Trabalhando"),
  );
  await page.getByRole("button", { name: "Parar agente" }).click();
  await page.waitForFunction(() =>
    document.querySelector("#activity-description").textContent.includes("Interrompido"),
  );
  await page.waitForFunction(() => !document.querySelector("#send").disabled);
  await page.locator("#request").fill("falhar <script>window.injected = true</script>");
  await page.getByRole("button", { name: "Enviar pedido" }).click();
  await page.waitForFunction(() =>
    document.querySelector("#activity-description").textContent.includes("Falhou"),
  );
  assert.match(await page.locator("#activity").innerText(), /Erro simulado/);
  assert.equal(await page.evaluate(() => window.injected), undefined);
  // Reproduce a running older backend that does not yet expose the effort catalog.
  await page.route("**/api/credentials", async (route) => {
    const response = await route.fetch();
    const data = await response.json();
    delete data.effortLevels;
    await route.fulfill({ response, json: data });
  });
  await page.getByRole("button", { name: "Contas e ajustes" }).click();
  await page.locator("#accounts .account-row").first().waitFor();
  assert.equal(await page.getByLabel("Modelo para mudanças simples").inputValue(), "sonnet");
  assert.equal(await page.locator("#planner-effort option[value=max]").count(), 1);
  await page.unroute("**/api/credentials");
  await page.getByLabel("Provedor para mudanças simples").selectOption("codex");
  await page.getByLabel("Modelo para mudanças simples").fill("test-selected-model");
  await page.getByLabel("Esforço Simple", { exact: true }).selectOption("ultra");
  await page.getByLabel("Provedor para mudanças simples").selectOption("claude");
  assert.equal(await page.getByLabel("Esforço Simple", { exact: true }).inputValue(), "");
  await page.getByLabel("Provedor para mudanças simples").selectOption("codex");
  await page.getByLabel("Esforço Simple", { exact: true }).selectOption("high");
  await page.getByLabel("Esforço Complex", { exact: true }).selectOption("medium");
  await page.getByLabel("Esforço Planner", { exact: true }).selectOption("max");
  await page.getByRole("button", { name: "Salvar ajustes", exact: true }).click();
  await page.waitForFunction(() =>
    document.querySelector("#settings-status").textContent.includes("Ajustes salvos"),
  );
  assert.equal(config.defaultSimpleModel, "codex:test-selected-model");
  assert.equal(config.defaultSimpleEffort, "high");
  assert.equal(config.defaultComplexEffort, "medium");
  assert.equal(config.defaultPlannerEffort, "max");
  assert.equal(await page.getByLabel("Esforço Simple", { exact: true }).inputValue(), "high");
  await page.screenshot({ path: path.join(output, "agent-effort.png") });
  await page.getByRole("button", { name: "Fechar", exact: true }).last().click();
  await page.locator("#request").fill("Use o modelo escolhido.");
  await page.getByRole("button", { name: "Enviar pedido" }).click();
  await page.waitForFunction(
    () =>
      document.querySelector("#activity-title").textContent.includes("test-selected-model") &&
      document.querySelector("#activity-description").textContent.includes("Concluído"),
  );
  await page.waitForFunction(() => !document.querySelector("#send").disabled);
  await page.locator("#request").fill("Crie uma equipe automática.");
  await page.getByRole("button", { name: "Enviar pedido" }).click();
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll("#tabs [role=tab]")].filter((tab) =>
        tab.textContent.includes("Colaborador"),
      ).length === 2 &&
      document.querySelector("#activity-description").textContent.includes("Concluído"),
  );
  assert.equal(await readFile(path.join(folder, "a.txt"), "utf8"), "Colaborador A");
  assert.equal(await readFile(path.join(folder, "b.txt"), "utf8"), "Colaborador B");
  const configuredContexts = contexts.filter((c) => c.model === "codex:test-selected-model");
  assert.ok(configuredContexts.length >= 3);
  assert.ok(configuredContexts.every((c) => c.effort === "high"));
  await page.screenshot({ path: path.join(output, "collaboration.png") });
  await page.reload();
  await page.waitForFunction(
    () =>
      document.querySelector("#activity-title").textContent === "Simple · test-selected-model" &&
      document.querySelector("#activity-description").textContent.includes("Conclu\u00eddo"),
  );
  await page.locator("#request").fill("Confira a formatação.");
  await page.getByRole("button", { name: "Enviar pedido" }).click();
  await page
    .locator(".event-result .markdown-content h2")
    .filter({ hasText: "Como rodar" })
    .waitFor();
  assert.equal(
    await page.locator(".event-result .markdown-content strong").last().innerText(),
    "Tudo pronto.",
  );
  assert.equal(await page.locator(".event-result .markdown-content ol li").count(), 2);
  assert.equal(await page.locator(".event-result .markdown-content table").count(), 1);
  assert.equal(
    await page
      .locator(".event-result .markdown-content img, .event-result .markdown-content script")
      .count(),
    0,
  );
  assert.equal(await page.evaluate(() => window.markdownInjected), undefined);
  assert.equal(await page.locator('.event-result a[href^="javascript:"]').count(), 0);
  assert.equal(
    await page.locator('.event-result a[href="http://localhost:5173"]').getAttribute("rel"),
    "noopener noreferrer",
  );
  await page.evaluate(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (text) => {
          window.copiedCode = text;
        },
      },
    });
  });
  await page.getByRole("button", { name: "Copiar código" }).click();
  assert.equal(await page.evaluate(() => window.copiedCode), "npm run dev\n");
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.locator(".event-result").last().scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(output, "formatted-response.png") });
  for (const width of [320, 768]) {
    await page.setViewportSize({ width, height: 1000 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    await page.locator(".event-result").last().scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(output, `formatted-response-${width}.png`) });
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.locator("#terminal-tab").click();
  await page.waitForFunction(() => !document.querySelector("#terminal-command").disabled);
  await page
    .locator("#terminal-command")
    .fill(
      process.platform === "win32"
        ? "$uiValue = 'terminal-' + 'works'"
        : "uiValue=terminal-; uiValue=${uiValue}works",
    );
  await page.locator("#terminal-command").press("Enter");
  await page
    .locator("#terminal-command")
    .fill(
      process.platform === "win32"
        ? "Write-Output $uiValue; (Get-Location).Path"
        : "echo $uiValue; pwd",
    );
  await page.locator("#terminal-command").press("Enter");
  await page.waitForFunction(() =>
    document.querySelector("#terminal-output").textContent.includes("terminal-works"),
  );
  await page.waitForFunction(
    (cwd) => document.querySelector("#terminal-output").textContent.includes(cwd),
    folder,
  );
  await page.locator("#terminal-command").press("ArrowUp");
  assert.ok((await page.locator("#terminal-command").inputValue()).includes("uiValue"));
  await page.locator("#tabs [role=tab]").first().click();
  assert.equal(await page.locator("#terminal-panel").isVisible(), false);
  await page.locator("#terminal-tab").click();
  assert.ok((await page.locator("#terminal-output").textContent()).includes("terminal-works"));
  await page.screenshot({ path: path.join(output, "terminal.png") });
  await page
    .locator("#terminal-command")
    .fill(
      process.platform === "win32"
        ? '[Console]::WriteLine("$([char]27)[32m$([char]27)[1mVITE$([char]27)[0m ready")'
        : "printf '\\033[32m\\033[1mVITE\\033[0m ready\\n'",
    );
  await page.locator("#terminal-command").press("Enter");
  await page
    .locator("#terminal-output .ansi-green.ansi-bold")
    .filter({ hasText: "VITE" })
    .waitFor();
  assert.equal((await page.locator("#terminal-output").textContent()).includes("\x1b"), false);
  await page.screenshot({ path: path.join(output, "formatted-terminal.png") });
  await page.locator("#terminal-stop").click();
  await page.waitForFunction(() => document.querySelector("#terminal-command").disabled);
  await page.locator("#terminal-clear").click();
  await page.waitForFunction(
    () => !document.querySelector("#terminal-output").textContent.includes("terminal-works"),
  );
  await page
    .locator("#tabs [role=tab]")
    .filter({ hasText: "Simple · test-selected-model" })
    .first()
    .click();
  await page.locator("#context-label").filter({ hasText: "200.000" }).waitFor();
  await page.locator("#request").focus();
  assert.equal(
    await page.locator("#request").evaluate((el) => getComputedStyle(el).outlineStyle),
    "none",
  );
  const initialInput = await page.locator("#request-form").evaluate((el) => el.clientHeight);
  await page.locator("#input-resizer").focus();
  await page.locator("#input-resizer").press("ArrowDown");
  assert.ok((await page.locator("#request-form").evaluate((el) => el.clientHeight)) > initialInput);
  const initialSidebar = await page.locator(".projects-panel").evaluate((el) => el.clientWidth);
  await page.locator("#projects-resizer").focus();
  await page.locator("#projects-resizer").press("ArrowRight");
  assert.ok(
    (await page.locator(".projects-panel").evaluate((el) => el.clientWidth)) > initialSidebar,
  );
  await page.locator("#compact-context").click();
  await page.waitForFunction(
    () =>
      document.querySelector("#activity-description").textContent.includes("Concluído") &&
      document.querySelector("#activity").textContent.includes("Contexto compactado"),
  );
  assert.ok((await page.locator("#context-label").textContent()).includes("estimado"));
  await page.screenshot({ path: path.join(output, "session-controls.png") });
  const rootTab = page
    .locator("#tabs [role=tab]")
    .filter({ hasText: "Simple · test-selected-model" })
    .first();
  const closedId = (await rootTab.getAttribute("id")).slice(4);
  await rootTab
    .locator("..")
    .getByRole("button", { name: "Fechar Simple · test-selected-model", exact: true })
    .click();
  await page.waitForFunction((id) => !document.getElementById(`tab-${id}`), closedId);
  await page.reload();
  await page.waitForFunction(
    () => document.querySelector("#connection").textContent === "Conectado",
  );
  assert.equal(await page.locator(`#tab-${closedId}`).count(), 0);
  assert.ok((await page.locator("#request-form").evaluate((el) => el.clientHeight)) > initialInput);
  assert.ok(
    (await page.locator(".projects-panel").evaluate((el) => el.clientWidth)) > initialSidebar,
  );
  assert.deepEqual(errors, []);
  await writeFile(
    path.join(output, "report.json"),
    JSON.stringify(
      {
        passed: true,
        checks: [
          "plain folder",
          "persistent model sessions",
          "provider context resumed",
          "response shown once",
          "model selection applied",
          "automatic collaborators",
          "direct writes",
          "live activity",
          "draft preserved",
          "session switching",
          "keyboard tabs",
          "reload",
          "themes",
          "responsive",
          "stop",
          "errors",
          "escaping",
          "accounts",
          "persistent project terminal",
          "terminal command history",
          "terminal switching and shutdown",
          "Markdown formatting and code copy",
          "Markdown HTML and URL sanitization",
          "ANSI terminal colors without escape artifacts",
          "role and model session names",
          "session close and context compaction",
          "context occupancy indicator",
          "resizable panels and persisted layout",
          "request input without focus border",
        ],
        errors,
      },
      null,
      2,
    ),
  );
  console.log(`UI passed. Screenshots: ${output}`);
} finally {
  await browser?.close();
  await server.close();
}
