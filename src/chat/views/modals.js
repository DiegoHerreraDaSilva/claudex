import { clear, el, escapeHtml } from "../lib/dom.js";
import { t } from "../lib/i18n.js";
import * as api from "../lib/api.js";
import { isConnected, send as socketSend } from "../lib/socket.js";
import { state, patch } from "../lib/store.js";

const ids = (id) => document.getElementById(id);
const browser = { path: "", parent: null };

export function initModals(actions) {
  const modal = ids("modal");
  const browserModal = ids("browser-modal");
  const settingsModal = ids("settings-modal");

  const npName = ids("np-name");
  const npPath = ids("np-path");
  const npStatus = ids("np-status");
  const npCreate = ids("np-create");

  ids("new-project-btn").addEventListener("click", openNewProject);
  ids("modal-close").addEventListener("click", () => modal.classList.add("hidden"));
  modal.addEventListener("click", (event) => {
    if (event.target === modal) modal.classList.add("hidden");
  });
  ids("np-browse").addEventListener("click", () => browseFolder(npPath, npName, validate));
  npPath.addEventListener("input", () => validate(npPath, npStatus));
  npCreate.addEventListener("click", () => createProject(npName, npPath, npStatus, npCreate, modal, actions));

  ids("browser-close").addEventListener("click", () => browserModal.classList.add("hidden"));
  ids("browser-up").addEventListener("click", () => loadBrowser(browser.parent || ""));
  ids("browser-select").addEventListener("click", () => {
    if (browser.path) applyPickedFolder(browser.path, npPath, npName, validate);
    browserModal.classList.add("hidden");
  });
  browserModal.addEventListener("click", (event) => {
    if (event.target === browserModal) browserModal.classList.add("hidden");
  });

  const settings = initSettings(settingsModal);
  return { openNewProject, openSettings: settings.open, ...settings.handlers };
}

function openNewProject() {
  const modal = ids("modal");
  ids("np-name").value = "";
  ids("np-path").value = "";
  const status = ids("np-status");
  status.textContent = "";
  status.className = "np-status";
  modal.classList.remove("hidden");
}

async function browseFolder(npPath, npName, validate) {
  try {
    if (window.claudexApp?.pickFolder) {
      const folder = await window.claudexApp.pickFolder();
      if (folder) applyPickedFolder(folder, npPath, npName, validate);
      return;
    }
    openBrowser(npPath.value.trim());
  } catch {
    /* ignore */
  }
}

function applyPickedFolder(folder, npPath, npName, validate) {
  npPath.value = folder;
  if (!npName.value) npName.value = folder.replace(/[\\/]+$/, "").split(/[\\/]/).pop();
  validate(npPath, ids("np-status"));
}

async function openBrowser(startPath) {
  ids("browser-modal").classList.remove("hidden");
  await loadBrowser(startPath || "");
}

async function loadBrowser(target) {
  const listEl = ids("browser-list");
  const pathEl = ids("browser-path");
  pathEl.textContent = target || "—";
  clear(listEl);
  listEl.appendChild(el("div", { class: "browser-empty", text: t("browserLoading") }));
  try {
    const data = await api.listDirectory(target || "");
    browser.path = data.path || target || "";
    browser.parent = data.parent ?? null;
    pathEl.textContent = data.path || "—";
    clear(listEl);
    if (data.error) {
      listEl.appendChild(el("div", { class: "browser-empty", text: `${t("browserNoAccess")}${data.error}` }));
    }
    if ((data.entries?.length ?? 0) === 0 && !data.error) {
      listEl.appendChild(el("div", { class: "browser-empty", text: t("browserEmpty") }));
    }
    for (const entry of data.entries ?? []) {
      const row = el("div", { class: "browser-row", onclick: () => loadBrowser(entry.path) });
      row.append(
        el("span", { class: "ico", text: "▸" }),
        el("span", { class: "nm", text: entry.name }),
      );
      if (entry.isGitRepo) row.appendChild(el("span", { class: "git", text: "git" }));
      listEl.appendChild(row);
    }
    ids("browser-up").disabled = !data.parent;
  } catch (err) {
    clear(listEl);
    listEl.appendChild(el("div", { class: "browser-empty", text: String(err) }));
  }
}

async function validate(npPath, npStatus) {
  const rootPath = npPath.value.trim();
  if (!rootPath) {
    npStatus.textContent = "";
    npStatus.className = "np-status";
    return;
  }
  try {
    const data = await api.validatePath(rootPath);
    npStatus.textContent = data.isGitRepo ? t("gitValid") : t("gitInvalid");
    npStatus.className = `np-status ${data.isGitRepo ? "ok" : "err"}`;
  } catch {
    npStatus.textContent = t("validateFail");
    npStatus.className = "np-status err";
  }
}

