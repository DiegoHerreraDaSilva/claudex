import { marked } from "./vendor/marked.js";
import DOMPurify from "./vendor/purify.js";

export function renderMarkdown(text) {
  const content = document.createElement("div");
  content.className = "markdown-content";
  const html = marked.parse(text, { gfm: true, breaks: true, async: false });
  content.append(
    DOMPurify.sanitize(html, {
      RETURN_DOM_FRAGMENT: true,
      ALLOWED_TAGS: [
        "p",
        "br",
        "strong",
        "em",
        "del",
        "a",
        "h1",
        "h2",
        "h3",
        "h4",
        "h5",
        "h6",
        "ul",
        "ol",
        "li",
        "blockquote",
        "pre",
        "code",
        "hr",
        "table",
        "thead",
        "tbody",
        "tr",
        "th",
        "td",
      ],
      ALLOWED_ATTR: ["href", "title", "start"],
    }),
  );
  for (const link of content.querySelectorAll("a")) {
    const href = link.getAttribute("href") || "";
    if (!/^(https?:\/\/|mailto:)/i.test(href)) link.removeAttribute("href");
    else {
      link.target = "_blank";
      link.rel = "noopener noreferrer";
    }
  }
  for (const table of content.querySelectorAll("table")) {
    const wrapper = document.createElement("div");
    wrapper.className = "markdown-table";
    wrapper.tabIndex = 0;
    table.replaceWith(wrapper);
    wrapper.append(table);
  }
  for (const pre of content.querySelectorAll("pre")) {
    const code = pre.querySelector("code");
    if (!code) continue;
    const block = document.createElement("div");
    block.className = "code-block";
    const toolbar = document.createElement("div");
    toolbar.className = "code-toolbar";
    const label = document.createElement("span");
    label.textContent = "Código";
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = "Copiar";
    button.setAttribute("aria-label", "Copiar código");
    button.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(code.textContent);
        button.textContent = "Copiado";
      } catch {
        button.textContent = "Não foi possível copiar";
      }
      setTimeout(() => {
        button.textContent = "Copiar";
      }, 2000);
    });
    toolbar.append(label, button);
    pre.replaceWith(block);
    block.append(toolbar, pre);
  }
  return content;
}
