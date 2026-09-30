import {
  setAutonomy,
  permissionNotice,
  permissionSnapshot,
  permissionMatrix,
} from "./components/autonomy.js";
import { renderTerminal, terminalEvent } from "./views/terminal.js";
import {
  ensureTools,
  refreshTools,
  renderProjectTools,
  renderContext,
  toolEvent,
} from "./views/projectTools.js";
import * as api from "./lib/api.js";
import { applyStatic, getLang, initLang, setLang, t, THEME_KEY } from "./lib/i18n.js";
import { initSocket, isConnected, send as socketSend } from "./lib/socket.js";
import {
  currentConversation,
  currentProject,
  notify,
  patch,
  state,
  subscribe,
} from "./lib/store.js";
import {
  initPalette,
  openPalette,
  paletteOpen,
  closePalette,
} from "./components/commandPalette.js";
import { confirmModal } from "./components/confirm.js";
import { previewModal } from "./components/previewModal.js";
import { toast } from "./components/toast.js";
import { initModals } from "./views/modals.js";
import { renderHome } from "./views/home.js";
import { renderInspector } from "./views/inspector.js";
import { renderMissionCenter } from "./views/missionCenter.js";
import { renderPlaceholder } from "./views/placeholder.js";
import { renderSidebar } from "./views/sidebar.js";
import { renderWorkspace } from "./views/workspace.js";

const sidebarRoot = document.getElementById("sidebar-nav");
const viewHost = document.getElementById("view-host");
let modals;

const actions = {
  setAutonomy: (mode) => setAutonomy(mode, loadProjects),
  selectProject,
  openWorkspace,
  selectConversation,
  newConversation,
  renameConversation,
  deleteConversation,
  deleteProject,
  setView,
  openSettings: () => modals?.openSettings(),
  startMission,
  send,
  stop,
  chatAction,
  comingSoon,
  fixAutomatically,
  reviewChanges: showDiff,
  openInspector,
  reloadMissionSummary: () => loadMissionSummary(state.currentConversationId),
  reloadProjects: loadProjects,
};

function renderAll() {
  ensureTools();
  if (state.currentConversationId) ensureMissionEvents();
  renderSidebar(sidebarRoot, actions);
  renderView();
  renderInspector();
  renderContext();
  renderTerminal();
  const matrixHost = document.getElementById("permission-matrix");
  if (matrixHost) matrixHost.replaceChildren(permissionMatrix());
}

function renderView() {
  if (state.view === "missions" || state.view === "workspace") ensureMissionEvents();
  switch (state.view) {
    case "home":
      renderHome(viewHost, actions);
      break;
    case "workspace":
      renderWorkspace(viewHost, actions);
      break;
    case "missions":
      renderMissionCenter(viewHost, actions);
      break;
    case "intelligence":
    case "worktrees":
    case "memory":
    case "history":
      renderProjectTools(viewHost, actions);
      break;
    case "agents":
      renderPlaceholder(viewHost, "agentsTitle");
      break;
    case "tasks":
      renderPlaceholder(viewHost, "tasksTitle");
      break;
    case "schedules":
      renderPlaceholder(viewHost, "schedulesTitle");
      break;
    default:
      renderHome(viewHost, actions);
  }
}

async function loadProjects() {
  try {
    patch({ projects: await api.getProjects() });
  } catch {
    patch({ projects: [] });
  }
}

async function loadSnapshot(projectId) {
  try {
    const snapshot = await api.getProject(projectId);
    if (!snapshot || state.currentProjectId !== projectId) return;
    state.running = new Set(snapshot.running ?? []);
    patch({ snapshot });
  } catch {
    /* ignore */
  }
}

