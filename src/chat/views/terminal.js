import { clear, el } from "../lib/dom.js";
import { getLang, t } from "../lib/i18n.js";
import { currentProject, notify, state } from "../lib/store.js";
import { request } from "../lib/api.js";
import { toast } from "../components/toast.js";
import { refreshTools } from "./projectTools.js";
const terminals = new Map();
const projectUrl = (id) => `/api/projects/${encodeURIComponent(id)}`;
function errorToast(error) {
  toast(error.message);
}
function button(label, run, props = {}) {
  return el("button", { class: "small-btn", text: t(label), onclick: run, ...props });
}
export function terminalEvent(event) {
  const data = terminals.get(event.projectId);
  if (!data) return;
  if (event.stream === "system" && event.text) data.busy = true;
  if (event.text) data.output = (data.output + event.text).slice(-260000);
  if (event.result) {
    data.busy = false;
    data.output += `\n${t("exitCode")}: ${event.result.code}${event.result.truncated ? ` · ${t("indexLimited")}` : ""}${event.result.error ? ` · ${event.result.error}` : ""}\n`;
  }
  notify();
}
export function renderTerminal() {
  const host = document.getElementById("tab-terminal");
  if (!host) return;
  const project = currentProject();
  if (!project) {
    delete host.dataset.key;
    clear(host);
    host.append(el("p", { text: t("emptySelect") }));
    return;
  }
  let data = terminals.get(project.id);
  if (!data) {
    data = { output: "", command: "", busy: false, scope: "project" };
    terminals.set(project.id, data);
  }
  const key = `${project.id}:${getLang()}`;
  if (host.dataset.key !== key) {
    host.dataset.key = key;
    clear(host);
    const scope = el(
      "select",
      {
        "aria-label": t("terminalScope"),
        onchange: (event) => {
          data.scope = event.target.value;
        },
      },
      [
        el("option", { value: "project", text: t("project") }),
        el("option", { value: "mission", text: t("currentConversation") }),
      ],
    );
    scope.value = data.scope;
    const input = el("input", {
      maxlength: 4000,
      "aria-label": t("terminalCommand"),
      placeholder: t("terminalCommand"),
      oninput: (event) => {
        data.command = event.target.value;
      },
    });
    input.value = data.command;
    host.append(
      el("p", { class: "muted", text: t("terminalHint") }),
      el(
        "form",
        {
          class: "tool-form terminal-form",
          onsubmit: async (event) => {
            event.preventDefault();
            if (data.busy || !data.command.trim()) return;
            if (data.scope === "mission" && !state.currentConversationId) {
              toast(t("noSession"));
              return;
            }
            data.busy = true;
            notify();
            const command = data.command;
            try {
              await request(`${projectUrl(project.id)}/terminal`, "POST", {
                command,
                ...(data.scope === "mission"
                  ? { conversationId: state.currentConversationId }
                  : {}),
              });
              refreshTools(project.id);
            } catch (error) {
              data.output += `\n${error.message}\n`;
            } finally {
              data.busy = false;
              notify();
            }
          },
        },
        [
          scope,
          input,
          el("button", {
            class: "primary-btn terminal-run",
            text: t("runCommand"),
            type: "submit",
          }),
          button(
            "stop",
            () => request(`${projectUrl(project.id)}/terminal/stop`, "POST", {}).catch(errorToast),
            { class: "small-btn terminal-stop", type: "button" },
          ),
        ],
      ),
      el("pre", { class: "terminal-output", tabindex: 0, "aria-label": t("terminalOutput") }),
    );
  }
  host.querySelector(".terminal-run").disabled =
    data.busy ||
    [...state.running].some((id) => project.conversations.some((item) => item.id === id));
  host.querySelector(".terminal-stop").disabled = !data.busy;
  const output = host.querySelector(".terminal-output");
  if (output.textContent !== data.output) {
    output.textContent = data.output;
    output.scrollTop = output.scrollHeight;
  }
}
