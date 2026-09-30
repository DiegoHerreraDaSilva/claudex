import { clear, el } from "../lib/dom.js";
import { roleLabel, t } from "../lib/i18n.js";
import {
  conversationMessages,
  currentDiff,
  currentConversation,
  currentProject,
  isRunning,
  state,
} from "../lib/store.js";

let draft = "";
let lastScrollTop = 0;

export function renderWorkspace(root, actions) {
  const project = currentProject();
  const conversation = currentConversation();
  clear(root);
  if (!project || !conversation) {
    const empty = el("div", { class: "view" });
    empty.appendChild(el("div", { class: "empty-view" }, [el("div", { class: "empty", text: t("emptySelect") })]));
    root.appendChild(empty);
    return;
  }

  const view = el("div", { class: "view workspace" });
  view.appendChild(renderHeader(project, conversation, actions));
  view.appendChild(renderPipeline(conversation));
  const scroll = { el: null };
  view.appendChild(renderTranscript(conversation, scroll));
  view.appendChild(renderComposer(actions));
  root.appendChild(view);

  if (state.autoscroll) scroll.el.scrollTop = scroll.el.scrollHeight;
  else scroll.el.scrollTop = lastScrollTop;
  scroll.el.addEventListener("scroll", () => {
    lastScrollTop = scroll.el.scrollTop;
    state.autoscroll = Math.abs(scroll.el.scrollHeight - scroll.el.scrollTop - scroll.el.clientHeight) < 40;
  });
}

function renderHeader(project, conversation, actions) {
  const running = isRunning(conversation.id);
  const files = currentDiff()?.files ?? [];
  const canAct = files.length > 0 && !running;
  const canApply = canAct && (state.missionSummary ? state.missionSummary.status === "ready" : !conversation.validationRequired);

  const header = el("header", { class: "workspace-header" });
  const info = el("div", { class: "proj-info" });
  info.append(
    el("div", { class: "proj-name", text: `${project.name}  ·  ${conversation.name}` }),
    el("div", {
      class: "proj-meta",
      text: [
        project.rootPath,
        project.baseBranch ? `base: ${project.baseBranch}` : null,
        conversation.branch ? `branch: ${conversation.branch}` : null,
        conversation.activeAgent || null,
      ]
        .filter(Boolean)
        .join("  •  "),
    }),
  );
  header.appendChild(info);

  const actionsRow = el("div", { class: "header-actions" });
  actionsRow.append(
    el("button", {
      class: "ghost-btn",
      text: t("stop"),
      disabled: !running,
      onclick: () => actions.stop(),
    }),
    el("button", {
      class: "ghost-btn",
      text: t("apply"),
      disabled: !canApply,
      onclick: () => actions.chatAction("apply"),
    }),
    el("button", {
      class: "ghost-btn",
      text: t("discard"),
      disabled: !canAct,
      onclick: () => actions.chatAction("discard"),
    }),
  );
  header.appendChild(actionsRow);
  return header;
}

function renderPipeline(conversation) {
  const running = isRunning(conversation.id);
  const hasDiff = (currentDiff()?.files?.length ?? 0) > 0;
  const stages = [
    { key: "stagePlan", label: "plan" },
    { key: "stageImplement", label: "implement" },
    { key: "stageVerify", label: "verify" },
    { key: "stageReview", label: "review" },
    { key: "stageReady", label: "ready" },
  ];
  const status = state.missionSummary?.status;
  const indices = { planning: 0, implementing: 1, verifying: 2, reviewing: 3, ready: 4, applied: 4 };
  let activeIndex = indices[status] ?? (running ? 1 : hasDiff && !status ? 4 : -1);
  if (status === "failed") activeIndex = state.missionSummary.review ? 3 : 2;

  const strip = el("div", { class: "pipeline" });
  stages.forEach((stage, index) => {
    const cls = status === "failed" && index === activeIndex ? "failed" : index < activeIndex ? "done" : index === activeIndex ? (running ? "active" : "current") : "pending";
    strip.appendChild(el("div", { class: `pipeline-stage ${cls}` }, [
      el("span", { class: "pipeline-dot" }),
      el("span", { text: t(stage.key) }),
    ]));
  });
  return strip;
}

function renderTranscript(conversation, scroll) {
  const container = el("div", { class: "transcript" });
  scroll.el = container;
  const messages = conversationMessages();
  if (messages.length === 0) {
    container.appendChild(el("div", { class: "empty", text: t("emptyDescribe") }));
  }
  for (const message of messages) {
    const row = el("div", { class: `msg ${message.role}` });
    row.append(
      el("div", { class: "who", text: roleLabel(message.role) }),
      el("div", { class: "bubble", text: message.meta ? `${message.text}\n${message.meta}` : message.text }),
    );
    container.appendChild(row);
  }
  if (isRunning(conversation.id)) {
    container.appendChild(
      el("div", { class: "msg assistant typing" }, [el("div", { class: "bubble", text: t("thinking") })]),
    );
  }
  return container;
}

function renderComposer(actions) {
  const form = el("form", {
    class: "composer",
    onsubmit: (event) => {
      event.preventDefault();
      const text = input.value.trim();
      if (!text) return;
      input.value = "";
      draft = "";
      autoGrow(input);
      actions.send(text);
    },
  });
  const input = el("textarea", {
    class: "composer-input",
    rows: 1,
    placeholder: t("composerPlaceholder"),
    "data-i18n-ph": "composerPlaceholder",
    value: draft,
    oninput: () => {
      draft = input.value;
      autoGrow(input);
    },
    onkeydown: (event) => {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        form.requestSubmit();
      }
    },
  });
  form.append(input, el("button", { class: "primary-btn send-btn", type: "submit", text: t("send") }));
  requestAnimationFrame(() => autoGrow(input));
  return form;
}

function autoGrow(input) {
  input.style.height = "auto";
  input.style.height = `${Math.min(input.scrollHeight, 180)}px`;
}
