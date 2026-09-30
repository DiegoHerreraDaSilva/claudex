import { clear, el } from "../lib/dom.js";
import { t } from "../lib/i18n.js";
import { state } from "../lib/store.js";

let promptDraft = "";

export function renderHome(root, actions) {
  clear(root);
  const view = el("div", { class: "view home" });
  view.appendChild(renderOnboarding(actions));
  view.appendChild(renderHero(actions));
  view.appendChild(renderQuickActions(actions));
  const missions = collectMissions();
  view.appendChild(renderMissions(missions, actions));
  view.appendChild(renderProjects(actions));
  root.appendChild(view);
}

function greeting() {
  const hour = new Date().getHours();
  if (hour < 12) return t("greetingMorning");
  if (hour < 18) return t("greetingAfternoon");
  return t("greetingEvening");
}

function renderHero(actions) {
  const hero = el("div", { class: "hero" });
  hero.appendChild(el("div", { class: "hero-greeting", text: `${greeting()}.` }));
  hero.appendChild(el("div", { class: "hero-tagline", text: t("homeTagline") }));

  const form = el("form", {
    class: "hero-form",
    onsubmit: (event) => {
      event.preventDefault();
      const value = input.value.trim();
      if (!value) return;
      actions.newTask({ prompt: value, startNow: true });
    },
  });
  const input = el("textarea", {
    class: "hero-input",
    value: promptDraft,
    maxlength: 12000,
    "aria-label": t("homePromptPlaceholder"),
    oninput: () => {
      promptDraft = input.value;
    },
    rows: 2,
    placeholder: t("homePromptPlaceholder"),
    "data-i18n-ph": "homePromptPlaceholder",
    onkeydown: (event) => {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        form.requestSubmit();
      }
    },
  });
  input.value = promptDraft;
  form.append(input, el("button", { class: "primary-btn hero-send", text: t("quickNewMission") }));
  hero.appendChild(form);
  return hero;
}

function renderQuickActions(actions) {
  const row = el("div", { class: "quick-actions" });
  const items = [
    { label: "quickAskRepo", run: () => actions.setView("intelligence") },
    { label: "quickReview", run: () => actions.setView("missions") },
    { label: "quickRunTests", run: () => actions.setView("missions") },
    { label: "quickWorkspace", run: () => actions.setView("workspace") },
  ];
  for (const item of items) {
    row.appendChild(el("button", { class: "quick-btn", text: t(item.label), onclick: item.run }));
  }
  return row;
}

function collectMissions() {
  const missions = [];
  for (const project of state.projects) {
    for (const conversation of project.conversations ?? []) {
      if (conversation.running || conversation.messageCount > 0)
        missions.push({ project, conversation });
    }
  }
  missions.sort((a, b) => Number(b.conversation.running) - Number(a.conversation.running));
  return missions.slice(0, 6);
}

function renderMissions(missions, actions) {
  const section = el("section", { class: "home-section" });
  section.appendChild(el("div", { class: "section-label", text: t("activeMissions") }));
  if (missions.length === 0) {
    const empty = el("div", { class: "empty-card" });
    empty.append(
      el("div", { class: "empty-title", text: t("noActiveMission") }),
      el("div", { class: "empty-sub", text: t("noActiveMissionHint") }),
    );
    section.appendChild(empty);
    return section;
  }
  const grid = el("div", { class: "mission-grid" });
  for (const { project, conversation } of missions) {
    const running = conversation.running;
    const card = el("div", {
      class: "mission-card",
      role: "button",
      tabindex: 0,
      onkeydown: (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          actions.openWorkspace(project.id, conversation.id);
        }
      },
      onclick: () => actions.openWorkspace(project.id, conversation.id),
    });
    card.append(
      el("div", { class: "mission-head" }, [
        el("span", { class: `status-badge ${running ? "running" : "idle"}` }, [
          el("span", { class: "status-dot" }),
          el("span", { text: running ? t("statusRunning") : t("statusIdle") }),
        ]),
      ]),
      el("div", { class: "mission-title", text: conversation.name }),
      el("div", {
        class: "mission-sub",
        text: project.name,
      }),
    );
    grid.appendChild(card);
  }
  section.appendChild(grid);
  return section;
}

function renderProjects(actions) {
  const section = el("section", { class: "home-section" });
  section.appendChild(el("div", { class: "section-label", text: t("recentProjects") }));
  if (state.projects.length === 0) {
    section.appendChild(el("div", { class: "empty", text: t("emptyNoProjects") }));
    return section;
  }
  const grid = el("div", { class: "project-grid" });
  for (const project of state.projects) {
    const card = el("div", {
      class: "project-card",
      role: "button",
      tabindex: 0,
      onkeydown: (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          actions.selectProject(project.id);
        }
      },
      onclick: () => actions.selectProject(project.id),
    });
    card.append(
      el("div", { class: "project-card-name", text: project.name }),
      el("div", { class: "project-card-path", text: project.rootPath }),
      el("div", { class: "project-card-meta" }, [
        el("span", { text: `${(project.conversations ?? []).length} ${t("conversations")}` }),
        el("span", { class: "project-card-open", text: t("openWorkspace") }),
      ]),
    );
    grid.appendChild(card);
  }
  section.appendChild(grid);
  return section;
}

function renderOnboarding(actions) {
  const section = el("section", { class: "onboarding" }, [
    el("h2", { text: t("onboardingTitle") }),
  ]);
  const steps = el("div", { class: "onboarding-steps" });
  for (const [index, key, hint, action] of [
    [1, "onboardingAccount", "onboardingAccountHint", actions.openSettings],
    [2, "onboardingProject", "onboardingProjectHint", actions.openNewProject],
    [3, "onboardingTask", "onboardingTaskHint", () => actions.newTask()],
  ])
    steps.append(
      el("button", { class: "onboarding-step", onclick: action }, [
        el("span", { class: "step-number", text: String(index) }),
        el("strong", { text: t(key) }),
        el("span", { text: t(hint) }),
      ]),
    );
  section.append(steps);
  return section;
}
