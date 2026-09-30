import { clear, el } from "../lib/dom.js";
import { t } from "../lib/i18n.js";
import { currentConversation, currentDiff, currentProject, state } from "../lib/store.js";

export function renderInspector() {
  const diff = currentDiff();
  renderDiffChips(diff);
  renderDiffView(diff);
  renderFiles(diff);
  renderSession();
  const branch = document.getElementById("inspector-branch");
  if (branch) branch.textContent = currentConversation()?.branch ?? "";
}

function renderDiffChips(diff) {
  const host = document.getElementById("diff-files");
  clear(host);
  for (const file of diff?.files ?? []) {
    host.appendChild(el("span", { class: "file-chip", text: file }));
  }
}

function renderDiffView(diff) {
  const host = document.getElementById("diff-view");
  clear(host);
  if (!diff?.diff) {
    host.appendChild(el("span", { class: "empty", text: t("noDiff") }));
    return;
  }
  const fragment = document.createDocumentFragment();
  for (const line of diff.diff.split("\n")) {
    const span = el("span");
    if (line.startsWith("+") && !line.startsWith("+++")) span.className = "add";
    else if (line.startsWith("-") && !line.startsWith("---")) span.className = "del";
    span.textContent = `${line}\n`;
    fragment.appendChild(span);
  }
  host.appendChild(fragment);
}

function renderFiles(diff) {
  const host = document.getElementById("files-list");
  clear(host);
  const files = diff?.files ?? [];
  if (files.length === 0) {
    host.appendChild(el("div", { class: "empty", text: t("noChanges") }));
    return;
  }
  for (const file of files) {
    host.appendChild(el("div", { class: "file-row" }, [
      el("span", { class: "file-dot", text: "◆" }),
      el("span", { class: "file-name", text: file }),
    ]));
  }
}

function renderSession() {
  const host = document.getElementById("tab-session");
  const project = currentProject();
  const conversation = currentConversation();
  clear(host);
  if (!project || !conversation) {
    host.appendChild(el("span", { class: "empty", text: t("noSession") }));
    return;
  }
  const full = state.snapshot?.project?.conversations?.find((item) => item.id === conversation.id);
  const rows = [
    [t("project"), project.name],
    ["pasta", project.rootPath],
    [t("currentConversation"), conversation.name],
    ["branch", full?.branch || "—"],
    ["base", project.baseBranch || "—"],
    ["agente", full?.activeAgent || "—"],
    ["claude session", full?.claudeSessionId || "—"],
    ["codex thread", full?.codexThreadId || "—"],
    ["tokens", `${conversation.usage?.inputTokens ?? 0} in / ${conversation.usage?.outputTokens ?? 0} out`],
    ["custo", `$${(conversation.costUsd ?? 0).toFixed(4)}`],
  ];
  for (const [key, value] of rows) {
    host.appendChild(el("div", { class: "session-card" }, [
      el("div", { class: "k", text: key }),
      el("div", { class: "v", text: value }),
    ]));
  }
}
