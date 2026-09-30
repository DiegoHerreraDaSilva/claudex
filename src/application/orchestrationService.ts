import type { AgentKind } from "../domain/agent.js";

/**
 * Shared execution primitives used by both the mission flow (UI) and the
 * parallel fleet flow (CLI/dashboard), so the two paths stop duplicating logic.
 */

export async function runPool<T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  const queue = [...items];
  const size = Math.max(1, Math.min(limit, queue.length));
  const runners = Array.from({ length: size }, async () => {
    while (queue.length > 0) {
      const item = queue.shift();
      if (item === undefined) break;
      await worker(item);
    }
  });
  await Promise.allSettled(runners);
}

export function agentKindOf(label: string): AgentKind {
  return label.startsWith("codex") ? "codex" : "claude";
}
