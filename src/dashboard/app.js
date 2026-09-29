const state = {
  tasks: [],
  selectedId: null,
  autoscroll: true,
  parallelized: false,
  activeTab: "sessions",
  credentials: null,
};

const els = {
  taskList: document.getElementById("task-list"),
  fleetCount: document.getElementById("fleet-count"),
  fleetMode: document.getElementById("fleet-mode"),
  terminal: document.getElementById("terminal"),
  agentPill: document.getElementById("agent-pill"),
  mTurn: document.getElementById("m-turn"),
  mIn: document.getElementById("m-in"),
  mOut: document.getElementById("m-out"),
  mCache: document.getElementById("m-cache"),
  mStatus: document.getElementById("m-status"),
  tModel: document.getElementById("t-model"),
  tTurn: document.getElementById("t-turn"),
  tTokens: document.getElementById("t-tokens"),
  tLatency: document.getElementById("t-latency"),
  tStatus: document.getElementById("t-status"),
  diffView: document.getElementById("diff-view"),
  tabSessions: document.getElementById("tab-sessions"),
  tabStatus: document.getElementById("tab-status"),
  input: document.getElementById("command-input"),
  settingsBtn: document.getElementById("settings-btn"),
  settingsDot: document.getElementById("settings-dot"),
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
  themeToggle: document.getElementById("theme-toggle"),
};

const THEME_KEY = "claudex-theme";

function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  els.themeToggle.textContent = theme === "dark" ? "light" : "dark";
}

function initTheme() {
  const saved = localStorage.getItem(THEME_KEY);
  const prefersLight = window.matchMedia("(prefers-color-scheme: light)").matches;
  applyTheme(saved || (prefersLight ? "light" : "dark"));
}

const ACTIVE_STATUSES = ["running", "deciding", "reviewing"];

function selectedTask() {
  return state.tasks.find((t) => t.taskId === state.selectedId) || null;
}

function statusClass(status) {
  if (status === "running" || status === "reviewing" || status === "deciding") return "running";
  if (status === "failed") return "error";
  if (status === "completed" || status === "merged") return "done";
  if (status === "pending") return "awaiting";
  return "idle";
}

function upsertTask(taskId, patch) {
  let task = state.tasks.find((t) => t.taskId === taskId);
  if (!task) {
    task = {
      taskId,
      description: "",
      agent: "",
      agentKind: "claude",
      model: "",
      complexity: "",
      status: "pending",
      messages: [],
      usage: { inputTokens: 0, outputTokens: 0 },
      turns: 0,
      filesTouched: [],
    };
    state.tasks.push(task);
  }
  Object.assign(task, patch);
  return task;
}

function applyEvent(event, data) {
  switch (event) {
    case "fleet:updated":
      state.tasks = data.tasks;
      state.parallelized = data.parallelized;
      if (!state.selectedId && state.tasks.length) state.selectedId = state.tasks[0].taskId;
      if (state.selectedId && !state.tasks.some((t) => t.taskId === state.selectedId)) {
        state.selectedId = state.tasks.length ? state.tasks[0].taskId : null;
      }
      break;
    case "task:created":
      upsertTask(data.taskId, { description: data.description, status: "pending" });
      break;
    case "task:decided":
      upsertTask(data.taskId, {
        agent: data.agent,
        model: data.model,
        complexity: data.choice,
        agentKind: data.agent.startsWith("codex") ? "codex" : "claude",
      });
      break;
    case "task:started":
      upsertTask(data.taskId, { status: "running", agent: data.agent, worktree: data.worktree });
      break;
    case "task:message": {
      const task = upsertTask(data.taskId, {});
      task.messages = task.messages || [];
      task.messages.push(data.message);
      if (task.messages.length > 500) task.messages.splice(0, 100);
      break;
    }
    case "task:completed":
      upsertTask(data.taskId, { status: "completed", diff: data.diff, usage: data.usage });
      break;
    case "task:failed":
      upsertTask(data.taskId, { status: "failed", error: data.error });
      break;
    default:
      return;
  }
  render();
}

function render() {
  renderSidebar();
  renderCenter();
  renderSessions();
  renderDiff();
  renderStatusTab();
}

