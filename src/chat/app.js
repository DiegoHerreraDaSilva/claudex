const I18N = {
  pt: {
    newProject: "+ novo projeto",
    noProject: "nenhum projeto",
    stop: "parar",
    apply: "aplicar",
    discard: "descartar",
    settings: "configurações",
    send: "enviar",
    composerPlaceholder: "descreva a tarefa para os agentes...",
    tabDiff: "diff",
    tabSession: "sessão",
    newProjectTitle: "novo projeto",
    close: "fechar",
    name: "nome",
    folderLabel: "pasta do projeto (repositório git)",
    chooseFolder: "escolher pasta",
    createProject: "criar projeto",
    chooseFolderTitle: "escolher pasta",
    up: "subir",
    selectFolder: "selecionar esta pasta",
    settingsTitle: "contas e chaves",
    connectSub: "conectar (assinatura)",
    connectChatgpt: "conectar (ChatGPT)",
    disconnect: "desconectar",
    clearAnthropic: "remover chave e voltar para a assinatura",
    clearOpenai: "remover chave e voltar para o login ChatGPT",
    codexModel: "modelo forte do Codex",
    authLog: "log de autenticação",
    save: "salvar",
    typesafePh: "cole a chave de console.typesafe.ai/keys",
    emptyNoProjects: "nenhum projeto ainda",
    emptySelect: "crie ou selecione um projeto para começar.",
    emptyDescribe: "descreva uma tarefa para os agentes começarem.",
    thinking: "pensando ",
    noDiff: "sem alterações pendentes",
    noSession: "sem projeto",
    gitValid: "repositório git válido",
    gitInvalid: "não é um repositório git (rode git init)",
    validateFail: "não foi possível validar",
    needFolder: "escolha a pasta do projeto",
    createError: "erro ao criar",
    browserLoading: "carregando...",
    browserEmpty: "nenhuma subpasta",
    browserNoAccess: "sem acesso: ",
    saved: "salvo em .env e aplicado",
    saveError: "erro ao salvar",
    noConnection: "sem conexão com o servidor",
    roleUser: "você",
    roleAssistant: "agente",
    roleTool: "tool",
    roleResult: "resultado",
    roleRouting: "roteamento",
    roleError: "erro",
    roleSystem: "sistema",
  },
  en: {
    newProject: "+ new project",
    noProject: "no project",
    stop: "stop",
    apply: "apply",
    discard: "discard",
    settings: "settings",
    send: "send",
    composerPlaceholder: "describe the task for the agents...",
    tabDiff: "diff",
    tabSession: "session",
    newProjectTitle: "new project",
    close: "close",
    name: "name",
    folderLabel: "project folder (git repository)",
    chooseFolder: "choose folder",
    createProject: "create project",
    chooseFolderTitle: "choose folder",
    up: "up",
    selectFolder: "select this folder",
    settingsTitle: "accounts & keys",
    connectSub: "connect (subscription)",
    connectChatgpt: "connect (ChatGPT)",
    disconnect: "disconnect",
    clearAnthropic: "clear key and use the subscription",
    clearOpenai: "clear key and use the ChatGPT login",
    codexModel: "Codex strong model",
    authLog: "auth log",
    save: "save",
    typesafePh: "paste the key from console.typesafe.ai/keys",
    emptyNoProjects: "no projects yet",
    emptySelect: "create or select a project to start.",
    emptyDescribe: "describe a task for the agents to begin.",
    thinking: "thinking ",
    noDiff: "no pending changes",
    noSession: "no project",
    gitValid: "valid git repository",
    gitInvalid: "not a git repository (run git init)",
    validateFail: "could not validate",
    needFolder: "choose the project folder",
    createError: "failed to create",
    browserLoading: "loading...",
    browserEmpty: "no subfolders",
    browserNoAccess: "no access: ",
    saved: "saved to .env and applied",
    saveError: "failed to save",
    noConnection: "no connection to the server",
    roleUser: "you",
    roleAssistant: "agent",
    roleTool: "tool",
    roleResult: "result",
    roleRouting: "routing",
    roleError: "error",
    roleSystem: "system",
  },
};

const THEME_KEY = "claudex-theme";
const LANG_KEY = "claudex-lang";

