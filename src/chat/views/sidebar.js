import { clear, el } from "../lib/dom.js";
import { t } from "../lib/i18n.js";
import { currentProject, state } from "../lib/store.js";

const WORKSPACE_NAV = [
  { view: "home", label: "navHome", icon: "⌂" },
  { view: "workspace", label: "navConversations", icon: "◇" },
  { view: "missions", label: "navMissions", icon: "▣" },
  { view: "worktrees", label: "navWorktrees", icon: "⌘" },
  { view: "memory", label: "navMemory", icon: "◈" },
  { view: "history", label: "navHistory", icon: "⌁" },
];

const AUTOMATION_NAV = [
  { view: "agents", label: "navAgents", icon: "◉" },
  { view: "tasks", label: "navTasks", icon: "◉" },
  { view: "schedules", label: "navSchedules", icon: "◉" },
];

export function renderSidebar(root, actions) {
  clear(root);
  root.appendChild(renderProjects(actions));
  const project = currentProject();
  if (project) {
    root.appendChild(renderNav(t("workspace"), WORKSPACE_NAV, actions));
  }
  root.appendChild(renderNav(t("automation"), AUTOMATION_NAV, actions));
  root.appendChild(renderSystem(actions));
}

function renderProjects(actions) {
  const group = el("div", { class: "nav-group" });
  group.appendChild(el("div", { class: "nav-label", text: t("recentProjects") }));
  if (state.projects.length === 0) {
    group.appendChild(el("div", { class: "empty", text: t("emptyNoProjects") }));
    return group;
  }
  for (const project of state.projects) {
    const selected = project.id === state.currentProjectId;
    const card = el("div", { class: `project${selected ? " selected" : ""}` });
    const head = el("div", {
      class: "project-head",
      onclick: () => actions.selectProject(project.id),
    });
    head.append(
      el("span", { class: `dot${project.running ? " running" : ""}` }),
      el("span", { class: "project-name", text: project.name }),
      el("button", {
        class: "icon-btn",
        title: t("deleteProject"),
        text: "×",
        onclick: (event) => {
          event.stopPropagation();
          actions.deleteProject(project.id);
        },
      }),
    );
    card.append(head, el("div", { class: "project-path", text: project.rootPath }));

    if (selected) {
      const list = el("div", { class: "conversation-list" });
      for (const conversation of project.conversations ?? []) {
        const row = el("div", {
          class: `conversation${conversation.id === state.currentConversationId ? " selected" : ""}`,
          onclick: () => actions.selectConversation(conversation.id),
        });
        row.append(
          el("span", { class: `dot${conversation.running ? " running" : ""}` }),
          el("span", { class: "conversation-name", text: conversation.name }),
          el("button", {
            class: "icon-btn",
            title: t("renameConversation"),
            text: "✎",
            onclick: (event) => {
              event.stopPropagation();
              actions.renameConversation(conversation.id, conversation.name);
            },
          }),
          el("button", {
            class: "icon-btn",
            title: t("deleteConversation"),
            text: "×",
            onclick: (event) => {
              event.stopPropagation();
              actions.deleteConversation(conversation.id);
            },
          }),
        );
        list.appendChild(row);
      }
      list.appendChild(
        el("button", {
          class: "new-conv",
          text: t("newConversation"),
          onclick: (event) => {
            event.stopPropagation();
            actions.newConversation();
          },
        }),
      );
      card.appendChild(list);
    }
    group.appendChild(card);
  }
  return group;
}

function renderNav(title, items, actions) {
  const group = el("div", { class: "nav-group" });
  group.appendChild(el("div", { class: "nav-label", text: title }));
  for (const item of items) {
    const active = state.view === item.view;
    group.appendChild(
      el("button", {
        class: `nav-item${active ? " active" : ""}`,
        onclick: () => actions.setView(item.view),
      }, [
        el("span", { class: "nav-icon", text: item.icon }),
        el("span", { class: "nav-text", text: t(item.label) }),
        item.view === "workspace" && currentProject()?.running
          ? el("span", { class: "nav-badge", text: "●" })
          : null,
      ]),
    );
  }
  return group;
}

function renderSystem(actions) {
  const group = el("div", { class: "nav-group" });
  group.appendChild(el("div", { class: "nav-label", text: t("system") }));
  group.appendChild(
    el("button", { class: "nav-item", onclick: () => actions.openSettings() }, [
      el("span", { class: "nav-icon", text: "⚙" }),
      el("span", { class: "nav-text", text: t("settings") }),
      el("span", { class: "nav-icon dot-warn", text: state.credentials && credentialsWarn() ? "●" : "" }),
    ]),
  );
  return group;
}

function credentialsWarn() {
  const cred = state.credentials;
  if (!cred) return false;
  return !cred.typesafe?.configured || cred.claude.mode === "none" || cred.codex.mode === "none";
}

export { credentialsWarn };
