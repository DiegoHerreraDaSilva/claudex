import { el } from "../lib/dom.js";
import { t } from "../lib/i18n.js";
import { request } from "../lib/api.js";
import { currentConversation, isRunning, notify, state } from "../lib/store.js";
import { toast } from "./toast.js";
const operations = new Map();
function safeLink(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password ? value : null;
  } catch {
    return null;
  }
}
export function renderGitHub(actions) {
  const summary = state.missionSummary;
  const section = el("section", {
    class: "mc-section github-section",
    "aria-label": t("githubTitle"),
  });
  section.append(el("h2", { class: "section-label", text: t("githubTitle") }));
  if (!summary) {
    section.append(el("p", { class: "muted", text: t("prReadyHint") }));
    return section;
  }
  const operation = operations.get(summary.id);
  const blocked =
    isRunning(summary.id) || currentConversation()?.autonomy === "manual" || operation?.busy;
  const buttons = el("div", { class: "completion-actions" });
  buttons.append(
    el("button", {
      class: "ghost-btn pr-prepare",
      text: t(summary.pullRequest ? "preparePrAgain" : "preparePr"),
      disabled: blocked || summary.status !== "ready" || summary.verification.some((run) => ["failed", "running"].includes(run.status)),
      onclick: () => preparePullRequest(actions),
    }),
  );
  if (summary.pullRequest) {
    const pr = summary.pullRequest;
    const url = safeLink(pr.url);
    section.append(
      el("div", { class: "github-pr" }, [
        url
          ? el("a", {
              href: url,
              target: "_blank",
              rel: "noopener noreferrer",
              text: `#${pr.number} · ${pr.title}`,
            })
          : el("span", { text: pr.title }),
        el("span", {
          class: "muted",
          text: `${pr.isDraft ? t("prDraft") : t("prOpen")} · ${t(`prState${pr.state}`)}`,
        }),
      ]),
    );
    buttons.append(
      el("button", {
        class: "ghost-btn ci-refresh",
        text: t("refreshCi"),
        disabled: blocked,
        onclick: () => refreshChecks(actions),
      }),
    );
  }
  section.append(buttons);
  if (operation?.error)
    section.append(el("p", { role: "alert", class: "github-error", text: operation.error }));
  if (operation?.busy) section.append(el("p", { role: "status", text: t("githubWorking") }));
  if (operation?.error) return section;
  const ci = summary.ci;
  if (ci) {
    section.append(el("p", { class: `ci-status ${ci.status}`, text: t(`ci${ci.status}`) }));
    section.append(
      el("p", {
        class: "muted",
        text: `${t("ciCheckedAt")}: ${new Date(ci.checkedAt).toLocaleString()}`,
      }),
    );
    if (!ci.headMatchesReview || ci.pullRequest.headRefOid !== summary.head)
      section.append(el("p", { role: "alert", class: "github-error", text: t("ciWrongHead") }));
    for (const check of ci.checks) {
      const url = safeLink(check.link);
      section.append(
        el("div", { class: "ci-check" }, [
          url
            ? el("a", { href: url, target: "_blank", rel: "noopener noreferrer", text: check.name })
            : el("span", { text: check.name }),
          el("span", { text: t(`ciBucket${check.bucket}`) }),
        ]),
      );
    }
  } else
    section.append(
      el("p", { class: "muted", text: t(summary.pullRequest ? "ciNotFetched" : "prReadyHint") }),
    );
  return section;
}
export async function refreshChecks(actions) {
  const id = state.currentConversationId;
  if (!id || operations.get(id)?.busy) return;
  operations.set(id, { busy: true });
  notify();
  try {
    await request(`/api/missions/${encodeURIComponent(id)}/checks`);
    await actions.reloadMissionSummary();
    operations.set(id, {});
  } catch (error) {
    operations.set(id, { error: error.message });
  }
  notify();
}
export async function preparePullRequest(actions) {
  const id = state.currentConversationId;
  if (!id || operations.get(id)?.busy) return;
  operations.set(id, { busy: true });
  notify();
  try {
    const preview = await request(`/api/missions/${encodeURIComponent(id)}/pr/preview`);
    operations.set(id, {});
    notify();
    showPreview(id, preview, actions);
  } catch (error) {
    operations.set(id, { error: error.message });
    notify();
  }
}
function showPreview(id, preview, actions) {
  const previousFocus = document.activeElement;
  const dialog = el("dialog", {
    class: "permission-dialog pr-dialog",
    "aria-labelledby": "pr-title",
  });
  const title = el("input", {
    value: preview.title,
    maxlength: 120,
    required: true,
    "aria-label": t("prTitle"),
  });
  const body = el("textarea", {
    value: preview.body,
    maxlength: 20000,
    rows: 10,
    "aria-label": t("prBody"),
  });
  body.value = preview.body;
  const draft = el("input", { type: "checkbox", checked: preview.draft });
  const feedback = el("p", { role: "alert", class: "github-error" });
  const cancel = el("button", {
    class: "ghost-btn",
    type: "button",
    text: t("close"),
    onclick: close,
  });
  const submit = el("button", {
    class: "primary-btn pr-publish",
    type: "submit",
    text: t("publishPr"),
    disabled: !preview.authenticated,
  });
  let publishing = false;
  const form = el(
    "form",
    {
      onsubmit: async (event) => {
        event.preventDefault();
        if (publishing) return;
        publishing = true;
        submit.disabled = cancel.disabled = true;
        operations.set(id, { busy: true });
        notify();
        try {
          await request(`/api/missions/${encodeURIComponent(id)}/pr`, "POST", {
            expectedHead: preview.expectedHead,
            title: title.value.trim(),
            body: body.value,
            draft: draft.checked,
          });
          close();
          await actions.reloadMissionSummary();
          operations.set(id, {});
          toast(t("prPublished"));
        } catch (error) {
          feedback.textContent = error.message;
          submit.disabled = !preview.authenticated;
          cancel.disabled = false;
          publishing = false;
          operations.set(id, { error: error.message });
        }
        notify();
      },
    },
    [
      el("label", { text: t("prTitle") }),
      title,
      el("label", { text: t("prBody") }),
      body,
      el("label", { class: "pr-draft" }, [draft, t("prDraft")]),
      feedback,
      el("div", { class: "completion-actions" }, [cancel, submit]),
    ],
  );
  dialog.append(
    el("h2", { id: "pr-title", text: t("preparePr") }),
    el("p", { text: `${preview.repo} · ${preview.branch} → ${preview.baseBranch}` }),
    el("code", { text: preview.expectedHead }),
    el("p", { class: "muted", text: t("publishPrHint") }),
    el("p", { class: "muted", text: t("reusePrHint") }),
    ...(!preview.authenticated ? [el("p", { role: "alert", text: t("githubAuthHint") })] : []),
    form,
  );
  function close() {
    dialog.close();
    dialog.remove();
    previousFocus?.focus();
  }
  dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    if (!publishing) close();
  });
  document.body.append(dialog);
  dialog.showModal();
  title.focus();
}
