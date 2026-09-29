const state = {
  projects: [],
  currentId: null,
  snapshot: null,
  diff: "",
  diffFiles: [],
  running: false,
  routing: null,
  autoscroll: true,
  browserPath: "",
  browserParent: null,
};

const els = {
  projectList: document.getElementById("project-list"),
  newProjectBtn: document.getElementById("new-project-btn"),
  credSummary: document.getElementById("cred-summary"),
  projName: document.getElementById("proj-name"),
  projMeta: document.getElementById("proj-meta"),
  applyBtn: document.getElementById("apply-btn"),
  discardBtn: document.getElementById("discard-btn"),
  themeToggle: document.getElementById("theme-toggle"),
  transcript: document.getElementById("transcript"),
  composer: document.getElementById("composer"),
  input: document.getElementById("composer-input"),
  sendBtn: document.getElementById("send-btn"),
  diffFiles: document.getElementById("diff-files"),
  diffView: document.getElementById("diff-view"),
  tabSession: document.getElementById("tab-session"),
  modal: document.getElementById("modal"),
  modalClose: document.getElementById("modal-close"),
  npName: document.getElementById("np-name"),
  npPath: document.getElementById("np-path"),
  npBrowse: document.getElementById("np-browse"),
  npCreate: document.getElementById("np-create"),
  npStatus: document.getElementById("np-status"),
  browserModal: document.getElementById("browser-modal"),
  browserClose: document.getElementById("browser-close"),
  browserPath: document.getElementById("browser-path"),
  browserList: document.getElementById("browser-list"),
  browserUp: document.getElementById("browser-up"),
  browserSelect: document.getElementById("browser-select"),
};

const THEME_KEY = "claudex-theme";
let socket = null;

function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  els.themeToggle.textContent = theme === "dark" ? "light" : "dark";
}

function initTheme() {
  const saved = localStorage.getItem(THEME_KEY);
  const prefersLight = window.matchMedia("(prefers-color-scheme: light)").matches;
  applyTheme(saved || (prefersLight ? "light" : "dark"));
}

function currentProject() {
  return state.projects.find((p) => p.id === state.currentId) || null;
}

function renderSidebar() {
  els.projectList.replaceChildren();
  if (state.projects.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "nenhum projeto ainda";
    els.projectList.appendChild(empty);
    return;
  }
  for (const project of state.projects) {
    const item = document.createElement("div");
    item.className = "project" + (project.id === state.currentId ? " selected" : "");
    item.onclick = () => selectProject(project.id);

    const head = document.createElement("div");
    head.className = "project-head";
    const dot = document.createElement("span");
    dot.className = "dot " + (project.running ? "running" : "");
    const name = document.createElement("span");
    name.className = "project-name";
    name.textContent = project.name;
    head.append(dot, name);

    const pathEl = document.createElement("div");
    pathEl.className = "project-path";
    pathEl.textContent = project.rootPath;

    item.append(head, pathEl);
    els.projectList.appendChild(item);
  }
}

function renderHeader() {
  const project = currentProject();
  if (!project) {
    els.projName.textContent = "nenhum projeto";
    els.projMeta.textContent = "";
    els.applyBtn.disabled = true;
    els.discardBtn.disabled = true;
    return;
  }
  els.projName.textContent = project.name;
  const bits = [project.rootPath];
  if (state.snapshot?.baseBranch) bits.push(`base: ${state.snapshot.baseBranch}`);
  if (state.snapshot?.branch) bits.push(`branch: ${state.snapshot.branch}`);
  if (state.routing) {
    bits.push(state.routing.label ? `${state.routing.label} → ${state.routing.agent}` : state.routing.agent);
  }
  els.projMeta.textContent = bits.join("  •  ");

  const canAct = state.diffFiles.length > 0 && !state.running;
  els.applyBtn.disabled = !canAct;
  els.discardBtn.disabled = !canAct;
}

function messageEl(message) {
  const el = document.createElement("div");
  el.className = `msg ${message.role}`;

  const who = document.createElement("div");
  who.className = "who";
  who.textContent = labelFor(message.role);

  const bubble = document.createElement("div");
  bubble.className = "bubble";
  bubble.textContent = message.meta ? `${message.text}\n${message.meta}` : message.text;

  el.append(who, bubble);
  return el;
}