function ensureMissionEvents() {
  const conversationId = state.currentConversationId;
  if (!conversationId || state.missionEventsFor === conversationId) return;
  patch({
    missionEvents: [],
    missionEventsFor: conversationId,
    missionSummary: null,
    missionSummaryError: false,
  });
  loadMissionSummary(conversationId);
  api
    .getMissionEvents(conversationId)
    .then((events) => {
      if (state.currentConversationId === conversationId) {
        const merged = new Map(
          [...events, ...state.missionEvents].map((event) => [event.id, event]),
        );
        patch({ missionEvents: [...merged.values()].sort((a, b) => a.at - b.at) });
      }
    })
    .catch(() => undefined);
}

async function loadMissionSummary(conversationId) {
  try {
    const summary = await api.getMissionSummary(conversationId);
    if (state.currentConversationId !== conversationId) return;
    if (!state.missionSummary || (summary?.revision ?? 0) >= (state.missionSummary.revision ?? 0))
      patch({ missionSummary: summary, missionSummaryError: false });
  } catch {
    if (state.currentConversationId === conversationId) patch({ missionSummaryError: true });
  }
}

function fixAutomatically() {
  const summary = state.missionSummary;
  if (!summary || isRunningMission()) return;
  const issues = [
    ...summary.verification
      .filter((run) => run.status === "failed")
      .map((run) => `${run.kind}: ${run.summary}\n${(run.output ?? "").slice(-4000)}`),
    ...(summary.review?.findings ?? []).map(
      (finding) =>
        `${finding.file ?? ""}${finding.line ? `:${finding.line}` : ""}: ${finding.message}`,
    ),
    summary.error ?? "",
  ].filter(Boolean);
  send(`${t("fixPrompt")}\n${summary.title}\n\n${issues.join("\n")}`);
}

function isRunningMission() {
  return state.running.has(state.currentConversationId);
}

async function selectProject(projectId) {
  const project = state.projects.find((item) => item.id === projectId);
  patch({
    currentProjectId: projectId,
    currentConversationId: project?.activeConversationId ?? project?.conversations?.[0]?.id ?? null,
    view: "workspace",
    snapshot: null,
  });
  await loadSnapshot(projectId);
}

async function openWorkspace(projectId, conversationId) {
  patch({
    currentProjectId: projectId,
    currentConversationId: conversationId ?? null,
    view: "workspace",
    snapshot: null,
  });
  await loadSnapshot(projectId);
}

function selectConversation(conversationId) {
  patch({ currentConversationId: conversationId, view: "workspace" });
}

function newConversation() {
  const project = currentProject();
  if (!project) return;
  socketSend({ type: "conversation:create", projectId: project.id });
}

function renameConversation(conversationId, current) {
  const project = currentProject();
  if (!project) return;
  const name = window.prompt(t("renameConversation"), current);
  if (!name) return;
  socketSend({ type: "conversation:rename", projectId: project.id, conversationId, name });
}

function deleteConversation(conversationId) {
  const project = currentProject();
  if (!project) return;
  if (!window.confirm(t("confirmDeleteConversation"))) return;
  socketSend({ type: "conversation:delete", projectId: project.id, conversationId });
}

function deleteProject(projectId) {
  if (!window.confirm(t("confirmDeleteProject"))) return;
  socketSend({ type: "project:delete", projectId });
}

function setView(name) {
  if (name === "workspace" && !currentProject()) {
    toast(t("emptySelect"));
    patch({ view: "home" });
    return;
  }
  patch({ view: name });
  if (state.currentProjectId && !state.snapshot && name !== "home") {
    void loadSnapshot(state.currentProjectId);
  }
}

async function startMission(text) {
  const project = currentProject();
  if (!project) {
    toast(t("emptySelect"));
    return;
  }
  const preview = await api.previewMission(text).catch(() => null);
  if (!preview) {
    await beginMission(text);
    return;
  }
  previewModal(preview, text, () => void beginMission(text));
}

async function beginMission(text) {
  const project = currentProject();
  if (!project) return;
  let conversationId =
    state.currentConversationId ?? project.activeConversationId ?? project.conversations?.[0]?.id;
  if (!conversationId) {
    socketSend({ type: "conversation:create", projectId: project.id });
    toast(t("newConversation"));
    return;
  }
  patch({ view: "workspace", currentConversationId: conversationId });
  if (!state.snapshot) await loadSnapshot(project.id);
  send(text);
}

