import { api } from "./api.js";

import {
  renderActivity,
  renderProjects,
  renderTabs,
  statusText,
  sessionTitle,
} from "./workspace.js";
import { setupLayout } from "./layout.js";

import { setupSettings } from "./settings.js";
import { setupTerminal } from "./terminal.js";
import { setupAttachments } from "./attachments.js";

const $ = (id) => document.getElementById(id);
let terminalMode = false;
const terminal = setupTerminal(() => {
  terminalMode = true;
  update();
}, notice);

let projects = [],
  projectId = localStorage.getItem("direct-project") || "",
  sessionId = "",
  currentSession = null;

let connected = false,
  sending = false,
  requestVersion = 0;
const attachments = setupAttachments(update, notice);

const running = (status) => ["routing", "running", "stopping"].includes(status);

function notice(text = "") {
  $("notice").textContent = text;

  $("notice").hidden = !text;
}

function project() {
  return projects.find((p) => p.id === projectId);
}

function latestSessionId(p) {
  return (
    [...(p?.sessions || [])]
      .filter((s) => s.role !== "helper")
      .sort((a, b) => (b.updatedAt || b.createdAt) - (a.updatedAt || a.createdAt))[0]?.id || ""
  );
}

function update() {
  if (!project()) projectId = projects[0]?.id || "";

  const p = project();

  if (p && !p.sessions.some((s) => s.id === sessionId)) sessionId = latestSessionId(p);

  localStorage.setItem("direct-project", projectId);

  renderProjects($("projects"), projects, projectId, selectProject, removeProject);

  renderTabs(
    $("tabs"),
    p?.sessions || [],
    terminalMode ? "" : sessionId,
    selectSession,
    () => {
      terminalMode = true;
      update();
    },
    closeSession,
  );
  terminal.update(p, terminalMode);

  $("request-folder").textContent = p
    ? `${p.name} · ${p.rootPath}`
    : "Escolha uma pasta à esquerda";

  $("request-folder").title = p?.rootPath || "";

  $("send").disabled =
    !connected ||
    !p ||
    sending ||
    attachments.pending ||
    p.busy ||
    p.sessions.some((s) => running(s.status));

  $("send").textContent = sending
    ? "Jev escolhendo…"
    : p?.sessions.some((s) => running(s.status))
      ? "Agente trabalhando"
      : "Enviar pedido ↗";

  const selected = p?.sessions.find((s) => s.id === sessionId);
  const context = selected?.context;
  const count = (n) => new Intl.NumberFormat("pt-BR").format(n);
  $("context-controls").hidden = !selected;
  $("compact-context").disabled = !connected || !selected || running(selected.status) || p?.busy;
  $("compact-context").textContent = selected?.compacting ? "Compactando…" : "Compactar contexto";
  $("context-label").textContent = context
    ? `Contexto ${context.source === "estimate" ? "estimado" : "SDK"} · ${context.source === "estimate" ? "≈ " : ""}${count(context.usedTokens)} / ${context.limitTokens ? count(context.limitTokens) : "limite não informado"} tokens`
    : "Contexto · aguardando dados do modelo";
  $("context-label").title =
    "Estimativa de ocupação, não consumo de tokens. Claude usa a última entrada quando disponível; Codex estima pelos textos conhecidos, sem conhecer todo o contexto interno nem compactações automáticas. Limites documentados podem diferir da janela efetiva. Atualizado após cada chamada.";
  $("context-progress").hidden = !context?.limitTokens;
  $("context-progress").max = context?.limitTokens || 1;
  $("context-progress").value = context?.usedTokens || 0;

  $("stop").hidden = !p?.routing && (!selected || !running(selected.status));

  $("stop").disabled = Boolean(p?.routing?.stopping) || selected?.status === "stopping";

  $("activity-title").textContent = p?.routing
    ? "Jev escolhendo o modelo"
    : selected
      ? sessionTitle(selected)
      : "Atividade do agente";

  $("activity-description").textContent = p?.routing
    ? "O pedido será enviado à sessão do modelo escolhido."
    : selected
      ? `${selected.compacting ? "Compactando contexto" : statusText(selected.status)} · ${selected.source === "heuristic" ? "Roteamento local" : selected.source === "jev" ? "Escolhido pelo Jev" : "Escolhendo o modelo"}${selected.effort ? ` · Esforço: ${selected.effort}` : ""}`
      : "Respostas, ferramentas e progresso em tempo real.";

  if (!selected) {
    currentSession = null;

    renderActivity($("activity"), null);
  }
}

async function loadSession() {
  const id = sessionId,
    version = ++requestVersion;

  if (!id) {
    currentSession = null;

    renderActivity($("activity"), null);

    return;
  }

  try {
    const data = await api(`/api/sessions/${id}`);

    if (version !== requestVersion || sessionId !== id) return;

    const same = currentSession?.id === id;

    currentSession = data;

    renderActivity($("activity"), data, same);
  } catch (error) {
    notice(error.message);
  }
}

function selectProject(id) {
  projectId = id;

  sessionId = latestSessionId(projects.find((p) => p.id === id));

  currentSession = null;

  update();

  void loadSession();
}

function selectSession(id) {
  terminalMode = false;
  sessionId = id;

  update();

  void loadSession();
}
async function closeSession(id) {
  try {
    await api(`/api/sessions/${id}`, "DELETE");
    if (sessionId === id) {
      sessionId = "";
      currentSession = null;
    }
    await refresh();
  } catch (error) {
    notice(error.message);
  }
}
$("compact-context").addEventListener("click", async () => {
  const id = sessionId;
  $("compact-context").disabled = true;
  try {
    await api(`/api/sessions/${id}/compact`, "POST", {});
    await refresh();
  } catch (error) {
    notice(error.message);
  } finally {
    update();
  }
});