function labelFor(role) {
  switch (role) {
    case "user":
      return "você";
    case "assistant":
      return "agente";
    case "tool":
      return "tool";
    case "result":
      return "resultado";
    case "routing":
      return "roteamento";
    case "error":
      return "erro";
    default:
      return "sistema";
  }
}

function renderTranscript() {
  const project = currentProject();
  els.transcript.replaceChildren();
  if (!project) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "crie ou selecione um projeto para começar.";
    els.transcript.appendChild(empty);
    return;
  }
  const messages = state.snapshot?.project?.messages ?? [];
  if (messages.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "descreva uma tarefa para os agentes começarem.";
    els.transcript.appendChild(empty);
  }
  for (const message of messages) els.transcript.appendChild(messageEl(message));

  if (state.running) {
    const typing = document.createElement("div");
    typing.className = "msg assistant typing";
    const bubble = document.createElement("div");
    bubble.className = "bubble";
    bubble.textContent = "pensando ";
    typing.appendChild(bubble);
    els.transcript.appendChild(typing);
  }

  if (state.autoscroll) els.transcript.scrollTop = els.transcript.scrollHeight;
}

function renderDiff() {
  els.diffFiles.replaceChildren();
  for (const file of state.diffFiles) {
    const chip = document.createElement("span");
    chip.className = "file-chip";
    chip.textContent = file;
    els.diffFiles.appendChild(chip);
  }
  if (!state.diff) {
    els.diffView.innerHTML = '<span class="empty">sem alterações pendentes</span>';
    return;
  }
  els.diffView.replaceChildren();
  const frag = document.createDocumentFragment();
  for (const line of state.diff.split("\n")) {
    const span = document.createElement("span");
    if (line.startsWith("+") && !line.startsWith("+++")) span.className = "add";
    else if (line.startsWith("-") && !line.startsWith("---")) span.className = "del";
    span.textContent = line + "\n";
    frag.appendChild(span);
  }
  els.diffView.appendChild(frag);
}

function renderSession() {
  const project = currentProject();
  if (!project) {
    els.tabSession.innerHTML = '<span class="empty">sem projeto</span>';
    return;
  }
  const p = state.snapshot?.project ?? {};
  const rows = [
    ["projeto", project.name],
    ["pasta", project.rootPath],
    ["branch", p.branch || "—"],
    ["base", p.baseBranch || "—"],
    ["agente", p.activeAgent || "—"],
    ["claude session", p.claudeSessionId || "—"],
    ["codex thread", p.codexThreadId || "—"],
    ["mensagens", String((p.messages ?? []).length)],
  ];
  els.tabSession.replaceChildren();
  for (const [k, v] of rows) {
    const card = document.createElement("div");
    card.className = "session-card";
    const kEl = document.createElement("div");
    kEl.className = "k";
    kEl.textContent = k;
    const vEl = document.createElement("div");
    vEl.className = "v";
    vEl.textContent = v;
    card.append(kEl, vEl);
    els.tabSession.appendChild(card);
  }
}

function render() {
  renderSidebar();
  renderHeader();
  renderTranscript();
  renderDiff();
  renderSession();
}

async function selectProject(projectId) {
  state.currentId = projectId;
  state.snapshot = null;
  state.diff = "";
  state.diffFiles = [];
  state.routing = null;
  render();
  try {
    const res = await fetch(`/api/projects/${projectId}`);
    if (!res.ok) return;
    const snap = await res.json();
    if (state.currentId !== projectId) return;
    state.snapshot = snap;
    state.diff = snap.diff || "";
    state.diffFiles = snap.files || [];
    state.running = !!snap.running;
    if (snap.project?.activeAgent) {
      state.routing = { agent: snap.project.activeAgent, label: "" };
    }
    render();
  } catch {
    /* ignore */
  }
}

function loadProjects() {
  fetch("/api/projects")
    .then((r) => r.json())
    .then((data) => {
      state.projects = data;
      renderSidebar();
      if (!state.currentId && data.length > 0) selectProject(data[0].id);
    })
    .catch(() => undefined);
}

function loadCredentials() {
  fetch("/api/credentials")
    .then((r) => r.json())
    .then((cred) => {
      const parts = [
        `claude: ${cred.claude?.mode ?? "?"}`,
        `codex: ${cred.codex?.mode ?? "?"}`,
        `jev: ${cred.typesafe?.configured ? "ok" : "off"}`,
      ];
      els.credSummary.textContent = parts.join("  ·  ");
      els.credSummary.className = "muted";
    })
    .catch(() => undefined);
}

