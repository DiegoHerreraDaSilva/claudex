import { el } from "../lib/dom.js";

export function toast(text, kind = "info", ms = 3400) {
  const host = document.getElementById("toasts");
  if (!host) return;
  const node = el("div", { class: `toast ${kind}`, text });
  host.appendChild(node);
  requestAnimationFrame(() => node.classList.add("show"));
  setTimeout(() => {
    node.classList.remove("show");
    setTimeout(() => node.remove(), 220);
  }, ms);
}
