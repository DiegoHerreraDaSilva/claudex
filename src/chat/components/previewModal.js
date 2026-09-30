import { el } from "../lib/dom.js";
import { t } from "../lib/i18n.js";

const IMPACT_PCT = { low: 34, medium: 66, high: 100 };

export function previewModal(preview, text, onExecute) {
  const overlay = el("div", { class: "modal" });
  const card = el("div", { class: "modal-card preview-card" });

  const close = () => {
    overlay.remove();
    document.removeEventListener("keydown", onKey);
  };
  const onKey = (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
    }
  };

  card.appendChild(
    el("div", { class: "modal-head" }, [
      el("span", { text: t("previewTitle") }),
      el("button", { class: "ghost-btn", text: t("close"), onclick: close }),
    ]),
  );

  const body = el("div", { class: "modal-body preview-body" });

  body.appendChild(el("div", { class: "preview-goal", text: text }));

  const stats = el("div", { class: "preview-stats" });
  stats.append(
    el("div", { class: "preview-stat" }, [
      el("div", { class: "preview-stat-label", text: t("previewImpact") }),
      el("div", { class: "preview-stat-value", text: t(`impact${cap(preview.impact)}`) }),
      el("div", { class: "bar" }, [el("i", { style: { width: `${IMPACT_PCT[preview.impact] ?? 50}%` } })]),
    ]),
    el("div", { class: "preview-stat" }, [
      el("div", { class: "preview-stat-label", text: t("previewFiles") }),
      el("div", { class: "preview-stat-value", text: `~${preview.estimatedFiles}` }),
    ]),
    el("div", { class: "preview-stat" }, [
      el("div", { class: "preview-stat-label", text: t("previewSubtasks") }),
      el("div", { class: "preview-stat-value", text: String((preview.subtasks ?? []).length) }),
    ]),
    el("div", { class: "preview-stat" }, [
      el("div", { class: "preview-stat-label", text: t("previewTime") }),
      el("div", { class: "preview-stat-value", text: `~${preview.estimatedMinutes} min` }),
    ]),
  );
  body.appendChild(stats);

  if ((preview.subtasks ?? []).length > 0) {
    const list = el("div", { class: "preview-list" });
    list.appendChild(el("div", { class: "preview-list-label", text: t("previewSubtasks") }));
    preview.subtasks.forEach((item, index) => {
      list.appendChild(el("div", { class: "preview-list-item", text: `${index + 1}. ${item}` }));
    });
    body.appendChild(list);
  }

  const route = el("div", { class: "preview-route" });
  route.appendChild(el("div", { class: "preview-list-label", text: t("previewRoute") }));
  const chain = el("div", { class: "route-chain" });
  (preview.agents ?? []).forEach((agent, index) => {
    if (index > 0) chain.appendChild(el("span", { class: "route-arrow", text: "→" }));
    chain.appendChild(el("span", { class: "route-agent", text: agent }));
  });
  route.appendChild(chain);
  body.appendChild(route);

  card.appendChild(body);

  const foot = el("div", { class: "modal-foot" });
  foot.append(
    el("button", { class: "ghost-btn", text: t("previewEdit"), onclick: close }),
    el("button", {
      class: "primary-btn",
      text: t("previewExecute"),
      onclick: () => {
        close();
        onExecute?.();
      },
    }),
  );
  card.appendChild(foot);

  overlay.appendChild(card);
  overlay.addEventListener("mousedown", (event) => {
    if (event.target === overlay) close();
  });
  document.addEventListener("keydown", onKey);
  document.body.appendChild(overlay);
  return close;
}

function cap(value) {
  return String(value ?? "").charAt(0).toUpperCase() + String(value ?? "").slice(1);
}