async function removeProject(id) {
  const p = projects.find((p) => p.id === id);

  if (!window.confirm(`Remover “${p.name}” da lista? Os arquivos da pasta serão mantidos.`)) return;

  try {
    await api(`/api/projects/${id}`, "DELETE");

    await refresh();
  } catch (error) {
    notice(error.message);
  }
}

async function refresh() {
  projects = await api("/api/projects");

  update();

  await loadSession();
}

$("request-form").addEventListener("submit", async (event) => {
  event.preventDefault();

  const text = $("request").value.trim(),
    id = projectId;
  const sentAttachments = attachments.snapshot();

  if ((!text && !sentAttachments.length) || $("send").disabled) return;

  sending = true;

  notice();

  update();

  try {
    const session = await api(`/api/projects/${id}/sessions`, "POST", {
      text,
      attachments: sentAttachments.map(({ name, mimeType, data }) => ({ name, mimeType, data })),
    });

    if (projectId === id) {
      sessionId = session.id;
      terminalMode = false;
    }

    if ($("request").value.trim() === text) $("request").value = "";
    attachments.clear(sentAttachments);

    await refresh();
  } catch (error) {
    notice(error.message);
  } finally {
    sending = false;

    update();
  }
});

$("request").addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
    event.preventDefault();

    $("request-form").requestSubmit();
  }
});

$("stop").addEventListener("click", async () => {
  try {
    await api(`/api/sessions/${project()?.routing?.id || sessionId}/stop`, "POST", {});

    await refresh();
  } catch (error) {
    notice(error.message);
  }
});

document

  .querySelectorAll("[data-close]")

  .forEach((button) => button.addEventListener("click", () => $(button.dataset.close).close()));

$("add-project").addEventListener("click", async () => {
  $("folder-error").textContent = "";

  if (window.claudexApp?.pickFolder) {
    try {
      const folder = await window.claudexApp.pickFolder();

      if (folder) await addFolder(folder);
    } catch (error) {
      notice(error.message);
    }
  } else {
    $("folder-dialog").showModal();

    $("folder-path").focus();
  }
});

async function addFolder(folder, name) {
  const p = await api("/api/projects", "POST", { rootPath: folder, name });

  projectId = p.id;

  sessionId = "";

  await refresh();

  notice();
}

$("folder-form").addEventListener("submit", async (event) => {
  event.preventDefault();

  try {
    await addFolder($("folder-path").value, $("folder-name").value);

    $("folder-dialog").close();

    $("folder-form").reset();
  } catch (error) {
    $("folder-error").textContent = error.message;
  }
});

let parentFolder = "";

async function browse(folder = "") {
  try {
    const data = await api(`/api/fs/list?path=${encodeURIComponent(folder)}`);

    $("folder-path").value = data.path;

    parentFolder = data.parent;

    $("parent-folder").hidden = data.parent === data.path;

    $("folder-browser").replaceChildren();

    for (const entry of data.entries) {
      const b = document.createElement("button");

      b.type = "button";

      b.textContent = entry.name;

      b.addEventListener("click", () => void browse(entry.path));

      $("folder-browser").append(b);
    }

    $("folder-error").textContent = "";
  } catch (error) {
    $("folder-error").textContent = error.message;
  }
}

$("browse").addEventListener("click", () => void browse($("folder-path").value));

$("parent-folder").addEventListener("click", () => void browse(parentFolder));

function theme(value) {
  document.documentElement.dataset.theme = value;

  localStorage.setItem("direct-theme", value);

  $("theme").textContent = value === "dark" ? "Tema claro" : "Tema escuro";
}

theme(localStorage.getItem("direct-theme") || "dark");

$("theme").addEventListener("click", () =>
  theme(document.documentElement.dataset.theme === "dark" ? "light" : "dark"),
);

setupSettings();
setupLayout();

function connect() {
  const ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}`);

  ws.addEventListener("open", () => {
    connected = true;

    $("connection").textContent = "Conectado";

    update();

    void refresh().catch((error) => notice(error.message));
    void terminal.reconnect();
  });

  ws.addEventListener("message", (event) => {
    let message;

    try {
      message = JSON.parse(event.data);
    } catch {
      return;
    }

    if (message.type === "projects") {
      projects = message.data;

      const previous = sessionId;

      update();

      const selected = project()?.sessions.find((s) => s.id === sessionId);

      if (
        previous !== sessionId ||
        (selected &&
          !running(selected.status) &&
          (currentSession?.id !== selected.id ||
            currentSession.status !== selected.status ||
            currentSession.events.length < selected.eventCount))
      )
        void loadSession();
    }

    if (
      message.type === "activity" &&
      message.data.sessionId === sessionId &&
      currentSession?.id === sessionId
    ) {
      if (!currentSession.events.some((e) => e.id === message.data.event.id))
        currentSession.events.push(message.data.event);

      if (currentSession.events.length > 500)
        currentSession.events.splice(0, currentSession.events.length - 500);

      currentSession.status = message.data.status;

      renderActivity($("activity"), currentSession, true);
    }

    if (message.type === "account:output") $("account-output").textContent = message.line;
    if (message.type === "terminal") terminal.receive(message.data);

    if (message.type === "error") notice(message.message);
  });

  ws.addEventListener("close", () => {
    connected = false;

    $("connection").textContent = "Reconectando…";

    update();

    setTimeout(connect, 1500);
  });

  ws.addEventListener("error", () => ws.close());
}

connect();
