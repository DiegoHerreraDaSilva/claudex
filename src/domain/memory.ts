export type MemoryKind = "architecture" | "decision" | "convention";

export interface MemoryEntry {
  id: string;
  projectId: string;
  kind: MemoryKind;
  text: string;
  createdAt: number;
}
