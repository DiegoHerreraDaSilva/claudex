import { clear, el } from "../lib/dom.js";
import { getLang, t } from "../lib/i18n.js";
import { currentProject, notify, state } from "../lib/store.js";
import { request } from "../lib/api.js";
import { confirmModal } from "../components/confirm.js";
import { toast } from "../components/toast.js";
const cache = new Map();
const checkpointCache = new Map();
const projectUrl = (id) => `/api/projects/${encodeURIComponent(id)}`;
export function refreshTools(id = state.currentProjectId) {
  cache.delete(id);
  checkpointCache.delete(state.currentConversationId);
  notify();
}
export function ensureTools() {
  const project = currentProject();
  if (!project) return;
  if (!cache.has(project.id)) {
    const data = { loading: true, query: "", memoryDraft: "", memoryKind: "decision" };
    cache.set(project.id, data);
    Promise.all(
      ["intelligence", "memory", "git", "missions"].map(async (kind) => {
        try {
          data[kind] = await request(`${projectUrl(project.id)}/${kind}`);
        } catch (error) {
          data.error = error.message;
        }
      }),
    ).then(() => {
      data.loading = false;
      notify();
    });
  }
  const id = state.currentConversationId;
  if (id && !checkpointCache.has(id)) {
    checkpointCache.set(id, []);
    request(`/api/missions/${encodeURIComponent(id)}/checkpoints`)
      .then((entries) => {
        const merged = new Map(
          [...entries, ...(checkpointCache.get(id) ?? [])].map((entry) => [entry.id, entry]),
        );
        checkpointCache.set(
          id,
          [...merged.values()].sort((a, b) => a.index - b.index),
        );
        notify();
      })
      .catch((error) => toast(error.message));
  }
}
export function toolEvent(event) {
  if (event.type === "checkpoint:created" && event.payload?.checkpoint) {
    const entries = checkpointCache.get(event.missionId) ?? [];
    const checkpoint = event.payload.checkpoint;
    if (!entries.some((entry) => entry.id === checkpoint.id))
      checkpointCache.set(event.missionId, [...entries, checkpoint]);
  }
}
function button(label, run, props = {}) {
  return el("button", { class: "small-btn", text: t(label), onclick: run, ...props });
}
function card(title, children) {
  return el("section", { class: "tool-card" }, [el("h2", { text: title }), ...children]);
}
function errorToast(error) {
  toast(error.message);
}
export function renderProjectTools(root, actions) {
  clear(root);
  const project = currentProject();
  const view = el("div", { class: "view tools-view" });
  root.append(view);
  if (!project) {
    view.append(el("p", { text: t("emptySelect") }));
    return;
  }
  const data = cache.get(project.id);
  view.append(
    el("div", { class: "tools-heading" }, [
      el("div", {}, [
        el("h1", { text: t(`${state.view}Title`) }),
        el("p", { class: "muted", text: project.name }),
      ]),
      button("refresh", () => refreshTools()),
      button("contextTitle", () => actions.openInspector("context")),
      button("terminalTitle", () => actions.openInspector("terminal")),
    ]),
  );
  if (!data || data.loading) {
    view.append(el("p", { text: t("browserLoading") }));
    return;
  }
  if (data.error) view.append(el("p", { class: "tool-error", role: "alert", text: data.error }));
  if (state.view === "intelligence") renderIntelligence(view, project, data);
  if (state.view === "memory") renderMemory(view, project, data);
  if (state.view === "worktrees") renderGit(view, data);
  if (state.view === "history") {
    const missions = data.missions ?? [];
    if (!missions.length) view.append(el("p", { class: "muted", text: t("noHistory") }));
    for (const mission of missions)
      view.append(
        card(mission.title, [
          el("p", {
            class: "muted",
            text: `${t(`missionStatus${mission.status[0].toUpperCase()}${mission.status.slice(1)}`)} · ${new Date(mission.startedAt).toLocaleString(getLang() === "pt" ? "pt-BR" : "en-US")} · ${(mission.durationMs / 1000).toFixed(1)}s · $${mission.costUsd.toFixed(4)}`,
          }),
          el("code", { text: mission.branch ?? "—" }),
          button("openMission", () => actions.openWorkspace(project.id, mission.id)),
        ]),
      );
  }
}
function renderIntelligence(view, project, data) {
  const repo = data.intelligence;
  if (!repo) return;
  view.append(
    card(t("repositoryMap"), [
      el("p", {
        text: `${repo.fileCount} ${t("indexedFiles")} · ${Object.keys(repo.dependencies).length} ${t("dependencies")}`,
      }),
      el("p", { class: "muted", text: repo.truncated ? t("indexLimited") : t("indexScope") }),
      el(
        "div",
        { class: "tool-chips" },
        repo.entryPoints.map((file) => el("code", { text: file })),
      ),
    ]),
  );
  const query = el("input", {
    value: data.query,
    placeholder: t("repoQuery"),
    "aria-label": t("repoQuery"),
    maxlength: 500,
    oninput: (event) => {
      data.query = event.target.value;
    },
  });
  const search = el(
    "form",
    {
      class: "tool-form",
      onsubmit: async (event) => {
        event.preventDefault();
        if (data.searching) return;
        data.searching = true;
        try {
          data.search = await request("/api/repo/ask", "POST", {
            projectId: project.id,
            query: data.query,
          });
        } catch (error) {
          errorToast(error);
        } finally {
          data.searching = false;
          notify();
        }
      },
    },
    [
      query,
      el("button", {
        class: "primary-btn",
        type: "submit",
        text: t("searchRepo"),
        disabled: data.searching,
      }),
    ],
  );
  const results = [];
  if (data.search) {
    results.push(
      el("p", {
        class: "muted",
        text: `${t("lexicalConfidence")}: ${Math.round(data.search.confidence * 100)}%${data.search.truncated ? ` · ${t("indexLimited")}` : ""}`,
      }),
    );
    if (!data.search.matches.length) results.push(el("p", { text: t("noMatches") }));
    for (const match of data.search.matches)
      results.push(
        el("div", { class: "search-match" }, [
          el("code", { text: `${match.file}:${match.line}` }),
          el("pre", { text: match.snippet }),
        ]),
      );
  }
  view.append(card(t("searchRepo"), [search, ...results]));
  view.append(
    card(t("architectureMap"), [
      el("div", { class: "architecture-scroll", tabindex: 0, "aria-label": t("architectureMap") }, [architecture(repo.graph)]),
      el("p", { class: "muted", text: t("graphLimit") }),
    ]),
  );
  view.append(
    card(t("dependencies"), [
      el(
        "div",
        { class: "tool-chips" },
        Object.entries(repo.dependencies).map(([name, version]) =>
          el("code", { text: `${name} ${version}` }),
        ),
      ),
    ]),
  );
  const tree = el("details", {}, [
    el("summary", { text: t("repositoryFiles") }),
    el("pre", { class: "repo-tree", text: repo.files.map((file) => file.file).join("\n") }),
  ]);
  view.append(tree);
}
function architecture(graph) {
  const names = graph.nodes.slice(0, 36);
  const width = 600;
  const height = Math.max(100, Math.ceil(names.length / 3) * 62);
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", t("architectureMap"));
  svg.classList.add("architecture-map");
  const make = (tag, attrs, text) => {
    const node = document.createElementNS(svg.namespaceURI, tag);
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
    if (text) node.textContent = text;
    svg.append(node);
    return node;
  };
  const positions = new Map(
    names.map((name, index) => [
      name,
      { x: (index % 3) * 200 + 8, y: Math.floor(index / 3) * 62 + 10 },
    ]),
  );
  for (const edge of graph.edges) {
    const a = positions.get(edge.from);
    const b = positions.get(edge.to);
    if (a && b)
      make("path", {
        d: `M${a.x + 90},${a.y + 17} L${b.x + 90},${b.y + 17}`,
        class: "architecture-edge",
      });
  }
  for (const [name, pos] of positions) {
    make("rect", { x: pos.x, y: pos.y, width: 182, height: 36, rx: 7, class: "architecture-node" });
    const text = make(
      "text",
      { x: pos.x + 8, y: pos.y + 23 },
      name.length > 24 ? `…${name.slice(-23)}` : name,
    );
    const title = document.createElementNS(svg.namespaceURI, "title");
    title.textContent = name;
    text.append(title);
  }
  return svg;
}
function renderMemory(view, project, data) {
  const text = el("textarea", {
    rows: 3,
    maxlength: 4000,
    "aria-label": t("memoryText"),
    placeholder: t("memoryText"),
    oninput: (event) => {
      data.memoryDraft = event.target.value;
    },
  });
  text.value = data.memoryDraft;
  const select = el(
    "select",
    {
      "aria-label": t("memoryKind"),
      onchange: (event) => {
        data.memoryKind = event.target.value;
      },
    },
    ["architecture", "decision", "convention"].map((kind) =>
      el("option", { value: kind, text: t(`memory${kind}`) }),
    ),
  );
  select.value = data.memoryKind;
  view.append(
    card(t("addMemory"), [
      el("p", { class: "muted", text: t("memoryInjected") }),
      el(
        "form",
        {
          class: "tool-form memory-form",
          onsubmit: async (event) => {
            event.preventDefault();
            try {
              await request(`${projectUrl(project.id)}/memory`, "POST", {
                kind: data.memoryKind,
                text: data.memoryDraft,
              });
              refreshTools();
            } catch (error) {
              errorToast(error);
            }
          },
        },
        [select, text, el("button", { type: "submit", class: "primary-btn", text: t("save") })],
      ),
    ]),
  );
  if (!data.memory?.length) view.append(el("p", { class: "muted", text: t("noMemories") }));
  for (const entry of data.memory ?? []) {
    const editor = el("textarea", { rows: 3, maxlength: 4000, "aria-label": t("memoryText") });
    data.edits ??= {};
    editor.value = data.edits[entry.id] ?? entry.text;
    editor.addEventListener("input", () => {
      data.edits[entry.id] = editor.value;
    });
    view.append(
      card(t(`memory${entry.kind}`), [
        editor,
        el("div", { class: "tool-actions" }, [
          button("save", async () => {
            try {
              await request(`${projectUrl(project.id)}/memory/${entry.id}`, "PUT", {
                kind: entry.kind,
                text: editor.value,
              });
              refreshTools();
            } catch (error) {
              errorToast(error);
            }
          }),
          button("deleteMemory", async () => {
            try {
              await request(`${projectUrl(project.id)}/memory/${entry.id}`, "DELETE");
              refreshTools();
            } catch (error) {
              errorToast(error);
            }
          }),
        ]),
      ]),
    );
  }
}
function renderGit(view, data) {
  const git = data.git;
  if (!git) return;
  view.append(
    card(t("branches"), [
      el(
        "div",
        { class: "tool-chips" },
        git.branches.map((branch) => el("code", { text: branch })),
      ),
    ]),
  );
  view.append(card(t("workingTreeStatus"), [el("pre", { text: git.status || t("cleanTree") })]));
  for (const tree of git.worktrees)
    view.append(
      card(String(tree.branch ?? t("detachedHead")), [
        el("code", { text: tree.worktree }),
        el("p", { class: "muted", text: tree.HEAD }),
      ]),
    );
}
export function renderContext() {
  const host = document.getElementById("tab-context");
  if (!host) return;
  clear(host);
  if (!currentProject()) {
    host.append(el("p", { text: t("emptySelect") }));
    return;
  }
  const context = [...state.missionEvents]
    .reverse()
    .find((event) => event.type === "context:loaded")?.payload;
  host.append(
    card(t("contextTitle"), [
      el("p", { class: "muted", text: t("contextSnapshot") }),
      el("code", { text: context?.worktreePath ?? currentProject().rootPath }),
      el("p", { text: context?.branch ?? "—" }),
    ]),
  );
  host.append(
    card(
      t("memoryTitle"),
      (context?.memory ?? []).length
        ? context.memory.map((entry) =>
            el("p", { text: `${t(`memory${entry.kind}`)}: ${entry.text}` }),
          )
        : [el("p", { class: "muted", text: t("noMemories") })],
    ),
  );
  host.append(
    card(t("checkpoints"), [
      el("p", { class: "muted", text: t("checkpointHint") }),
      ...(checkpointCache.get(state.currentConversationId) ?? []).map((entry) =>
        el("div", { class: "checkpoint-row" }, [
          el("code", { text: `#${entry.index} ${entry.commit.slice(0, 9)}` }),
          el("span", { class: "muted", text: new Date(entry.createdAt).toLocaleTimeString() }),
          button("restore", () => restoreCheckpoint(state.currentConversationId, entry.id), {
            disabled: state.running.has(state.currentConversationId),
          }),
        ]),
      ),
    ]),
  );
}
function restoreCheckpoint(missionId, checkpointId) {
  confirmModal({
    title: t("restore"),
    body: t("confirmRestore"),
    confirmLabel: t("restore"),
    cancelLabel: t("cancel"),
    danger: true,
    onConfirm: async () => {
      try {
        await request(`/api/missions/${encodeURIComponent(missionId)}/restore`, "POST", {
          checkpointId,
        });
        refreshTools();
        toast(t("restored"));
      } catch (error) {
        errorToast(error);
      }
    },
  });
}