function send(text) {
  const project = currentProject();
  const conversation = currentConversation();
  if (!project || !conversation) {
    toast(t("emptySelect"));
    return;
  }
  if (state.running.has(conversation.id)) return;
  socketSend({
    type: "chat:send",
    projectId: project.id,
    conversationId: conversation.id,
    text,
  });
}

function stop() {
  const project = currentProject();
  const conversation = currentConversation();
  if (!project || !conversation) return;
  if (!state.running.has(conversation.id)) return;
  confirmModal({
    title: t("interruptTitle"),
    body: t("interruptBody"),
    confirmLabel: t("interrupt"),
    cancelLabel: t("cancel"),
    danger: true,
    onConfirm: () =>
      socketSend({ type: "chat:stop", projectId: project.id, conversationId: conversation.id }),
  });
}

function chatAction(action) {
  const project = currentProject();
  const conversation = currentConversation();
  if (!project || !conversation || state.running.has(conversation.id)) return;
  if (action === "discard") {
    confirmModal({
      title: t("discard"),
      body: t("confirmDiscard"),
      confirmLabel: t("discard"),
      cancelLabel: t("cancel"),
      danger: true,
      onConfirm: () =>
        socketSend({
          type: "chat:action",
          projectId: project.id,
          conversationId: conversation.id,
          action,
        }),
    });
    return;
  }
  socketSend({
    type: "chat:action",
    projectId: project.id,
    conversationId: conversation.id,
    action,
  });
}

function comingSoon() {
  toast(t("comingSoon"));
}

function onMessage(msg) {
  switch (msg.type) {
    case "permissions":
      permissionSnapshot(msg.data ?? []);
      break;
    case "permission:notice":
      permissionNotice(msg.notice);
      break;
    case "terminal:out":
      terminalEvent(msg);
      break;
    case "projects": {
      const projects = msg.data ?? [];
      let conversationId = state.currentConversationId;
      const project = projects.find((item) => item.id === state.currentProjectId);
      if (project && !project.conversations.some((item) => item.id === conversationId)) {
        conversationId = project.activeConversationId ?? project.conversations[0]?.id ?? null;
      }
      patch({ projects, currentConversationId: conversationId });
      break;
    }
    case "credentials":
      patch({ credentials: msg.data });
      modals?.renderCredentials();
      break;
    case "settings:ack":
      modals?.handleSettingsAck(msg);
      break;
    case "account:start":
      modals?.onAccountStart(msg);
      break;
    case "account:output":
      modals?.onAccountOutput(msg);
      break;
    case "account:done":
      modals?.onAccountDone(msg);
      break;
    case "chat:message": {
      if (msg.projectId !== state.currentProjectId || !state.snapshot) break;
      const conversation = state.snapshot.project.conversations.find(
        (item) => item.id === msg.conversationId,
      );
      if (conversation) conversation.messages.push(msg.message);
      notify();
      break;
    }
    case "chat:routing": {
      if (msg.projectId !== state.currentProjectId) break;
      const conversation = state.snapshot?.project?.conversations?.find(
        (item) => item.id === msg.conversationId,
      );
      if (conversation) conversation.activeAgent = msg.agent;
      notify();
      break;
    }
    case "chat:turn": {
      if (msg.status === "started") state.running.add(msg.conversationId);
      else {
        state.running.delete(msg.conversationId);
        if (msg.projectId === state.currentProjectId) refreshTools();
      }
      notify();
      break;
    }
    case "chat:diff": {
      if (msg.projectId !== state.currentProjectId || !state.snapshot) break;
      state.snapshot.diffs = state.snapshot.diffs || {};
      state.snapshot.diffs[msg.conversationId] = {
        diff: msg.diff,
        files: msg.files,
        branch: msg.branch,
        baseBranch: msg.baseBranch,
      };
      notify();
      break;
    }
    case "chat:error": {
      if (msg.projectId !== state.currentProjectId || !state.snapshot) break;
      const conversation = state.snapshot.project.conversations.find(
        (item) => item.id === msg.conversationId,
      );
      if (conversation) {
        conversation.messages.push({
          id: String(Date.now()),
          at: Date.now(),
          role: "error",
          text: msg.error,
        });
      }
      notify();
      break;
    }
    case "mission:summary": {
      const summary = msg.summary;
      if (
        summary?.id === state.currentConversationId &&
        (!state.missionSummary || summary.revision >= state.missionSummary.revision)
      ) {
        patch({ missionSummary: summary, missionSummaryError: false });
      }
      break;
    }
    case "chat:action:result": {
      if (
        msg.projectId === state.currentProjectId &&
        msg.conversationId === state.currentConversationId &&
        !msg.ok
      )
        toast(msg.reason || t("actionFailed"));
      break;
    }
    case "mission:event": {
      const event = msg.event;
      if (!event) break;
      toolEvent(event);
      if (event.missionId === state.currentConversationId) {
        state.missionEvents = [...state.missionEvents, event];
        if (event.type === "router:decided") {
          state.route = { stage: event.payload?.route === "plan" ? "plan" : "implement" };
        }
        notify();
      }
      break;
    }
    default:
      break;
  }
}