const state = {
  projects: [],
  currentId: null,
  snapshot: null,
  diff: "",
  diffFiles: [],
  running: false,
  routing: null,
  credentials: null,
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
  stopBtn: document.getElementById("stop-btn"),
  applyBtn: document.getElementById("apply-btn"),
  discardBtn: document.getElementById("discard-btn"),
  langToggle: document.getElementById("lang-toggle"),
  themeToggle: document.getElementById("theme-toggle"),
  settingsBtn: document.getElementById("settings-btn"),
  settingsDot: document.getElementById("settings-dot"),
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
  settingsModal: document.getElementById("settings-modal"),
  settingsClose: document.getElementById("settings-close"),
  settingsSave: document.getElementById("settings-save"),
  settingsMsg: document.getElementById("settings-msg"),
  credStatus: document.getElementById("cred-status"),
  tsHint: document.getElementById("ts-hint"),
  claudeMode: document.getElementById("claude-mode"),
  claudeAccount: document.getElementById("claude-account"),
  codexMode: document.getElementById("codex-mode"),
  codexAccount: document.getElementById("codex-account"),
  inputTypesafe: document.getElementById("input-typesafe"),
  inputAnthropic: document.getElementById("input-anthropic"),
  inputOpenai: document.getElementById("input-openai"),
  inputComplexModel: document.getElementById("input-complex-model"),
  clearAnthropic: document.getElementById("clear-anthropic"),
  clearOpenai: document.getElementById("clear-openai"),
  accountLog: document.getElementById("account-log"),
};

let socket = null;
let lang = "pt";

function t(key, params) {
  const dict = I18N[lang] ?? I18N.en;
  let value = dict[key] ?? I18N.en[key] ?? key;
  if (params) {
    for (const [k, v] of Object.entries(params)) value = value.split(`{${k}}`).join(String(v));
  }
  return value;
}

function applyStatic() {
  document.documentElement.lang = lang === "pt" ? "pt-BR" : "en";
  document.querySelectorAll("[data-i18n]").forEach((el) => {
    el.textContent = t(el.dataset.i18n);
  });
  document.querySelectorAll("[data-i18n-ph]").forEach((el) => {
    el.placeholder = t(el.dataset.i18nPh);
  });
  els.langToggle.textContent = lang === "pt" ? "EN" : "PT";
}

function setLang(next) {
  lang = next === "en" ? "en" : "pt";
  localStorage.setItem(LANG_KEY, lang);
  applyStatic();
  render();
}

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
    empty.textContent = t("emptyNoProjects");
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
    els.projName.textContent = t("noProject");
    els.projMeta.textContent = "";
    els.applyBtn.disabled = true;
    els.discardBtn.disabled = true;
    els.stopBtn.disabled = true;
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
  els.stopBtn.disabled = !state.running;
  const canAct = state.diffFiles.length > 0 && !state.running;
  els.applyBtn.disabled = !canAct;
  els.discardBtn.disabled = !canAct;
}

function roleLabel(role) {
  const map = {
    user: "roleUser",
    assistant: "roleAssistant",
    tool: "roleTool",
    result: "roleResult",
    routing: "roleRouting",
    error: "roleError",
    system: "roleSystem",
  };
  return t(map[role] ?? "roleSystem");
}

function messageEl(message) {
  const el = document.createElement("div");
  el.className = `msg ${message.role}`;
  const who = document.createElement("div");
  who.className = "who";
  who.textContent = roleLabel(message.role);
  const bubble = document.createElement("div");
  bubble.className = "bubble";
  bubble.textContent = message.meta ? `${message.text}\n${message.meta}` : message.text;
  el.append(who, bubble);
  return el;
}

function renderTranscript() {
  els.transcript.replaceChildren();
  const project = currentProject();
  if (!project) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = t("emptySelect");
    els.transcript.appendChild(empty);
    return;
  }
  const messages = state.snapshot?.project?.messages ?? [];
  if (messages.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = t("emptyDescribe");
    els.transcript.appendChild(empty);
  }
  for (const message of messages) els.transcript.appendChild(messageEl(message));
  if (state.running) {
    const typing = document.createElement("div");
    typing.className = "msg assistant typing";
    const bubble = document.createElement("div");
    bubble.className = "bubble";
    bubble.textContent = t("thinking");
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
    els.diffView.innerHTML = `<span class="empty">${t("noDiff")}</span>`;
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
    els.tabSession.innerHTML = `<span class="empty">${t("noSession")}</span>`;
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
    if (snap.project?.activeAgent) state.routing = { agent: snap.project.activeAgent, label: "" };
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
      state.credentials = cred;
      renderCredentials();
    })
    .catch(() => undefined);
}