function renderSidebar() {
  els.fleetCount.textContent = `${state.tasks.length} task${state.tasks.length === 1 ? "" : "s"}`;
  const anyActive = state.tasks.some((t) => ACTIVE_STATUSES.includes(t.status));
  els.fleetMode.textContent = state.parallelized ? "parallel" : anyActive ? "sequential" : "idle";
  els.taskList.innerHTML = "";

  for (const task of state.tasks) {
    const div = document.createElement("div");
    div.className = "task" + (task.taskId === state.selectedId ? " selected" : "");
    div.onclick = () => {
      state.selectedId = task.taskId;
      render();
    };

    const maxTurns = 30;
    const ctxPct = Math.min(100, Math.round(((task.turns || 0) / maxTurns) * 100));
    const totalTokens = (task.usage?.inputTokens || 0) + (task.usage?.outputTokens || 0);
    const cachePct = totalTokens > 0 ? Math.min(100, Math.round(((task.usage?.inputTokens || 0) / totalTokens) * 0)) : 0;
    const files = (task.filesTouched || []).slice(0, 4);

    div.innerHTML = `
      <div class="task-head">
        <span class="dot ${statusClass(task.status)}"></span>
        <span class="task-name">${escapeHtml(task.taskId.slice(0, 8))} ${escapeHtml(task.description || "")}</span>
      </div>
      <div class="task-head" style="margin-top:6px">
        <span class="badge ${task.agentKind || "claude"}">${escapeHtml(task.agent || "unassigned")}</span>
        <span class="badge">${escapeHtml(task.status)}</span>
      </div>
      <div class="bars">
        <div class="bar ctx"><i style="width:${ctxPct}%"></i></div>
        <div class="bar cache"><i style="width:${cachePct}%"></i></div>
      </div>
      <div class="files">${files.map((f) => `<span class="file-chip">${escapeHtml(f)}</span>`).join("")}</div>
    `;
    els.taskList.appendChild(div);
  }
}

function renderCenter() {
  const task = selectedTask();
  if (!task) {
    els.agentPill.textContent = "no agent";
    els.agentPill.className = "pill";
    els.mTurn.textContent = "0";
    els.mIn.textContent = "0";
    els.mOut.textContent = "0";
    els.mCache.textContent = "0%";
    els.mStatus.textContent = "idle";
    els.terminal.innerHTML = '<div class="line system"><span class="ln">1</span><span class="content empty">Waiting for tasks. Run `claudex run "..."`.</span></div>';
    return;
  }

  els.agentPill.textContent = task.agent || "unassigned";
  els.agentPill.className = "pill" + (task.agentKind === "codex" ? " codex" : "");
  els.mTurn.textContent = String(task.turns || 0);
  els.mIn.textContent = String(task.usage?.inputTokens || 0);
  els.mOut.textContent = String(task.usage?.outputTokens || 0);
  els.mCache.textContent = "0%";
  els.mStatus.textContent = task.status;

  const wasAtBottom = Math.abs(els.terminal.scrollHeight - els.terminal.scrollTop - els.terminal.clientHeight) < 40;
  const messages = task.messages || [];
  let html = "";
  messages.forEach((msg, i) => {
    const lineNo = i + 1;
    if (msg.role === "tool") {
      html += `<div class="line tool"><span class="tool-name">${escapeHtml(msg.text)}</span>${msg.meta ? `<span class="tool-meta">${escapeHtml(msg.meta)}</span>` : ""}</div>`;
    } else {
      const spinner = ACTIVE_STATUSES.includes(task.status) && i === messages.length - 1 && msg.role === "assistant"
        ? '<span class="spinner">*</span> '
        : "";
      html += `<div class="line ${msg.role}"><span class="ln">${lineNo}</span><span class="content">${spinner}${escapeHtml(msg.text)}</span></div>`;
    }
  });
  if (messages.length === 0) {
    html = '<div class="line system"><span class="ln">1</span><span class="content empty">No output yet.</span></div>';
  }
  els.terminal.innerHTML = html;

  if (state.autoscroll || wasAtBottom) els.terminal.scrollTop = els.terminal.scrollHeight;

  const duration = task.startedAt ? ((task.completedAt || Date.now()) - task.startedAt) / 1000 : 0;
  els.tModel.textContent = `model ${task.model || "-"}`;
  els.tTurn.textContent = `turn ${task.turns || 0}`;
  els.tTokens.textContent = `tokens ${task.usage?.inputTokens || 0}/${task.usage?.outputTokens || 0}`;
  els.tLatency.textContent = `latency ${duration.toFixed(1)}s`;
  els.tStatus.textContent = task.status;
}

