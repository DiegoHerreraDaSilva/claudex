import { el } from "../lib/dom.js";

/**
 * Lightweight confirm dialog appended to <body>. Resolves nothing; calls the
 * matching callback. Used for interrupting a mission and destructive actions.
 */
export function confirmModal(options) {
  const { title, body, confirmLabel, cancelLabel, danger = false, onConfirm } = options;
  const overlay = el("div", { class: "modal" });
  const card = el("div", { class: "modal-card confirm-card" });

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

  const head = el("div", { class: "modal-head", text: title });
  const bodyEl = el("div", { class: "modal-body", text: body });
  const foot = el("div", { class: "modal-foot" });
  foot.append(
    el("button", { class: "ghost-btn", text: cancelLabel, onclick: close }),
    el("button", {
      class: `primary-btn${danger ? " danger" : ""}`,
      text: confirmLabel,
      onclick: () => {
        close();
        onConfirm?.();
      },
    }),
  );
  card.append(head, bodyEl, foot);
  overlay.appendChild(card);
  overlay.addEventListener("mousedown", (event) => {
    if (event.target === overlay) close();
  });
  document.addEventListener("keydown", onKey);
  document.body.appendChild(overlay);
  return close;
}