function sendMessage() {
  const text = els.input.value.trim();
  if (!text || !state.currentId || state.running) return;
  socket?.send(JSON.stringify({ type: "chat:send", projectId: state.currentId, text }));
  els.input.value = "";
  autoGrow();
}

function autoGrow() {
  els.input.style.height = "auto";
  els.input.style.height = `${Math.min(els.input.scrollHeight, 180)}px`;
}

function openModal() {
  els.npName.value = "";
  els.npPath.value = "";
  els.npStatus.textContent = "";
  els.npStatus.className = "np-status";
  els.modal.classList.remove("hidden");
}

function closeModal() {
  els.modal.classList.add("hidden");
}

async function browseFolder() {
  try {
    if (window.claudexApp?.pickFolder) {
      const folder = await window.claudexApp.pickFolder();
      if (folder) applyPickedFolder(folder);
      return;
    }
    openBrowser(els.npPath.value.trim());
  } catch {
    /* ignore */
  }
}

function applyPickedFolder(folder) {
  els.npPath.value = folder;
  if (!els.npName.value) {
    els.npName.value = folder.replace(/[\\/]+$/, "").split(/[\\/]/).pop();
  }
  validatePath();
}

function openBrowser(startPath) {
  els.browserModal.classList.remove("hidden");
  loadBrowser(startPath || "");
}

function closeBrowser() {
  els.browserModal.classList.add("hidden");
}

async function loadBrowser(target) {
  els.browserPath.textContent = target || "unidades";
  els.browserList.replaceChildren();
  const loading = document.createElement("div");
  loading.className = "browser-empty";
  loading.textContent = "carregando...";
  els.browserList.appendChild(loading);
  state.browserPath = target || "";
  try {
    const res = await fetch(`/api/fs/list?path=${encodeURIComponent(target || "")}`);
    const data = await res.json();
    state.browserPath = data.path || target || "";
    state.browserParent = data.parent ?? null;
    els.browserPath.textContent = data.path || "unidades";
    els.browserList.replaceChildren();
    if (data.error) {
      const err = document.createElement("div");
      err.className = "browser-empty";
      err.textContent = `sem acesso: ${data.error}`;
      els.browserList.appendChild(err);
    }
    if (data.entries.length === 0 && !data.error) {
      const empty = document.createElement("div");
      empty.className = "browser-empty";
      empty.textContent = "nenhuma subpasta";
      els.browserList.appendChild(empty);
    }
    for (const entry of data.entries) {
      const row = document.createElement("div");
      row.className = "browser-row";
      row.onclick = () => loadBrowser(entry.path);

      const ico = document.createElement("span");
      ico.className = "ico";
      ico.textContent = "▸";
      const nm = document.createElement("span");
      nm.className = "nm";
      nm.textContent = entry.name;
      row.append(ico, nm);
      if (entry.isGitRepo) {
        const git = document.createElement("span");
        git.className = "git";
        git.textContent = "git";
        row.appendChild(git);
      }
      els.browserList.appendChild(row);
    }
    els.browserUp.disabled = !data.parent;
  } catch (err) {
    els.browserList.replaceChildren();
    const err2 = document.createElement("div");
    err2.className = "browser-empty";
    err2.textContent = String(err);
    els.browserList.appendChild(err2);
  }
}

async function validatePath() {
  const rootPath = els.npPath.value.trim();
  if (!rootPath) {
    els.npStatus.textContent = "";
    els.npStatus.className = "np-status";
    return;
  }
  try {
    const res = await fetch("/api/validate-path", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rootPath }),
    });
    const data = await res.json();
    if (data.isGitRepo) {
      els.npStatus.textContent = "repositório git válido";
      els.npStatus.className = "np-status ok";
    } else {
      els.npStatus.textContent = "não é um repositório git (rode git init)";
      els.npStatus.className = "np-status err";
    }
  } catch {
    els.npStatus.textContent = "não foi possível validar";
    els.npStatus.className = "np-status err";
  }
}

