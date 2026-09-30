import { el } from "../lib/dom.js";
import { t } from "../lib/i18n.js";
import { request } from "../lib/api.js";
import { currentConversation, isRunning, notify, state } from "../lib/store.js";
const operations = new Map();
export function renderBrowserQA(actions) {
  const summary = state.missionSummary;
  const section = el(
    "section",
    { class: "mc-section browser-qa-section", "aria-label": t("browserQa") },
    [
      el("h2", { class: "section-label", text: t("browserQa") }),
      el("p", { class: "muted", text: t("browserQaHint") }),
    ],
  );
  if (!summary) return section;
  const operation = operations.get(summary.id);
  const blocked =
    isRunning(summary.id) ||
    currentConversation()?.autonomy === "manual" ||
    operation?.busy ||
    !["ready", "failed"].includes(summary.status) ||
    !summary.head;
  section.append(
    el("button", {
      class: "ghost-btn browser-qa-open",
      text: t("browserQaRun"),
      disabled: blocked,
      onclick: () => openBrowserQA(summary, actions),
    }),
  );
  if (operation?.error) section.append(el("p", { role: "alert", text: operation.error }));
  if (operation?.busy) section.append(el("p", { role: "status", text: t("browserQaWorking") }));
  const run = summary.verification.find((run) => run.kind === "browser");
  if (run) {
    section.append(el("strong", { class: `review-verdict ${run.status}`, text: t(run.status) }));
    section.append(
      el("pre", {
        class: "verification-output",
        text: [run.summary, run.output].filter(Boolean).join("\n\n"),
      }),
    );
    const expected = `/api/missions/${encodeURIComponent(summary.id)}/browser-qa/${run.id}/screenshot`;
    if (run.screenshot === expected && /^[a-f0-9-]{36}$/.test(run.id)) {
      section.append(
        el("a", {
          class: "browser-qa-capture",
          href: expected,
          target: "_blank",
          rel: "noopener noreferrer",
          text: t("browserQaCapture"),
        }),
      );
    }
  }
  return section;
}
function openBrowserQA(summary, actions) {
  const dialog = el("dialog", {
    class: "pr-dialog browser-qa-dialog",
    "aria-label": t("browserQa"),
  });
  const form = el("form", { class: "pr-form" });
  const url = el("input", {
    type: "url",
    required: true,
    maxlength: 2000,
    placeholder: "http://localhost:3000",
    "aria-label": t("browserQaUrl"),
  });
  const channel = el("select", { "aria-label": t("browserQaBrowser") }, [
    el("option", { value: "chrome", text: "Google Chrome" }),
    el("option", { value: "msedge", text: "Microsoft Edge" }),
  ]);
  const close = () => {
    dialog.close();
    dialog.remove();
  };
  const run = el("button", { class: "primary-btn", type: "submit", text: t("browserQaRun") });
  form.append(
    el("h2", { text: t("browserQa") }),
    el("p", { text: t("browserQaHint") }),
    el("label", {}, [t("browserQaUrl"), url]),
    el("label", {}, [t("browserQaBrowser"), channel]),
    el("div", { class: "completion-actions" }, [
      run,
      el("button", { class: "ghost-btn", type: "button", text: t("cancel"), onclick: close }),
    ]),
  );
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const input = { url: url.value.trim(), channel: channel.value, expectedHead: summary.head };
    close();
    operations.set(summary.id, { busy: true });
    notify();
    try {
      await request(`/api/missions/${encodeURIComponent(summary.id)}/browser-qa`, "POST", input);
      await actions.reloadMissionSummary();
      operations.delete(summary.id);
    } catch (error) {
      operations.set(summary.id, { error: error.message });
    }
    notify();
  });
  dialog.addEventListener("close", () => dialog.remove());
  dialog.append(form);
  document.body.append(dialog);
  dialog.showModal();
  url.focus();
}
