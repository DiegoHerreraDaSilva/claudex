const listeners = new Set();

export const state = {
  projects: [],
  currentProjectId: null,
  currentConversationId: null,
  view: "home",
  snapshot: null,
  running: new Set(),
  credentials: null,
  usage: null,
  autoscroll: true,
  browser: { path: "", parent: null },
  route: null,
  missionEvents: [],
  missionEventsFor: null,
  missionSummary: null,
  missionSummaryError: false,
  palette: { open: false, mode: "commands", query: "" },
};

export function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function notify() {
  for (const listener of [...listeners]) listener(state);
}

export function patch(partial) {
  Object.assign(state, partial);
  notify();
}

export function currentProject() {
  return state.projects.find((project) => project.id === state.currentProjectId) ?? null;
}

export function currentConversation() {
  const project = currentProject();
  return project?.conversations?.find((conversation) => conversation.id === state.currentConversationId) ?? null;
}

export function conversationMessages() {
  const conversation = state.snapshot?.project?.conversations?.find(
    (item) => item.id === state.currentConversationId,
  );
  return conversation?.messages ?? [];
}

export function currentDiff() {
  return state.snapshot?.diffs?.[state.currentConversationId] ?? null;
}

export function isRunning(conversationId) {
  return state.running.has(conversationId);
}
