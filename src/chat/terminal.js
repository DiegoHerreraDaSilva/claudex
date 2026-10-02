import { api } from "./api.js";
import { renderAnsi } from "./ansi.js";
const $ = (id) => document.getElementById(id);

export function setupTerminal(onSelect, onError) {
  const states = new Map(),
    histories = new Map();
  let project = null,
    visible = false,
    historyIndex = 0;
  function render() {
    const state = states.get(project?.id);
    $("terminal-path").textContent = project?.rootPath || "Escolha uma pasta à esquerda";
    $("terminal-status").textContent = state?.running
      ? `${state.shell} · Aberto`
      : "Terminal encerrado";
    const output = $("terminal-output");
    const pinned = output.scrollHeight - output.scrollTop - output.clientHeight < 80;
    const previous = output.scrollTop;
    renderAnsi(output, state?.output || "Abra o terminal e digite um comando abaixo.");
    output.scrollTop = pinned ? output.scrollHeight : previous;
    $("terminal-command").disabled = !state?.running;
    $("terminal-send").disabled = !state?.running;
    $("terminal-stop").disabled = !state?.running;
    $("terminal-open").hidden = Boolean(state?.running);
  }
  async function action(action, input) {
    const id = project?.id;
    if (!id) return;
    try {
      states.set(id, await api(`/api/projects/${id}/terminal`, "POST", { action, input }));
      if (project?.id === id) render();
    } catch (error) {
      onError(error.message);
    }
  }
  $("terminal-tab").addEventListener("click", () => onSelect());
  $("terminal-tab").addEventListener("keydown", (event) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    const tabs = [...document.querySelectorAll("#tabs [role=tab]")];
    const tab = event.key === "ArrowLeft" ? tabs.at(-1) : tabs[0];
    if (tab) {
      event.preventDefault();
      tab.click();
      tab.focus();
    }
  });
  $("terminal-open").addEventListener("click", () => void action("open"));
  $("terminal-stop").addEventListener("click", () => void action("stop"));
  $("terminal-clear").addEventListener("click", () => void action("clear"));
  $("terminal-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const input = $("terminal-command").value;
    if (!input.trim()) return;
    const history = histories.get(project.id) || [];
    history.push(input);
    if (history.length > 100) history.shift();
    histories.set(project.id, history);
    historyIndex = history.length;
    $("terminal-command").value = "";
    await action("write", input + "\n");
    $("terminal-command").focus();
  });
  $("terminal-command").addEventListener("keydown", (event) => {
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    event.preventDefault();
    const history = histories.get(project?.id) || [];
    historyIndex = Math.max(
      0,
      Math.min(history.length, historyIndex + (event.key === "ArrowUp" ? -1 : 1)),
    );
    $("terminal-command").value = history[historyIndex] || "";
  });
  return {
    update(p, selected) {
      const changed = project?.id !== p?.id,
        opened = selected && !visible;
      project = p;
      visible = selected;
      $("terminal-tab").disabled = !p;
      $("terminal-tab").setAttribute("aria-selected", String(selected));
      $("terminal-panel").hidden = !selected;
      $("activity").hidden = selected;
      $("agent-heading").hidden = selected;
      if (changed) {
        $("terminal-command").value = "";
        historyIndex = (histories.get(p?.id) || []).length;
      }
      render();
      if (p && selected && (changed || opened)) {
        void action("open").then(() => $("terminal-command").focus());
      }
    },
    receive(state) {
      states.set(state.projectId, state);
      if (visible && project?.id === state.projectId) render();
    },
    async reconnect() {
      const id = project?.id;
      if (id) {
        try {
          states.set(id, await api(`/api/projects/${id}/terminal`));
          render();
        } catch (error) {
          onError(error.message);
        }
      }
    },
  };
}