function renderSessions() {
  if (state.tasks.length === 0) {
    els.tabSessions.innerHTML = '<span class="empty">No sessions.</span>';
    return;
  }
  els.tabSessions.innerHTML = state.tasks
    .map((task) => {
      const id = task.sessionId || task.threadId || "(pending)";
      const kind = task.sessionId ? "session_id" : "thread_id";
      const duration = task.startedAt ? ((task.completedAt || Date.now()) - task.startedAt) / 1000 : 0;
      return `
        <div class="session-card">
          <div class="id">${escapeHtml(task.taskId.slice(0, 8))} ${escapeHtml(task.agent || "")}</div>
          <div class="row"><span>${kind}</span><span>${escapeHtml(id)}</span></div>
          <div class="row"><span>status</span><span>${escapeHtml(task.status)}</span></div>
          <div class="row"><span>duration</span><span>${duration.toFixed(1)}s</span></div>
        </div>`;
    })
    .join("");
}

function renderDiff() {
  const task = selectedTask();
  if (!task || !task.diff) {
    els.diffView.innerHTML = '<span class="empty">No diff for the selected task.</span>';
    return;
  }
  els.diffView.innerHTML = escapeHtml(task.diff)
    .split("\n")
    .map((line) => {
      if (line.startsWith("+") && !line.startsWith("+++")) return `<span class="add">${line}</span>`;
      if (line.startsWith("-") && !line.startsWith("---")) return `<span style="color:var(--err)">${line}</span>`;
      return line;
    })
    .join("\n");
}

function renderStatusTab() {
  const tasks = state.tasks;
  const totalIn = tasks.reduce((sum, t) => sum + (t.usage?.inputTokens || 0), 0);
  const totalOut = tasks.reduce((sum, t) => sum + (t.usage?.outputTokens || 0), 0);
  const byAgent = {};
  for (const t of tasks) byAgent[t.agent || "unassigned"] = (byAgent[t.agent || "unassigned"] || 0) + 1;
  const rows = [
    ["tasks", String(tasks.length)],
    ["active", String(tasks.filter((t) => ACTIVE_STATUSES.includes(t.status)).length)],
    ["completed", String(tasks.filter((t) => t.status === "completed" || t.status === "merged").length)],
    ["failed", String(tasks.filter((t) => t.status === "failed").length)],
    ["mode", state.parallelized ? "parallel" : "sequential"],
    ["tokens in", String(totalIn)],
    ["tokens out", String(totalOut)],
  ];
  els.tabStatus.innerHTML =
    '<div class="status-grid">' +
    rows.map(([k, v]) => `<div class="status-row"><span>${k}</span><b>${escapeHtml(v)}</b></div>`).join("") +
    "</div>" +
    Object.entries(byAgent)
      .map(([agent, count]) => `<div class="status-row" style="margin-top:8px"><span>${escapeHtml(agent)}</span><b>${count}</b></div>`)
      .join("");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

let socket = null;

function connect() {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  socket = new WebSocket(`${proto}://${location.host}`);

  socket.onmessage = (event) => {
    let msg;
    try {
      msg = JSON.parse(event.data);
    } catch {
      return;
    }
    if (msg.type === "snapshot") {
      state.tasks = msg.data.tasks || [];
      state.parallelized = !!msg.data.parallelized;
      if (!state.selectedId && state.tasks.length) state.selectedId = state.tasks[0].taskId;
      render();
    } else if (msg.type === "event") {
      applyEvent(msg.event, msg.data);
    } else if (msg.type === "credentials") {
      state.credentials = msg.data;
      renderCredentials();
    } else if (msg.type === "settings:ack") {
      onSettingsAck(msg);
    } else if (msg.type === "account:start") {
      pushAccountLog("sys", `# ${msg.provider} ${msg.action} started`);
    } else if (msg.type === "account:output") {
      onAccountOutput(msg);
    } else if (msg.type === "account:done") {
      onAccountDone(msg);
    }
  };

  socket.onclose = () => {
    els.fleetMode.textContent = "offline";
    setTimeout(connect, 1500);
  };
}

function sendCommand(action, taskId) {
  if (!socket || socket.readyState !== WebSocket.OPEN) return;
  socket.send(JSON.stringify({ type: "command", action, taskId }));
}

function renderCredentials() {
  const cred = state.credentials;
  if (!cred) return;

  els.tsHint.textContent = cred.typesafe.configured
    ? `atual: ${cred.typesafe.hint}`
    : "nao configurada";
  els.claudeMode.textContent = cred.claude.mode;
  els.claudeMode.className = `mode-chip ${cred.claude.mode}`;
  els.claudeAccount.textContent = cred.claude.mode === "subscription" ? cred.claude.detail : "";
  els.codexMode.textContent = cred.codex.mode;
  els.codexMode.className = `mode-chip ${cred.codex.mode}`;
  els.codexAccount.textContent = [cred.codex.account, cred.codex.plan && `(${cred.codex.plan})`]
    .filter(Boolean)
    .join(" ");

  els.credStatus.innerHTML = [
    `<div class="cred-line"><span>TypeSafe</span><b>${cred.typesafe.configured ? escapeHtml(cred.typesafe.hint) : "nao configurada"}</b></div>`,
    `<div class="cred-line"><span>Claude</span><b>${escapeHtml(cred.claude.mode)}</b></div>`,
    `<div class="cred-line"><span>Codex</span><b>${escapeHtml(cred.codex.mode)}</b></div>`,
    `<div class="cred-line"><span>endpoint</span><b>${escapeHtml(cred.typesafe.baseUrl)}</b></div>`,
  ].join("");

  const warn = !cred.typesafe.configured || cred.claude.mode === "none" || cred.codex.mode === "none";
  els.settingsDot.className = `cred-dot ${warn ? "warn" : "ok"}`;

  if (!els.inputComplexModel.value) els.inputComplexModel.value = cred.complexModel || "";
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
    els.settingsMsg.textContent = "sem conexao com o servidor";
    els.settingsMsg.className = "settings-msg err";
    return;
  }
  socket.send(JSON.stringify({ type: "settings", values }));
}

