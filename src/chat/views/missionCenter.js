import { clear, el } from "../lib/dom.js";
import { renderMissionResults } from "../components/missionResults.js";
import { t } from "../lib/i18n.js";
import { currentConversation, currentDiff, currentProject, isRunning, state } from "../lib/store.js";

const LEVEL_ICON = { success: "●", info: "○", warn: "▲", error: "✕" };

export function renderMissionCenter(root, actions) {
  const project = currentProject();
  const conversation = currentConversation();
  clear(root);
  if (!project || !conversation) {
    root.appendChild(el("div", { class: "view empty-view" }, [el("div", { class: "empty", text: t("emptySelect") })]));
    return;
  }
  const view = el("div", { class: "view mission-center" });
  view.appendChild(renderHeader(project, conversation));
  view.appendChild(renderAgents(conversation));
  view.appendChild(renderTaskGraph(conversation));
  view.appendChild(renderMissionResults(actions));
  view.appendChild(renderTimeline());
  root.appendChild(view);
}

function renderHeader(project, conversation) {
  const running = isRunning(conversation.id);
  const diff = currentDiff();
  const header = el("div", { class: "mc-header" });
  header.append(
    el("div", { class: "mc-title-row" }, [
      el("div", { class: "mc-title", text: conversation.name }),
      el("span", { class: `status-badge ${running ? "running" : "idle"}` }, [
        el("span", { class: "status-dot" }),
        el("span", { text: state.missionSummary ? t(`missionStatus${state.missionSummary.status[0].toUpperCase()}${state.missionSummary.status.slice(1)}`) : running ? t("statusRunning") : t("statusIdle") }),
      ]),
    ]),
    el("div", { class: "mc-sub", text: `${project.name} · ${project.baseBranch || "main"}${conversation.branch ? ` · ${conversation.branch}` : ""}` }),
  );

  const metrics = el("div", { class: "mc-metrics" });
  const usage = state.missionSummary?.usage ?? conversation.usage;
  metrics.append(
    metric(t("tokensShort"), `${usage?.inputTokens ?? 0} in / ${usage?.outputTokens ?? 0} out`),
    metric(t("costShort"), `$${(state.missionSummary?.costUsd ?? conversation.costUsd ?? 0).toFixed(4)}`),
    metric(t("tabFiles"), String(diff?.files?.length ?? 0)),
    metric(t("autonomy"), conversation.activeAgent || t("autonomyAssisted")),
  );
  header.appendChild(metrics);
  return header;
}

function metric(label, value) {
  return el("div", { class: "metric" }, [
    el("div", { class: "metric-label", text: label }),
    el("div", { class: "metric-value", text: value }),
  ]);
}

function agentRuns() {
  if (state.missionSummary) return state.missionSummary.agentRuns;
  return state.missionEvents
    .filter((event) => event.type === "agent:completed" && event.payload?.run)
    .map((event) => event.payload.run);
}

function renderAgents(conversation) {
  const section = el("section", { class: "mc-section" });
  section.appendChild(el("div", { class: "section-label", text: t("navAgents") }));
  const grid = el("div", { class: "agent-grid" });
  const runs = agentRuns();

  const active = [...state.missionEvents].reverse().find(event => event.type === "agent:started");
  if (isRunning(conversation.id) && state.missionSummary?.status !== "verifying") {
    grid.appendChild(
      el("div", { class: "agent-card running" }, [
        el("div", { class: "agent-head" }, [
          el("span", { class: "agent-name", text: active?.message || conversation.activeAgent || "agent" }),
          el("span", { class: "agent-role", text: t("statusRunning") }),
        ]),
        el("div", { class: "agent-bar" }, [el("i", { class: "indeterminate" })]),
        el("div", { class: "agent-meta", text: t("thinking") }),
      ]),
    );
  }

  if (runs.length === 0 && !isRunning(conversation.id)) {
    grid.appendChild(el("div", { class: "empty", text: t("noActiveMission") }));
  }

  for (const run of runs) {
    const durationMs = Math.max(0, (run.endedAt ?? 0) - (run.startedAt ?? 0));
    grid.appendChild(
      el("div", { class: "agent-card" }, [
        el("div", { class: "agent-head" }, [
          el("span", { class: "agent-name", text: run.label }),
          el("span", { class: "agent-role", text: run.model }),
        ]),
        el("div", { class: "agent-bar" }, [el("i", { style: { width: "100%" } })]),
        el("div", { class: "agent-meta", text: `${run.usage?.inputTokens ?? 0} in / ${run.usage?.outputTokens ?? 0} out · $${(run.costUsd ?? 0).toFixed(4)} · ${formatDuration(durationMs)}` }),
      ]),
    );
  }
  section.appendChild(grid);
  return section;
}

function renderTaskGraph(conversation) {
  const section = el("section", { class: "mc-section" });
  section.appendChild(el("div", { class: "section-label", text: t("navTasks") }));
  const plan = [...state.missionEvents].reverse().find((event) => event.type === "plan:created");
  const subtasks = state.missionSummary?.tasks ?? plan?.payload?.subtasks ?? [];
  const graph = el("div", { class: "task-graph" });

  const nodes = subtasks.length > 0 ? subtasks : defaultNodes(conversation);
  nodes.forEach((title, index) => {
    if (index > 0) graph.appendChild(el("div", { class: "graph-connector" }));
    const done = ["ready", "applied"].includes(state.missionSummary?.status);
    graph.appendChild(
      el("div", { class: `task-node${isRunning(conversation.id) ? " active" : done ? " done" : ""}` }, [
        el("span", { class: "task-node-index", text: String(index + 1) }),
        el("span", { class: "task-node-title", text: title }),
      ]),
    );
  });
  section.appendChild(graph);
  return section;
}

function defaultNodes(conversation) {
  if (state.route?.stage === "plan" || conversation.activeAgent?.startsWith("codex")) {
    return ["planejar", "implementar", "validar"];
  }
  return ["implementar"];
}

function renderTimeline() {
  const section = el("section", { class: "mc-section" });
  section.appendChild(el("div", { class: "section-label", text: t("navHistory") }));
  const events = [...state.missionEvents].sort((a, b) => a.at - b.at);
  if (events.length === 0) {
    section.appendChild(el("div", { class: "empty", text: t("noActiveMission") }));
    return section;
  }
  const list = el("div", { class: "timeline" });
  for (const event of events) {
    const row = el("div", { class: `timeline-item ${event.level}` });
    row.append(
      el("div", { class: "timeline-time", text: formatTime(event.at) }),
      el("div", { class: "timeline-rail" }, [el("span", { class: "timeline-dot", text: LEVEL_ICON[event.level] ?? "○" })]),
      el("div", { class: "timeline-body" }, [
        el("div", { class: "timeline-type", text: event.type }),
        el("div", { class: "timeline-message", text: truncate(event.message, 400) }),
      ]),
    );
    list.appendChild(row);
  }
  section.appendChild(list);
  return section;
}

function formatTime(ts) {
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function formatDuration(ms) {
  const total = Math.round(ms / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function truncate(text, max) {
  const value = String(text ?? "");
  return value.length > max ? `${value.slice(0, max)}…` : value;
}