function renderCredentials() {
  const cred = state.credentials;
  if (!cred) return;
  els.credSummary.textContent = `claude: ${cred.claude?.mode ?? "?"}  ·  codex: ${cred.codex?.mode ?? "?"}  ·  jev: ${cred.typesafe?.configured ? "ok" : "off"}`;
  if (els.tsHint) els.tsHint.textContent = cred.typesafe?.configured ? `atual: ${cred.typesafe.hint}` : "";
  if (els.claudeMode) {
    els.claudeMode.textContent = cred.claude.mode;
    els.claudeMode.className = `mode-chip ${cred.claude.mode}`;
  }
  if (els.claudeAccount) {
    els.claudeAccount.textContent = cred.claude.mode === "subscription" ? cred.claude.detail : "";
  }
  if (els.codexMode) {
    els.codexMode.textContent = cred.codex.mode;
    els.codexMode.className = `mode-chip ${cred.codex.mode}`;
  }
  if (els.codexAccount) {
    els.codexAccount.textContent = [cred.codex.account, cred.codex.plan && `(${cred.codex.plan})`].filter(Boolean).join(" ");
  }
  if (els.credStatus) {
    els.credStatus.innerHTML = [
      `<div class="cred-line"><span>TypeSafe</span><b>${escapeHtml(cred.typesafe?.configured ? cred.typesafe.hint : "—")}</b></div>`,
      `<div class="cred-line"><span>Claude</span><b>${escapeHtml(cred.claude.mode)}</b></div>`,
      `<div class="cred-line"><span>Codex</span><b>${escapeHtml(cred.codex.mode)}</b></div>`,
    ].join("");
  }
  const warn = !cred.typesafe?.configured || cred.claude.mode === "none" || cred.codex.mode === "none";
  if (els.settingsDot) els.settingsDot.className = `cred-dot ${warn ? "warn" : "ok"}`;
  if (els.inputComplexModel && !els.inputComplexModel.value) els.inputComplexModel.value = cred.complexModel || "";
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
  loading.textContent = t("browserLoading");
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
      err.textContent = `${t("browserNoAccess")}${data.error}`;
      els.browserList.appendChild(err);
    }
    if (data.entries.length === 0 && !data.error) {
      const empty = document.createElement("div");
      empty.className = "browser-empty";
      empty.textContent = t("browserEmpty");
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
    els.npStatus.textContent = data.isGitRepo ? t("gitValid") : t("gitInvalid");
    els.npStatus.className = `np-status ${data.isGitRepo ? "ok" : "err"}`;
  } catch {
    els.npStatus.textContent = t("validateFail");
    els.npStatus.className = "np-status err";
  }
}

