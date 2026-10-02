import { visibleEvents } from "./activity.js";
import { renderMarkdown } from "./markdown.js";
import { renderAnsi } from "./ansi.js";
const statuses = {
  routing: "Roteando",
  running: "Trabalhando",
  stopping: "Parando",
  completed: "Concluído",
  failed: "Falhou",
  stopped: "Interrompido",
};
export const statusText = (status) => statuses[status] || status;
export function sessionTitle(session) {
  const model = (session.agent || "").split(":").slice(1).join(":");
  const role =
    session.agentRole ||
    (session.agent?.includes("opus")
      ? "Planner"
      : session.agent?.startsWith("codex:")
        ? "Complex"
        : "Simple");
  return session.agent
    ? `${role} · ${model}${session.role === "helper" ? " · Colaborador" : ""}`
    : "Jev escolhendo…";
}
function element(tag, className, text) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}
export function renderProjects(container, projects, selected, select, remove) {
  container.replaceChildren();
  if (!projects.length) {
    container.append(element("p", "muted", "Adicione sua primeira pasta usando +."));
    return;
  }
  for (const p of projects) {
    const row = element("div", "project-row");
    const b = element("button", "project-select");
    b.type = "button";
    b.setAttribute("aria-current", String(p.id === selected));
    b.title = p.rootPath;
    b.append(
      element("strong", "", p.name),
      element(
        "small",
        "",
        p.routing || p.sessions.some((s) => ["routing", "running", "stopping"].includes(s.status))
          ? "Agente trabalhando"
          : `${p.sessions.length} ${p.sessions.length === 1 ? "sessão" : "sessões"}`,
      ),
    );
    b.addEventListener("click", () => select(p.id));
    const close = element("button", "project-remove", "×");
    close.type = "button";
    close.setAttribute("aria-label", `Remover ${p.name}`);
    close.addEventListener("click", () => void remove(p.id));
    row.append(b, close);
    container.append(row);
  }
}
export function renderTabs(container, sessions, selected, select, selectTerminal, closeSession) {
  container.replaceChildren();
  if (!sessions.length) {
    container.append(element("span", "no-sessions", "Suas sessões de agentes aparecerão aqui"));
    return;
  }
  sessions.forEach((s, index) => {
    const b = element("button", "session-tab");
    b.type = "button";
    b.role = "tab";
    b.id = `tab-${s.id}`;
    b.setAttribute("aria-selected", String(s.id === selected));
    b.setAttribute("aria-controls", "activity");
    b.tabIndex = s.id === selected ? 0 : -1;
    b.title = `${s.agent}\n${s.text}`;
    b.append(
      element("strong", "", sessionTitle(s)),
      element(
        "small",
        "",
        `${s.role === "helper" ? "Colaborador · " : ""}${s.requestCount ?? 1} ${(s.requestCount ?? 1) === 1 ? "pedido" : "pedidos"} · ${statuses[s.status]}`,
      ),
    );
    b.addEventListener("click", () => select(s.id));
    b.addEventListener("keydown", (event) => {
      const direction = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
      if (direction) {
        event.preventDefault();
        if (selectTerminal && (index + direction < 0 || index + direction >= sessions.length)) {
          selectTerminal();
          document.getElementById("terminal-tab")?.focus();
          return;
        }
        const next = sessions[(index + direction + sessions.length) % sessions.length];
        select(next.id);
        document.getElementById(`tab-${next.id}`)?.focus();
      }
    });
    const wrapper = element("div", "session-tab-wrap");
    wrapper.append(b);
    if (closeSession) {
      const close = element("button", "session-close", "×");
      close.type = "button";
      close.setAttribute("aria-label", `Fechar ${sessionTitle(s)}`);
      close.title = "Fechar sessão";
      close.addEventListener("click", () => void closeSession(s.id));
      wrapper.append(close);
    }
    container.append(wrapper);
  });
}
export function renderActivity(container, session, preserveScroll = false) {
  const pinned =
    !preserveScroll || container.scrollHeight - container.scrollTop - container.clientHeight < 80;
  const previous = container.scrollTop;
  container.replaceChildren();
  if (!session) {
    const empty = element("div", "empty");
    empty.append(
      element("div", "empty-mark", "↗"),
      element("h3", "", "Comece com um pedido"),
      element("p", "", "Adicione uma pasta, descreva o que precisa e acompanhe o agente por aqui."),
    );
    container.append(empty);
    container.removeAttribute("aria-labelledby");
    return;
  }
  container.setAttribute("aria-labelledby", `tab-${session.id}`);
  const labels = {
    user: "Seu pedido",
    routing: "Roteamento",
    assistant: "Agente",
    tool: "Ferramenta",
    result: "Resultado",
    error: "Erro",
    status: "Status",
  };
  for (const event of visibleEvents(session.events)) {
    const article = element("article", `event event-${event.kind}`);
    const heading = element("div", "event-heading");
    heading.append(
      element("strong", "", labels[event.kind]),
      element(
        "time",
        "",
        new Date(event.at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }),
      ),
    );
    let body;
    if (event.kind === "assistant" || event.kind === "result") body = renderMarkdown(event.text);
    else {
      body = element(event.kind === "tool" ? "pre" : "p", "", event.text);
      if (event.kind === "tool") renderAnsi(body, event.text);
    }
    article.append(heading, body);
    if (event.attachments?.length) {
      const files = element("div", "attachment-list history-attachments");
      for (const file of event.attachments) {
        const link = element("a", "attachment-chip");
        link.href = `/api/projects/${encodeURIComponent(session.projectId)}/attachments/${encodeURIComponent(file.id)}`;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        if (file.mimeType.startsWith("image/")) {
          const preview = document.createElement("img");
          preview.src = link.href;
          preview.alt = file.name;
          link.append(preview);
        }
        link.append(element("span", "", file.name));
        files.append(link);
      }
      article.append(files);
    }
    container.append(article);
  }
  if (session.status === "routing")
    container.append(element("p", "muted", "Escolhendo o melhor modelo para seu pedido…"));
  if (session.status === "running")
    container.append(element("p", "muted", "O agente está trabalhando na sua pasta…"));
  container.scrollTop = pinned ? container.scrollHeight : previous;
}