async function createProject(npName, npPath, npStatus, npCreate, modal, actions) {
  const rootPath = npPath.value.trim();
  if (!rootPath) {
    npStatus.textContent = t("needFolder");
    npStatus.className = "np-status err";
    return;
  }
  npCreate.disabled = true;
  try {
    const { ok, data } = await api.createProject(npName.value.trim(), rootPath);
    if (!ok) {
      npStatus.textContent = data.error || t("createError");
      npStatus.className = "np-status err";
      return;
    }
    modal.classList.add("hidden");
    await actions.reloadProjects();
    actions.openWorkspace(data.id, data.conversations?.[0]?.id);
  } catch (err) {
    npStatus.textContent = String(err);
    npStatus.className = "np-status err";
  } finally {
    npCreate.disabled = false;
  }
}

function initSettings(settingsModal) {
  const claudeMode = ids("claude-mode");
  const claudeAccount = ids("claude-account");
  const codexMode = ids("codex-mode");
  const codexAccount = ids("codex-account");
  const credSummary = ids("cred-summary");
  const tsHint = ids("ts-hint");
  const settingsMsg = ids("settings-msg");
  const accountLog = ids("account-log");
  const usageStatus = ids("usage-status");

  ids("settings-btn").addEventListener("click", open);
  ids("settings-close").addEventListener("click", () => settingsModal.classList.add("hidden"));
  settingsModal.addEventListener("click", (event) => {
    if (event.target === settingsModal) settingsModal.classList.add("hidden");
  });
  ids("settings-save").addEventListener("click", save);
  ids("usage-refresh").addEventListener("click", loadUsage);
  document.querySelectorAll(".small-btn[data-provider]").forEach((btn) => {
    btn.addEventListener("click", () => runAccountAction(btn.dataset.provider, btn.dataset.action));
  });

  function open() {
    renderCredentials();
    settingsMsg.textContent = "";
    settingsMsg.className = "settings-msg";
    settingsModal.classList.remove("hidden");
    void loadUsage();
  }

  function renderCredentials() {
    const cred = state.credentials;
    if (!cred) return;
    if (credSummary) {
      credSummary.textContent = `claude: ${cred.claude?.mode ?? "?"} · codex: ${cred.codex?.mode ?? "?"} · jev: ${cred.typesafe?.configured ? "ok" : "off"}`;
    }
    if (tsHint) tsHint.textContent = cred.typesafe?.configured ? `atual: ${cred.typesafe.hint}` : "";
    if (claudeMode) {
      claudeMode.textContent = cred.claude.mode;
      claudeMode.className = `mode-chip ${cred.claude.mode}`;
    }
    if (claudeAccount) claudeAccount.textContent = cred.claude.mode === "subscription" ? cred.claude.detail : "";
    if (codexMode) {
      codexMode.textContent = cred.codex.mode;
      codexMode.className = `mode-chip ${cred.codex.mode}`;
    }
    if (codexAccount) {
      codexAccount.textContent = [cred.codex.account, cred.codex.plan && `(${cred.codex.plan})`].filter(Boolean).join(" ");
    }
    const complex = ids("input-complex-model");
    if (complex && !complex.value) complex.value = cred.complexModel || "";
  }

  async function loadUsage() {
    if (!usageStatus) return;
    clear(usageStatus);
    usageStatus.appendChild(el("span", { class: "empty", text: "…" }));
    try {
      const data = await api.getUsage();
      patch({ usage: data });
      renderUsage(data);
    } catch {
      clear(usageStatus);
      usageStatus.appendChild(el("span", { class: "empty", text: "—" }));
    }
  }

  function renderUsage(data) {
    const parts = [];
    const c = data.claude;
    if (c) {
      parts.push(
        `<div class="cred-line"><span>Claude ${escapeHtml(c.subscriptionType || "")}</span><b>${escapeHtml(t("planLabel"))}</b></div>`,
        usageBar("5h", c.fiveHour?.utilization ?? null),
        usageBar("7d", c.sevenDay?.utilization ?? null),
      );
    } else {
      parts.push(`<div class="cred-line"><span>Claude</span><b>${escapeHtml(t("unavailable"))}</b></div>`);
    }
    const codex = data.codex || {};
    parts.push(
      `<div class="cred-line"><span>Codex ${escapeHtml(codex.account || "")} ${codex.plan ? `(${escapeHtml(codex.plan)})` : ""}</span><b>${escapeHtml(codex.mode || "")}</b></div>`,
    );
    const tk = data.tokens || {};
    parts.push(
      `<div class="cred-line"><span>${escapeHtml(t("tokensLabel"))}</span><b>${tk.inputTokens ?? 0} in / ${tk.outputTokens ?? 0} out (${tk.runs ?? 0})</b></div>`,
    );
    parts.push(
      `<div class="cred-line"><span>${escapeHtml(t("costShort"))}</span><b>$${Number(data.costUsd ?? 0).toFixed(4)}</b></div>`,
    );
    usageStatus.innerHTML = parts.join("");
  }

  function usageBar(label, pct) {
    const value = typeof pct === "number" ? Math.max(0, Math.min(100, pct)) : 0;
    const text = typeof pct === "number" ? `${pct.toFixed(0)}%` : "—";
    return `<div class="usage-row"><span>${escapeHtml(label)}</span><b>${text}</b></div><div class="bar"><i style="width:${value}%"></i></div>`;
  }

  function save() {
    const values = {};
    const typesafe = ids("input-typesafe").value.trim();
    if (typesafe) values.TYPESAFE_API_KEY = typesafe;
    if (ids("clear-anthropic").checked) values.ANTHROPIC_API_KEY = "";
    else if (ids("input-anthropic").value.trim()) values.ANTHROPIC_API_KEY = ids("input-anthropic").value.trim();
    if (ids("clear-openai").checked) values.OPENAI_API_KEY = "";
    else if (ids("input-openai").value.trim()) values.OPENAI_API_KEY = ids("input-openai").value.trim();
    const model = ids("input-complex-model").value.trim();
    if (model) values.DEFAULT_COMPLEX_MODEL = model;
    if (!isConnected()) {
      settingsMsg.textContent = t("noConnection");
      settingsMsg.className = "settings-msg err";
      return;
    }
    socketSend({ type: "settings", values });
  }

  function handleSettingsAck(msg) {
    if (msg.ok) {
      settingsMsg.textContent = t("saved");
      settingsMsg.className = "settings-msg ok";
      ids("input-typesafe").value = "";
      ids("input-anthropic").value = "";
      ids("input-openai").value = "";
      ids("clear-anthropic").checked = false;
      ids("clear-openai").checked = false;
      if (msg.data) {
        patch({ credentials: msg.data });
        renderCredentials();
      }
    } else {
      settingsMsg.textContent = msg.error || t("saveError");
      settingsMsg.className = "settings-msg err";
    }
  }

  function pushAccountLog(cls, text) {
    const line = el("div", { class: cls, text });
    accountLog.appendChild(line);
    accountLog.scrollTop = accountLog.scrollHeight;
  }

  function setAccountButtonsBusy(provider, busy) {
    document.querySelectorAll(`.small-btn[data-provider="${provider}"]`).forEach((btn) => {
      btn.disabled = busy;
    });
  }

  function runAccountAction(provider, action) {
    if (!isConnected()) {
      pushAccountLog("err", t("noConnection"));
      return;
    }
    setAccountButtonsBusy(provider, true);
    pushAccountLog("sys", `> ${provider} ${action}...`);
    socketSend({ type: "account", provider, action });
  }

  function renderUpdateStatus(data) {
    const updateStatus = ids("update-status");
    if (!data || !updateStatus) return;
    const status = data.status;
    let text = "";
    let cls = "settings-msg";
    if (status === "checking") text = t("updateChecking");
    else if (status === "available") text = t("updateAvailable", { version: data.version ?? "" });
    else if (status === "downloading")
      text = `${t("updateAvailable", { version: data.version ?? "" })} ${data.percent ?? 0}%`;
    else if (status === "none") {
      text = t("updateNone");
      cls = "settings-msg ok";
    } else if (status === "downloaded") {
      text = t("updateDownloaded", { version: data.version ?? "" });
      cls = "settings-msg ok";
    } else if (status === "error") {
      text = `${t("updateError")}: ${data.message ?? ""}`;
      cls = "settings-msg err";
    } else if (status === "dev") text = t("updateDev");
    updateStatus.textContent = text;
    updateStatus.className = cls;
  }

  function setupUpdates() {
    const field = ids("update-field");
    if (!window.claudexApp?.checkForUpdates || !field) return;
    field.style.display = "";
    window.claudexApp.onUpdateStatus((data) => renderUpdateStatus(data));
    ids("check-updates").addEventListener("click", async () => {
      const updateStatus = ids("update-status");
      updateStatus.textContent = t("updateChecking");
      updateStatus.className = "settings-msg";
      const result = await window.claudexApp.checkForUpdates();
      if (result?.status === "dev") renderUpdateStatus({ status: "dev" });
      else if (result?.status === "error") renderUpdateStatus(result);
    });
  }

  return {
    open,
    handlers: {
      renderCredentials,
      loadUsage,
      handleSettingsAck,
      renderUpdateStatus,
      setupUpdates,
      onAccountStart: (msg) => pushAccountLog("sys", `# ${msg.provider} ${msg.action}...`),
      onAccountOutput: (msg) =>
        pushAccountLog(msg.stream === "stderr" ? "err" : msg.stream === "status" ? "sys" : "", msg.line),
      onAccountDone: (msg) => {
        setAccountButtonsBusy(msg.data?.provider, false);
        pushAccountLog(
          msg.data?.ok ? "ok" : "err",
          `${msg.data?.provider} ${msg.data?.action}: ${msg.data?.ok ? "ok" : msg.data?.message}`,
        );
      },
    },
  };
}