async function createProject() {
  const rootPath = els.npPath.value.trim();
  if (!rootPath) {
    els.npStatus.textContent = t("needFolder");
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
      els.npStatus.textContent = data.error || t("createError");
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

function openSettings() {
  renderCredentials();
  els.settingsMsg.textContent = "";
  els.settingsMsg.className = "settings-msg";
  els.settingsModal.classList.remove("hidden");
}
function closeSettings() {
  els.settingsModal.classList.add("hidden");
}

function saveSettings() {
  const values = {};
  const typesafe = els.inputTypesafe.value.trim();
  if (typesafe) values.TYPESAFE_API_KEY = typesafe;
  if (els.clearAnthropic.checked) values.ANTHROPIC_API_KEY = "";
  else if (els.inputAnthropic.value.trim()) values.ANTHROPIC_API_KEY = els.inputAnthropic.value.trim();
  if (els.clearOpenai.checked) values.OPENAI_API_KEY = "";
  else if (els.inputOpenai.value.trim()) values.OPENAI_API_KEY = els.inputOpenai.value.trim();
  const model = els.inputComplexModel.value.trim();
  if (model) values.DEFAULT_COMPLEX_MODEL = model;
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    els.settingsMsg.textContent = t("noConnection");
    els.settingsMsg.className = "settings-msg err";
    return;
  }
  socket.send(JSON.stringify({ type: "settings", values }));
}

function onSettingsAck(msg) {
  if (msg.ok) {
    els.settingsMsg.textContent = t("saved");
    els.settingsMsg.className = "settings-msg ok";
    els.inputTypesafe.value = "";
    els.inputAnthropic.value = "";
    els.inputOpenai.value = "";
    els.clearAnthropic.checked = false;
    els.clearOpenai.checked = false;
    if (msg.data) {
      state.credentials = msg.data;
      renderCredentials();
    }
  } else {
    els.settingsMsg.textContent = msg.error || t("saveError");
    els.settingsMsg.className = "settings-msg err";
  }
}

function pushAccountLog(cls, text) {
  const line = document.createElement("div");
  line.className = cls;
  line.textContent = text;
  els.accountLog.appendChild(line);
  els.accountLog.scrollTop = els.accountLog.scrollHeight;
}

function setAccountButtonsBusy(provider, busy) {
  document.querySelectorAll(`.small-btn[data-provider="${provider}"]`).forEach((btn) => {
    btn.disabled = busy;
  });
}

function runAccountAction(provider, action) {
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    pushAccountLog("err", t("noConnection"));
    return;
  }
  setAccountButtonsBusy(provider, true);
  pushAccountLog("sys", `> ${provider} ${action}...`);
  socket.send(JSON.stringify({ type: "account", provider, action }));
}

function handleMessage(msg) {
  switch (msg.type) {
    case "projects":
      state.projects = msg.data;
      renderSidebar();
      if (!state.currentId && state.projects.length > 0) selectProject(state.projects[0].id);
      break;
    case "credentials":
      state.credentials = msg.data;
      renderCredentials();
      break;
    case "settings:ack":
      onSettingsAck(msg);
      break;
    case "account:start":
      pushAccountLog("sys", `# ${msg.provider} ${msg.action}...`);
      break;
    case "account:output":
      pushAccountLog(msg.stream === "stderr" ? "err" : msg.stream === "status" ? "sys" : "", msg.line);
      break;
    case "account:done":
      setAccountButtonsBusy(msg.data?.provider, false);
      pushAccountLog(msg.data?.ok ? "ok" : "err", `${msg.data?.provider} ${msg.data?.action}: ${msg.data?.ok ? "ok" : msg.data?.message}`);
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
      state.snapshot.project.messages.push({ id: String(Date.now()), at: Date.now(), role: "error", text: msg.error });
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

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// listeners
els.newProjectBtn.addEventListener("click", openModal);
els.modalClose.addEventListener("click", closeModal);
els.npBrowse.addEventListener("click", browseFolder);
els.npPath.addEventListener("input", validatePath);
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

els.settingsBtn.addEventListener("click", openSettings);
els.settingsClose.addEventListener("click", closeSettings);
els.settingsSave.addEventListener("click", saveSettings);
els.settingsModal.addEventListener("click", (event) => {
  if (event.target === els.settingsModal) closeSettings();
});
document.querySelectorAll(".small-btn[data-provider]").forEach((btn) => {
  btn.addEventListener("click", () => runAccountAction(btn.dataset.provider, btn.dataset.action));
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
els.stopBtn.addEventListener("click", () => {
  if (state.currentId) socket?.send(JSON.stringify({ type: "chat:stop", projectId: state.currentId }));
});

els.langToggle.addEventListener("click", () => setLang(lang === "pt" ? "en" : "pt"));
els.themeToggle.addEventListener("click", () => {
  const current = document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark";
  const next = current === "dark" ? "light" : "dark";
  localStorage.setItem(THEME_KEY, next);
  applyTheme(next);
});

document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    const name = tab.dataset.tab;
    document.querySelectorAll(".tab").forEach((t2) => t2.classList.toggle("active", t2 === tab));
    document.querySelectorAll(".tab-panel").forEach((p) => p.classList.toggle("active", p.id === `tab-${name}`));
  });
});

els.transcript.addEventListener("scroll", () => {
  state.autoscroll = Math.abs(els.transcript.scrollHeight - els.transcript.scrollTop - els.transcript.clientHeight) < 40;
});

// init
lang = localStorage.getItem(LANG_KEY) === "en" ? "en" : "pt";
initTheme();
applyStatic();
loadProjects();
loadCredentials();
render();
connect();
