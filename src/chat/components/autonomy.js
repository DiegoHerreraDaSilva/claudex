import { el } from "../lib/dom.js";
import { t } from "../lib/i18n.js";
import { request } from "../lib/api.js";
import { currentConversation, currentProject, isRunning, state } from "../lib/store.js";
import { toast } from "./toast.js";
const modes = ["manual", "assisted", "autonomous"];
export function autonomySelector(actions) {
  const conversation = currentConversation();
  const select = el(
    "select",
    {
      class: "autonomy-select",
      "aria-label": t("autonomy"),
      disabled: !conversation || isRunning(conversation.id),
      onchange: (event) => actions.setAutonomy(event.target.value),
    },
    modes.map((mode) => el("option", { value: mode, text: t(`autonomy${mode}`) })),
  );
  select.value = conversation?.autonomy ?? "autonomous";
  return select;
}
export async function setAutonomy(mode, reload) {
  const project = currentProject();
  const conversation = currentConversation();
  if (!project || !conversation || isRunning(conversation.id)) return;
  try {
    await request(
      `/api/projects/${encodeURIComponent(project.id)}/conversations/${encodeURIComponent(conversation.id)}/autonomy`,
      "PUT",
      { mode },
    );
    await reload();
  } catch (error) {
    toast(error.message);
    await reload();
  }
}
export function permissionMatrix() {
  const table = el("table", { class: "permission-matrix" });
  table.append(
    el("thead", {}, [
      el("tr", {}, [
        el("th", { text: t("autonomy") }),
        ...modes.map((mode) => el("th", { text: t(`autonomy${mode}`) })),
      ]),
    ]),
  );
  const body = el("tbody");
  for (const [label, permissions] of [
    ["permissionRead", [1, 1, 1]],
    ["permissionWrite", [0, 1, 1]],
    ["permissionExternal", [0, 2, 1]],
  ])
    body.append(
      el("tr", {}, [
        el("th", { text: t(label), scope: "row" }),
        ...permissions.map((value) =>
          el("td", { text: t(["permissionBlocked", "permissionAllowed", "permissionAsk"][value]) }),
        ),
      ]),
    );
  table.append(body);
  return table;
}
const pending = new Map();
let dialog;
let shown;
let previousFocus;
export function permissionSnapshot(requests) {
  pending.clear();
  for (const request of requests) pending.set(request.id, request);
  renderPermission();
}
export function permissionNotice(notice) {
  if (notice.type === "requested") pending.set(notice.request.id, notice.request);
  else pending.delete(notice.id);
  renderPermission();
}
function renderPermission() {
  const next = pending.values().next().value;
  if (shown === next?.id) return;
  if (dialog) {
    dialog.close();
    dialog.remove();
    dialog = null;
    previousFocus?.focus();
  }
  shown = next?.id;
  if (!next) return;
  previousFocus = document.activeElement;
  dialog = el("dialog", { class: "permission-dialog", "aria-labelledby": "permission-title" });
  const deny = el("button", {
    class: "ghost-btn",
    text: t("permissionDeny"),
    onclick: () => decide(false),
  });
  const approve = el("button", {
    class: "primary-btn",
    text: t("permissionApprove"),
    onclick: () => decide(true),
  });
  const project = state.projects.find((item) => item.id === next.projectId);
  const conversation = project?.conversations.find((item) => item.id === next.conversationId);
  dialog.append(
    el("h2", { id: "permission-title", text: t("permissionTitle") }),
    el("p", {
      text: `${project?.name ?? next.projectId} · ${conversation?.name ?? next.conversationId}`,
    }),
    el("p", { text: `${next.tool} · ${t(`permissionAction${next.action}`)}` }),
    el("pre", { text: next.detail }),
    el("p", { class: "muted", text: t("permissionOnce") }),
    el("div", { class: "header-actions" }, [deny, approve]),
  );
  dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    decide(false);
  });
  document.body.append(dialog);
  dialog.showModal();
  deny.focus();
  async function decide(approved) {
    deny.disabled = approve.disabled = true;
    try {
      await request(`/api/permissions/${encodeURIComponent(next.id)}`, "POST", { approved });
      pending.delete(next.id);
      renderPermission();
    } catch (error) {
      toast(error.message);
      pending.delete(next.id);
      renderPermission();
    }
  }
}