async function createProject() {
  const rootPath = els.npPath.value.trim();
  if (!rootPath) {
    els.npStatus.textContent = "escolha a pasta do projeto";
    els.npStatus.className = "np-status err";
    return;
  }
  els.npCreate.disabled = true;
  try {
    const res = await fetch("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: els.npName.value.trim(), rootPath }),
    });
    const data = await res.json();
    if (!res.ok) {
      els.npStatus.textContent = data.error || "erro ao criar";
      els.npStatus.className = "np-status err";
      return;
    }
    closeModal();
    await loadProjects();
    selectProject(data.id);
  } catch (err) {
    els.npStatus.textContent = String(err);
    els.npStatus.className = "np-status err";
  } finally {
    els.npCreate.disabled = false;
  }
}

function handleMessage(msg) {
  switch (msg.type) {
    case "projects":
      state.projects = msg.data;
      renderSidebar();
      if (!state.currentId && state.projects.length > 0) selectProject(state.projects[0].id);
      break;
    case "chat:message": {
      if (msg.projectId !== state.currentId || !state.snapshot) break;
      state.snapshot.project.messages.push(msg.message);
      renderTranscript();
      break;
    }
    case "chat:routing": {
      if (msg.projectId !== state.currentId) break;
      state.routing = { agent: msg.agent, label: msg.label };
      renderHeader();
      break;
    }
    case "chat:turn": {
      if (msg.projectId !== state.currentId) break;
      state.running = msg.status === "started";
      els.sendBtn.disabled = state.running;
      render();
      break;
    }
    case "chat:diff": {
      state.projects = state.projects.map((p) => ({ ...p }));
      if (msg.projectId === state.currentId) {
        state.diff = msg.diff;
        state.diffFiles = msg.files;
        renderDiff();
        renderHeader();
      }
      break;
    }
    case "chat:error": {
      if (msg.projectId !== state.currentId || !state.snapshot) break;
      state.snapshot.project.messages.push({
        id: String(Date.now()),
        at: Date.now(),
        role: "error",
        text: msg.error,
      });
      renderTranscript();
      break;
    }
    default:
      break;
  }
}

function connect() {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  socket = new WebSocket(`${proto}://${location.host}`);
  socket.onmessage = (event) => {
    try {
      handleMessage(JSON.parse(event.data));
    } catch {
      /* ignore */
    }
  };
  socket.onclose = () => setTimeout(connect, 1500);
}

els.newProjectBtn.addEventListener("click", openModal);
els.modalClose.addEventListener("click", closeModal);
els.npBrowse.addEventListener("click", browseFolder);
els.npPath.addEventListener("input", () => validatePath());
els.npCreate.addEventListener("click", createProject);
els.modal.addEventListener("click", (event) => {
  if (event.target === els.modal) closeModal();
});

els.browserClose.addEventListener("click", closeBrowser);
els.browserUp.addEventListener("click", () => loadBrowser(state.browserParent || ""));
els.browserSelect.addEventListener("click", () => {
  if (state.browserPath) applyPickedFolder(state.browserPath);
  closeBrowser();
});
els.browserModal.addEventListener("click", (event) => {
  if (event.target === els.browserModal) closeBrowser();
});

els.composer.addEventListener("submit", (event) => {
  event.preventDefault();
  sendMessage();
});

els.input.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    sendMessage();
  }
});
els.input.addEventListener("input", autoGrow);

els.applyBtn.addEventListener("click", () => {
  if (state.currentId) socket?.send(JSON.stringify({ type: "chat:action", projectId: state.currentId, action: "apply" }));
});
els.discardBtn.addEventListener("click", () => {
  if (state.currentId) socket?.send(JSON.stringify({ type: "chat:action", projectId: state.currentId, action: "discard" }));
});

els.themeToggle.addEventListener("click", () => {
  const current = document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark";
  const next = current === "dark" ? "light" : "dark";
  localStorage.setItem(THEME_KEY, next);
  applyTheme(next);
});

document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    const name = tab.dataset.tab;
    document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t === tab));
    document.querySelectorAll(".tab-panel").forEach((p) => p.classList.toggle("active", p.id === `tab-${name}`));
  });
});

els.transcript.addEventListener("scroll", () => {
  state.autoscroll = Math.abs(els.transcript.scrollHeight - els.transcript.scrollTop - els.transcript.clientHeight) < 40;
});

initTheme();
loadProjects();
loadCredentials();
render();
connect();