function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  const btn = document.getElementById("theme-toggle");
  if (btn) btn.textContent = theme === "dark" ? "light" : "dark";
}

function initTheme() {
  let saved;
  try {
    saved = localStorage.getItem(THEME_KEY);
  } catch {
    saved = null;
  }
  const prefersLight = window.matchMedia("(prefers-color-scheme: light)").matches;
  applyTheme(saved || (prefersLight ? "light" : "dark"));
}

function toggleTheme() {
  const current =
    document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark";
  const next = current === "dark" ? "light" : "dark";
  try {
    localStorage.setItem(THEME_KEY, next);
  } catch {
    /* ignore */
  }
  applyTheme(next);
}

function toggleLang() {
  setLang(getLang() === "pt" ? "en" : "pt");
  const btn = document.getElementById("lang-toggle");
  if (btn) btn.textContent = getLang() === "pt" ? "EN" : "PT";
  notify();
}

function buildCommands() {
  const commands = [
    { label: t("cmdRunMission"), run: () => actions.setView("workspace") },
    { label: t("cmdNewProject"), run: () => modals?.openNewProject() },
    { label: t("cmdNewConversation"), run: newConversation },
    { label: t("cmdGoHome"), run: () => actions.setView("home") },
    { label: t("cmdShowDiff"), run: () => switchInspectorTab("diff") },
    { label: t("cmdRunTests"), run: comingSoon },
    { label: t("cmdCreateCheckpoint"), run: comingSoon },
    { label: t("cmdAskRepo"), run: comingSoon },
    ...["manual", "assisted", "autonomous"].map((mode) => ({
      label: `${t("cmdChangeAutonomy")}: ${t(`autonomy${mode}`)}`,
      run: () => actions.setAutonomy(mode),
    })),
    { label: t("cmdInterrupt"), run: stop },
    { label: t("cmdOpenSettings"), run: () => modals?.openSettings() },
    { label: t("cmdToggleTheme"), run: toggleTheme },
    { label: t("cmdToggleLang"), run: toggleLang },
  ];
  for (const project of state.projects) {
    commands.push({
      label: `${t("cmdSwitchProject")}: ${project.name}`,
      run: () => actions.selectProject(project.id),
    });
  }
  const project = currentProject();
  if (project) {
    for (const conversation of project.conversations ?? []) {
      commands.push({
        label: `↳ ${conversation.name}`,
        run: () => actions.selectConversation(conversation.id),
      });
    }
  }
  return commands;
}

