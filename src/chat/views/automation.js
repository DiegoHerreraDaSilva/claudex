import { clear, el } from "../lib/dom.js";
import { getLang, t } from "../lib/i18n.js";
import { notify, state } from "../lib/store.js";
import { confirmModal } from "../components/confirm.js";
import { toast } from "../components/toast.js";
let overview;
let assistants;
let loading = false;
let assistantLoading = false;
let error;
let assistantError;
let version = 0;
let dialogIndex = 0;
const pending = new Set();
const filters = { search: "", project: "", status: "", schedule: "" };
const statusKeys = {
  todo: "workTodo",
  running: "workRunning",
  review: "workReview",
  done: "workDone",
  attention: "workAttention",
  cancelled: "workCancelled",
};
const button = (key, run, props = {}) =>
  el("button", { class: "ghost-btn", text: t(key), type: "button", onclick: run, ...props });
function errorText(code) {
  const key = `workError${code}`;
  return t(key) === key ? t("workErrorSTORAGE_ERROR") : t(key);
}
async function api(url, method = "GET", body) {
  const response = await fetch(url, {
    method,
    ...(body === undefined
      ? {}
      : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(errorText(data.code));
  return data;
}
export function refreshWork() {
  version++;
  overview = undefined;
  assistants = undefined;
  error = undefined;
  assistantError = undefined;
  notify();
}
export function ensureWork() {
  if (!["home", "agents", "tasks", "schedules"].includes(state.view)) return;
  if (!overview && !loading && !error) {
    loading = true;
    const requested = version;
    api("/api/work/overview")
      .then((data) => {
        if (requested === version) overview = data;
      })
      .catch((err) => {
        if (requested === version) error = err.message;
      })
      .finally(() => {
        loading = false;
        notify();
      });
  }
  if (state.view === "agents" && !assistants && !assistantLoading && !assistantError) {
    assistantLoading = true;
    const requested = version;
    api("/api/assistants")
      .then((data) => {
        if (requested === version) assistants = data;
      })
      .catch((err) => {
        if (requested === version) assistantError = err.message;
      })
      .finally(() => {
        assistantLoading = false;
        notify();
      });
  }
}
function projectChoices(selected) {
  const select = el("select", { required: true }, [
    el("option", { value: "", text: t("workChooseProject") }),
    ...state.projects.map((project) => el("option", { value: project.id, text: project.name })),
  ]);
  select.value =
    selected ?? state.currentProjectId ?? (state.projects.length === 1 ? state.projects[0].id : "");
  return select;
}
function labelled(key, field, id) {
  field.id = id;
  return el("div", { class: "friendly-field" }, [el("label", { for: id, text: t(key) }), field]);
}
function dateInput(time) {
  const date = new Date(time);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}
export function openWorkForm(
  actions,
  { task, schedule, prompt = "", startNow = false, duplicate = false } = {},
) {
  if (!state.projects.length) {
    actions.openNewProject();
    toast(t("workNeedProject"));
    return;
  }
  const item = task ?? schedule ?? {};
  const editing = item.id && !duplicate;
  const prefix = `work-form-${++dialogIndex}`;
  const dialog = el("dialog", { class: "friendly-dialog", "aria-labelledby": `${prefix}-heading` });
  const form = el("form", { class: "friendly-form" });
  const title = el("input", {
    required: true,
    maxlength: 120,
    autocomplete: "off",
    value: item.title ?? prompt.split("\n")[0].slice(0, 80),
  });
  const instructions = el("textarea", {
    required: true,
    maxlength: 12000,
    rows: 5,
    placeholder: t("workInstructionsPh"),
  });
  instructions.value = item.instructions ?? prompt;
  const project = projectChoices(item.projectId);
  const mode = el(
    "select",
    {},
    ["manual", "assisted", "autonomous"].map((value) =>
      el("option", { value, text: t(`autonomy${value}`) }),
    ),
  );
  mode.value = item.mode ?? "assisted";
  const modeHint = el("p", { class: "muted", text: t(`workModeHint${mode.value}`) });
  mode.addEventListener("change", () => {
    modeHint.textContent = t(`workModeHint${mode.value}`);
  });
  const failure = el("p", { role: "alert", class: "friendly-error" });
  let busy = false;
  const cancel = button("cancel", () => dialog.close());
  const submit = el("button", {
    type: "submit",
    class: "primary-btn",
    text: t(schedule ? "scheduleSaved" : editing ? "workSaveChanges" : "saveTask"),
  });
  const start = el("button", {
    type: "submit",
    class: "primary-btn",
    text: t("startTask"),
    dataset: { start: "yes" },
  });
  const heading = schedule
    ? editing
      ? "scheduleEdit"
      : "newSchedule"
    : editing
      ? "editTask"
      : "newTask";
  form.append(
    el("h2", { id: `${prefix}-heading`, text: t(heading) }),
    el("p", { class: "muted", text: t("workOpenResultHint") }),
    labelled("workTitleLabel", title, `${prefix}-title`),
    labelled("workProject", project, `${prefix}-project`),
    labelled("workInstructions", instructions, `${prefix}-instructions`),
    labelled("workMode", mode, `${prefix}-mode`),
    modeHint,
  );
  let time, repeat;
  if (schedule) {
    time = el("input", {
      type: "datetime-local",
      required: true,
      min: dateInput(Date.now() + 60000),
    });
    time.value = dateInput(
      Math.max(schedule.nextRunAt ?? schedule.startsAt ?? 0, Date.now() + 3600000),
    );
    repeat = el(
      "select",
      {},
      ["once", "daily", "weekly"].map((value) =>
        el("option", { value, text: t(`repeat${value}`) }),
      ),
    );
    repeat.value = schedule.repeat ?? "once";
    form.append(
      labelled("scheduleTime", time, `${prefix}-time`),
      labelled("scheduleRepeat", repeat, `${prefix}-repeat`),
      el("p", {
        class: "muted",
        text: `${t("scheduleTimeZone")}: ${overview?.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone}`,
      }),
      el("p", { class: "friendly-notice", text: t("scheduleOpenHint") }),
    );
  }
  const buttons = el("div", { class: "friendly-actions" });
  if (!schedule && !editing) buttons.append(start);
  submit.textContent = t(schedule ? "saveSchedule" : editing ? "workSaveChanges" : "saveTask");
  buttons.append(submit, cancel);
  form.append(failure, buttons);
  dialog.addEventListener("cancel", (event) => {
    if (busy) event.preventDefault();
  });
  dialog.addEventListener("close", () => dialog.remove());
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (busy) return;
    const runNow =
      !schedule && !editing && (event.submitter === start || (startNow && !event.submitter));
    const input = {
      projectId: project.value,
      title: title.value.trim(),
      instructions: instructions.value.trim(),
      mode: mode.value,
      ...(schedule ? { startsAt: new Date(time.value).getTime(), repeat: repeat.value } : {}),
    };
    busy = true;
    submit.disabled = true;
    start.disabled = true;
    cancel.disabled = true;
    failure.textContent = "";
    try {
      const collection = schedule ? "schedules" : "work-items";
      const created = await api(
        `/api/${collection}${editing ? `/${encodeURIComponent(item.id)}` : ""}`,
        editing ? "PUT" : "POST",
        input,
      );
      dialog.close();
      toast(t(schedule ? "scheduleSaved" : "workSaved"));
      refreshWork();
      if (runNow)
        await mutate(created.id, () => api(`/api/work-items/${created.id}/run`, "POST", {}));
      if (!schedule) {
        Object.assign(filters, { search: "", project: "", status: "", schedule: "" });
        actions.setView("tasks");
      }
    } catch (err) {
      failure.textContent = err.message;
    } finally {
      busy = false;
      submit.disabled = false;
      start.disabled = false;
      cancel.disabled = false;
    }
  });
  dialog.append(form);
  document.body.append(dialog);
  dialog.showModal();
  title.focus();
}
async function mutate(id, action) {
  if (pending.has(id)) return;
  pending.add(id);
  error = undefined;
  notify();
  try {
    await action();
    refreshWork();
  } catch (err) {
    error = err.message;
    toast(err.message);
    notify();
  } finally {
    pending.delete(id);
    notify();
  }
}
function heading(view, title, subtitle, action) {
  view.append(
    el("header", { class: "friendly-heading" }, [
      el("div", {}, [el("h1", { text: t(title) }), el("p", { class: "muted", text: t(subtitle) })]),
      el("div", { class: "friendly-actions" }, [
        button("workRefresh", refreshWork),
        ...(action ? [action] : []),
      ]),
    ]),
  );
}
function empty(view, title, hint, action) {
  view.append(
    el("section", { class: "friendly-empty" }, [
      el("h2", { text: t(title) }),
      el("p", { text: t(hint) }),
      action,
    ]),
  );
}
function openResult(task, actions) {
  if (!task.conversationId) return;
  void actions
    .openWorkspace(task.projectId, task.conversationId)
    .then(() => actions.setView(task.status === "running" ? "workspace" : "missions"));
}
function taskCard(task, actions) {
  const card = el("article", {
    class: `friendly-card task-card ${task.status}`,
    dataset: { taskId: task.id },
  });
  card.append(
    el("div", { class: "friendly-card-head" }, [
      el("h2", { text: task.title }),
      el("span", {
        class: `friendly-badge ${task.status}`,
        text: t(statusKeys[task.status] ?? "workAttention"),
      }),
    ]),
    el("p", { class: "muted", text: task.projectName || t("workProjectMissing") }),
    el("p", { class: "task-description", text: task.instructions.slice(0, 240) }),
  );
  if (task.error)
    card.append(el("p", { role: "alert", class: "friendly-error", text: errorText(task.error) }));
  if (task.scheduleId) card.append(el("span", { class: "muted", text: t("scheduleFrom") }));
  if (task.steps?.length)
    card.append(
      el("details", {}, [
        el("summary", { text: t("workSteps") }),
        el(
          "ol",
          {},
          task.steps.map((step) => el("li", { text: step })),
        ),
      ]),
    );
  const buttons = el("div", { class: "friendly-actions" });
  const blocked = pending.has(task.id) || !task.projectName;
  if (task.conversationId)
    buttons.append(
      button(
        task.status === "running" ? "taskConversation" : "taskResult",
        () => openResult(task, actions),
        { disabled: !task.projectName },
      ),
    );
  if (task.status === "running") {
    if (task.owned)
      buttons.append(
        button(
          "stop",
          () => mutate(task.id, () => api(`/api/work-items/${task.id}/stop`, "POST", {})),
          { disabled: blocked },
        ),
      );
  } else {
    if (task.owned && task.status !== "review" && task.status !== "done")
      buttons.append(
        button(
          "startTask",
          () => mutate(task.id, () => api(`/api/work-items/${task.id}/run`, "POST", {})),
          { class: "primary-btn", disabled: blocked },
        ),
      );
    if (task.owned && !task.conversationId)
      buttons.append(
        button("editTask", () => openWorkForm(actions, { task }), { disabled: blocked }),
      );
    buttons.append(
      button("copyTask", () => openWorkForm(actions, { task, duplicate: true }), {
        disabled: blocked,
      }),
    );
    if (task.owned)
      buttons.append(
        button(
          "deleteTask",
          () =>
            confirmModal({
              title: t("deleteTask"),
              body: t("workDeleteConfirm"),
              confirmLabel: t("deleteTask"),
              danger: true,
              onConfirm: () =>
                void mutate(task.id, () => api(`/api/work-items/${task.id}`, "DELETE")),
            }),
          { disabled: blocked },
        ),
      );
  }
  card.append(buttons);
  return card;
}
function renderTasks(view, actions) {
  heading(
    view,
    "workTitle",
    "workSubtitle",
    button("newTask", () => openWorkForm(actions), {
      class: "primary-btn",
      dataset: { action: "new-task" },
    }),
  );
  const search = el("input", {
    type: "search",
    placeholder: t("workSearch"),
    "aria-label": t("workSearch"),
    dataset: { focus: "task-search" },
    value: filters.search,
  });
  const project = el("select", { "aria-label": t("workProject") }, [
    el("option", { value: "", text: t("workAllProjects") }),
    ...state.projects.map((item) => el("option", { value: item.id, text: item.name })),
  ]);
  project.value = filters.project;
  const status = el("select", { "aria-label": t("workAllStatuses") }, [
    el("option", { value: "", text: t("workAllStatuses") }),
    ...Object.entries(statusKeys).map(([value, key]) => el("option", { value, text: t(key) })),
  ]);
  status.value = filters.status;
  search.addEventListener("input", () => {
    filters.search = search.value;
    renderAutomation(view.parentNode, actions);
  });
  project.addEventListener("change", () => {
    filters.project = project.value;
    notify();
  });
  status.addEventListener("change", () => {
    filters.status = status.value;
    notify();
  });
  view.append(el("div", { class: "work-filters" }, [search, project, status]));
  if (filters.schedule)
    view.append(
      button("workAllStatuses", () => {
        filters.schedule = "";
        notify();
      }),
    );
  const counts = Object.keys(statusKeys)
    .slice(0, 5)
    .map((key) => ({
      key,
      count: overview?.tasks.filter((task) => task.status === key).length ?? 0,
    }));
  view.append(
    el(
      "div",
      { class: "work-counts" },
      counts.map(({ key, count }) =>
        button(
          statusKeys[key],
          () => {
            filters.status = filters.status === key ? "" : key;
            notify();
          },
          {
            class: `work-count ${filters.status === key ? "active" : ""}`,
            "aria-pressed": filters.status === key,
            text: `${count} · ${t(statusKeys[key])}`,
          },
        ),
      ),
    ),
  );
  if (!overview) return;
  const tasks = overview.tasks.filter(
    (task) =>
      (!filters.project || task.projectId === filters.project) &&
      (!filters.status || task.status === filters.status) &&
      (!filters.schedule || task.scheduleId === filters.schedule) &&
      `${task.title} ${task.instructions} ${task.projectName}`
        .toLocaleLowerCase()
        .includes(filters.search.toLocaleLowerCase()),
  );
  if (!overview.tasks.length)
    empty(
      view,
      "workEmpty",
      "workEmptyHint",
      button("newTask", () => openWorkForm(actions), { class: "primary-btn" }),
    );
  else if (!tasks.length)
    view.append(el("p", { class: "friendly-empty", text: t("workNoResults") }));
  else
    view.append(
      el(
        "div",
        { class: "work-grid" },
        tasks.map((task) => taskCard(task, actions)),
      ),
    );
}
function renderSchedules(view, actions) {
  heading(
    view,
    "schedulesTitle",
    "scheduleSubtitle",
    button("newSchedule", () => openWorkForm(actions, { schedule: {} }), {
      class: "primary-btn",
      dataset: { action: "new-schedule" },
    }),
  );
  view.append(
    el("p", { class: "friendly-notice", text: t("scheduleOpenHint") }),
    el("p", { class: "muted", text: t("schedulePauseHint") }),
  );
  if (!overview) return;
  if (overview.schedulerError)
    view.append(
      el("p", { role: "alert", class: "friendly-error", text: errorText(overview.schedulerError) }),
    );
  if (!overview.schedules.length) {
    empty(
      view,
      "scheduleEmpty",
      "scheduleEmptyHint",
      button("newSchedule", () => openWorkForm(actions, { schedule: {} }), {
        class: "primary-btn",
      }),
    );
    return;
  }
  const grid = el("div", { class: "work-grid" });
  for (const item of overview.schedules) {
    const card = el("article", {
      class: "friendly-card schedule-card",
      dataset: { scheduleId: item.id },
    });
    const finished = !item.nextRunAt && !!item.lastRunAt;
    card.append(
      el("div", { class: "friendly-card-head" }, [
        el("h2", { text: item.title }),
        el("span", {
          class: "friendly-badge",
          text: t(
            finished ? "scheduleFinished" : item.enabled ? "scheduleActive" : "schedulePaused",
          ),
        }),
      ]),
      el("p", {
        class: "muted",
        text: `${item.projectName || t("workProjectMissing")} · ${t(`repeat${item.repeat}`)}`,
      }),
      el("p", { text: item.instructions.slice(0, 240) }),
      el("p", {
        text: `${t("scheduleNext")}: ${item.nextRunAt ? new Date(item.nextRunAt).toLocaleString(getLang() === "pt" ? "pt-BR" : "en-US") : "—"}`,
      }),
      el("p", { class: "muted", text: `${t("scheduleTimeZone")}: ${item.timeZone}` }),
    );
    if (item.lastRunAt)
      card.append(
        el("p", {
          class: "muted",
          text: `${t("scheduleLast")}: ${new Date(item.lastRunAt).toLocaleString()}`,
        }),
      );
    if (item.error || item.waiting)
      card.append(
        el("p", {
          role: "status",
          class: "friendly-error",
          text: errorText(item.error ?? item.waiting),
        }),
      );
    card.append(
      el("div", { class: "friendly-actions" }, [
        ...(!finished
          ? [
              button(
                item.enabled ? "schedulePause" : "scheduleResume",
                () =>
                  mutate(item.id, () =>
                    api(`/api/schedules/${item.id}`, "PATCH", { enabled: !item.enabled }),
                  ),
                { disabled: pending.has(item.id) },
              ),
            ]
          : []),
        button("scheduleEdit", () => openWorkForm(actions, { schedule: item })),
        button("scheduleHistory", () => {
          filters.schedule = item.id;
          filters.search = "";
          filters.status = "";
          filters.project = "";
          actions.setView("tasks");
        }),
        button("scheduleDelete", () =>
          confirmModal({
            title: t("scheduleDelete"),
            body: t("scheduleDeleteConfirm"),
            confirmLabel: t("scheduleDelete"),
            danger: true,
            onConfirm: () => void mutate(item.id, () => api(`/api/schedules/${item.id}`, "DELETE")),
          }),
        ),
      ]),
    );
    grid.append(card);
  }
  view.append(grid);
}
function renderAssistants(view, actions) {
  heading(
    view,
    "agentsTitle",
    "assistantsSubtitle",
    button("assistantSettings", actions.openSettings, { class: "primary-btn" }),
  );
  if (!assistants) return;
  const grid = el("div", { class: "assistant-grid" });
  for (const provider of assistants.providers) {
    const card = el("article", {
      class: "friendly-card assistant-card",
      dataset: { provider: provider.id },
    });
    card.append(
      el("div", { class: "friendly-card-head" }, [
        el("h2", { text: provider.id === "claude" ? "Claude" : "Codex" }),
        el("span", {
          class: `friendly-badge ${provider.connected ? "done" : "attention"}`,
          text: t(provider.connected ? "assistantConnected" : "assistantDisconnected"),
        }),
      ]),
      el("p", { text: t(provider.id === "claude" ? "assistantClaudeRole" : "assistantCodexRole") }),
    );
    if (provider.account) card.append(el("p", { class: "muted", text: provider.account }));
    card.append(
      button(provider.connected ? "assistantManage" : "assistantConnect", actions.openSettings, {
        class: provider.connected ? "ghost-btn" : "primary-btn",
      }),
    );
    for (const active of provider.active)
      card.append(
        button(
          "taskConversation",
          () => void actions.openWorkspace(active.projectId, active.conversationId),
          { text: `${t("workRunning")}: ${active.title}` },
        ),
      );
    const recent = el("details", {}, [el("summary", { text: t("assistantRecent") })]);
    if (!provider.recent.length)
      recent.append(el("p", { class: "muted", text: t("assistantNoRuns") }));
    else
      for (const item of provider.recent)
        recent.append(
          button(
            "taskResult",
            () => void actions.openWorkspace(item.projectId, item.conversationId),
            { text: `${item.projectName} · ${item.title}` },
          ),
        );
    card.append(
      recent,
      el("details", {}, [
        el("summary", { text: t("workTechnical") }),
        el("p", { text: `${t("assistantExecutions")}: ${provider.executions}` }),
        el("p", { text: `${t("assistantCost")}: ~US$ ${provider.costUsd.toFixed(4)}` }),
      ]),
    );
    grid.append(card);
  }
  grid.append(
    el("article", { class: "friendly-card assistant-card" }, [
      el("h2", { text: t("assistantRouterTitle") }),
      el("p", { text: t("assistantRouterRole") }),
      el("span", {
        class: "friendly-badge",
        text: t(assistants.routerConfigured ? "assistantRouterEnhanced" : "assistantRouterBasic"),
      }),
      button("assistantSettings", actions.openSettings),
    ]),
  );
  view.append(grid);
}
export function renderAutomation(root, actions) {
  const focused = root.contains(document.activeElement) ? document.activeElement : null;
  const focusKey = focused?.dataset.focus;
  const cursor = focused?.selectionStart;
  clear(root);
  const view = el("div", { class: "view automation-view" });
  root.append(view);
  if (state.view === "agents") renderAssistants(view, actions);
  else if (state.view === "tasks") renderTasks(view, actions);
  else renderSchedules(view, actions);
  const failure = state.view === "agents" ? (assistantError ?? error) : error;
  if (failure)
    view.append(
      el("div", { class: "friendly-notice", role: "alert" }, [
        el("p", { text: failure }),
        button("workRetry", refreshWork),
        ...(state.credentials?.claude?.mode === "none"
          ? [button("assistantConnect", actions.openSettings)]
          : []),
      ]),
    );
  else if ((state.view === "agents" && !assistants) || (state.view !== "agents" && !overview))
    view.append(el("p", { role: "status", text: t("workLoading") }));
  if (!state.projects.length && state.view !== "agents")
    view.prepend(
      el("div", { class: "friendly-notice" }, [
        el("p", { text: t("workNeedProject") }),
        button("openProjectWizard", actions.openNewProject),
      ]),
    );
  if (focusKey) {
    const input = view.querySelector(`[data-focus="${focusKey}"]`);
    input?.focus();
    if (cursor !== null && input?.setSelectionRange) input.setSelectionRange(cursor, cursor);
  }
}
