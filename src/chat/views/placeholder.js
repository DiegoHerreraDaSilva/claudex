import { clear, el } from "../lib/dom.js";
import { t } from "../lib/i18n.js";

export function renderPlaceholder(root, titleKey) {
  clear(root);
  const view = el("div", { class: "view placeholder" });
  view.append(
    el("div", { class: "placeholder-title", text: t(titleKey) }),
    el("div", { class: "empty-card" }, [
      el("div", { class: "empty-title", text: t("comingSoon") }),
    ]),
  );
  root.appendChild(view);
}
