import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { MemoryEntry, MemoryKind } from "../domain/memory.js";
export function safeId(value: string): string {
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(value)) throw new Error("invalid identifier");
  return value;
}
export class MemoryService {
  private readonly queues = new Map<string, Promise<unknown>>();
  constructor(private readonly root: string) {}
  async list(projectId: string): Promise<MemoryEntry[]> {
    const target = path.join(this.root, `${safeId(projectId)}.json`);
    try {
      const data = JSON.parse(await readFile(target, "utf8"));
      if (!Array.isArray(data)) throw new Error("invalid memory data");
      return data;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
  }
  add(projectId: string, kind: MemoryKind, text: string): Promise<MemoryEntry> {
    return this.change(projectId, (entries) => {
      this.validate(kind, text);
      if (entries.length >= 100) throw new Error("memory limit reached");
      const entry = { id: randomUUID(), projectId, kind, text: text.trim(), createdAt: Date.now() };
      entries.push(entry);
      return entry;
    });
  }
  update(projectId: string, id: string, kind: MemoryKind, text: string): Promise<MemoryEntry> {
    return this.change(projectId, (entries) => {
      this.validate(kind, text);
      const entry = entries.find((entry) => entry.id === id);
      if (!entry) throw new Error("memory not found");
      Object.assign(entry, { kind, text: text.trim() });
      return entry;
    });
  }
  remove(projectId: string, id: string): Promise<void> {
    return this.change(projectId, (entries) => {
      const index = entries.findIndex((entry) => entry.id === id);
      if (index < 0) throw new Error("memory not found");
      entries.splice(index, 1);
    });
  }
  private validate(kind: MemoryKind, text: string): void {
    if (
      !["architecture", "decision", "convention"].includes(kind) ||
      typeof text !== "string" ||
      !text.trim() ||
      text.length > 4000
    )
      throw new Error("invalid memory: kind and 1–4000 characters required");
  }
  private change<T>(projectId: string, action: (entries: MemoryEntry[]) => T): Promise<T> {
    safeId(projectId);
    const run = (this.queues.get(projectId) ?? Promise.resolve())
      .catch(() => undefined)
      .then(async () => {
        const entries = await this.list(projectId);
        const result = action(entries);
        await mkdir(this.root, { recursive: true });
        const target = path.join(this.root, `${projectId}.json`);
        const temp = `${target}.${randomUUID()}.tmp`;
        await writeFile(temp, JSON.stringify(entries, null, 2), "utf8");
        await rename(temp, target);
        return result;
      });
    this.queues.set(projectId, run);
    void run
      .finally(() => {
        if (this.queues.get(projectId) === run) this.queues.delete(projectId);
      })
      .catch(() => undefined);
    return run;
  }
}
export function selectPromptMemory(entries: MemoryEntry[]): MemoryEntry[] {
  const selected: MemoryEntry[] = [];
  let length = 0;
  for (const entry of entries) {
    const size = JSON.stringify({ id: entry.id, kind: entry.kind, text: entry.text }).length + 1;
    if (length + size > 16000) continue;
    length += size;
    selected.push(entry);
  }
  return selected;
}
export function memoryPrompt(entries: MemoryEntry[]): string {
  const selected = selectPromptMemory(entries);
  return selected.length
    ? `\n\nProject memory (project context; task instructions take precedence):\n${JSON.stringify(selected.map(({ id, kind, text }) => ({ id, kind, text })))}`
    : "";
}