function onSettingsAck(msg) {
  if (msg.ok) {
    els.settingsMsg.textContent = "salvo em .env e aplicado";
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
    els.settingsMsg.textContent = msg.error || "erro ao salvar";
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
  document
    .querySelectorAll(`.small-btn[data-provider="${provider}"]`)
    .forEach((btn) => (btn.disabled = busy));
}

function runAccountAction(provider, action) {
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    pushAccountLog("err", "sem conexao com o servidor");
    return;
  }
  setAccountButtonsBusy(provider, true);
  pushAccountLog("sys", `> ${provider} ${action}...`);
  socket.send(JSON.stringify({ type: "account", provider, action }));
}

function onAccountOutput(msg) {
  const cls = msg.stream === "stderr" ? "err" : msg.stream === "status" ? "sys" : "";
  pushAccountLog(cls, msg.line);
}

function onAccountDone(msg) {
  const data = msg.data || {};
  setAccountButtonsBusy(data.provider, false);
  pushAccountLog(data.ok ? "ok" : "err", `${data.provider} ${data.action}: ${data.ok ? "ok" : data.message}`);
}

els.input.addEventListener("keydown", (event) => {
  if (event.key !== "Enter") return;
  event.preventDefault();
  const value = els.input.value.trim();
  els.input.value = "";
  if (!value) return;
  const [action, taskId] = value.split(/\s+/);
  if (action === "pause" || action === "resume") sendCommand(action);
  else if (action === "kill" && taskId) sendCommand("kill", taskId);
});

for (const tab of document.querySelectorAll(".tab")) {
  tab.addEventListener("click", () => {
    const name = tab.dataset.tab;
    state.activeTab = name;
    document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t === tab));
    document.querySelectorAll(".tab-panel").forEach((p) => p.classList.toggle("active", p.id === `tab-${name}`));
  });
}

els.settingsBtn.addEventListener("click", openSettings);
els.settingsClose.addEventListener("click", closeSettings);
els.settingsSave.addEventListener("click", saveSettings);
els.settingsModal.addEventListener("click", (event) => {
  if (event.target === els.settingsModal) closeSettings();
});
document.querySelectorAll(".small-btn[data-provider]").forEach((btn) => {
  btn.addEventListener("click", () => runAccountAction(btn.dataset.provider, btn.dataset.action));
});

els.themeToggle.addEventListener("click", () => {
  const current = document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark";
  const next = current === "dark" ? "light" : "dark";
  localStorage.setItem(THEME_KEY, next);
  applyTheme(next);
});

els.terminal.addEventListener("scroll", () => {
  state.autoscroll = Math.abs(els.terminal.scrollHeight - els.terminal.scrollTop - els.terminal.clientHeight) < 40;
});

initTheme();
render();
connect();