function openInspector(name) {
  switchInspectorTab(name);
  if (window.innerWidth <= 1080) document.body.classList.add("inspector-open");
}

function showDiff() {
  openInspector("diff");
  const view = document.getElementById("diff-view");
  view?.setAttribute("tabindex", "-1");
  view?.focus();
}

function switchInspectorTab(name) {
  document.querySelectorAll("#inspector-tabs .tab").forEach((tab) => {
    tab.classList.toggle("active", tab.dataset.tab === name);
  });
  document.querySelectorAll("#right .tab-panel").forEach((panel) => {
    panel.classList.toggle("active", panel.id === `tab-${name}`);
  });
}

function initResizers() {
  const root = document.documentElement;
  const setup = (id, variable, min, max) => {
    const handle = document.getElementById(id);
    if (!handle) return;
    handle.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      handle.setPointerCapture(event.pointerId);
      const startX = event.clientX;
      const startWidth = Number.parseInt(getComputedStyle(root).getPropertyValue(variable)) || min;
      const onMove = (moveEvent) => {
        const delta = moveEvent.clientX - startX;
        const next = Math.max(min, Math.min(max, startWidth + delta));
        root.style.setProperty(variable, `${next}px`);
      };
      const onUp = () => {
        handle.removeEventListener("pointermove", onMove);
        handle.removeEventListener("pointerup", onUp);
      };
      handle.addEventListener("pointermove", onMove);
      handle.addEventListener("pointerup", onUp);
    });
  };
  setup("divider-left", "--sidebar-w", 200, 420);
  setup("divider-right", "--right-w", 260, 620);
}

function initShortcuts() {
  window.addEventListener("keydown", (event) => {
    if (document.querySelector("dialog[open]")) return;
    const mod = event.ctrlKey || event.metaKey;
    if (mod && event.key.toLowerCase() === "k") {
      event.preventDefault();
      if (paletteOpen()) closePalette();
      else openPalette(buildCommands());
    } else if (mod && event.key.toLowerCase() === "p") {
      event.preventDefault();
      openPalette(buildCommands());
    } else if (mod && event.shiftKey && event.key.toLowerCase() === "d") {
      event.preventDefault();
      switchInspectorTab("diff");
    } else if (mod && event.shiftKey && event.key.toLowerCase() === "s") {
      event.preventDefault();
      switchInspectorTab("session");
    } else if (mod && event.key === "Enter") {
      const form = document.querySelector(".composer");
      if (form) {
        event.preventDefault();
        form.requestSubmit();
      }
    } else if (event.key === "Escape") {
      document.body.classList.remove("inspector-open");
      if (paletteOpen()) closePalette();
    }
  });
}

function initFooter() {
  document
    .getElementById("inspector-close")
    ?.addEventListener("click", () => document.body.classList.remove("inspector-open"));
  document.getElementById("theme-toggle")?.addEventListener("click", toggleTheme);
  document.getElementById("lang-toggle")?.addEventListener("click", toggleLang);
  document
    .getElementById("palette-btn")
    ?.addEventListener("click", () => openPalette(buildCommands()));
  document.getElementById("brand-home")?.addEventListener("click", () => actions.setView("home"));
  document.querySelectorAll("#inspector-tabs .tab").forEach((tab) => {
    tab.addEventListener("click", () => switchInspectorTab(tab.dataset.tab));
  });
}

async function boot() {
  initLang();
  initTheme();
  initPalette();
  applyStatic();
  modals = initModals(actions);
  initResizers();
  initShortcuts();
  initFooter();
  document.getElementById("lang-toggle").textContent = getLang() === "pt" ? "EN" : "PT";
  subscribe(renderAll);
  initSocket(onMessage);
  await loadProjects();
  notify();
  api
    .getCredentials()
    .then((credentials) => {
      patch({ credentials });
      modals.renderCredentials();
    })
    .catch(() => undefined);
  modals.setupUpdates();
  if (!isConnected()) toast(t("noConnection"), "warn");
}

void boot();
