import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { v4 as uuid } from "uuid";

export const SCHEMA_VERSION = 1;

export type ChatRole = "user" | "system" | "assistant" | "tool" | "result" | "error" | "routing";

export interface ChatMessage {
  id: string;
  at: number;
  role: ChatRole;
  text: string;
  meta?: string;
  code?: string;
  params?: Record<string, string>;
}

export interface Project {
  id: string;
  name: string;
  rootPath: string;
  createdAt: number;
  baseBranch?: string;
  branch?: string;
  worktreePath?: string;
  claudeSessionId?: string;
  codexThreadId?: string;
  activeAgent?: string;
  messages: ChatMessage[];
}

export interface ProjectSummary {
  id: string;
  name: string;
  rootPath: string;
  branch?: string;
  baseBranch?: string;
  running: boolean;
  activeAgent?: string;
  messageCount: number;
}

interface ProjectStore {
  schemaVersion: number;
  projects: Project[];
}

export class ProjectRegistry {
  private projects: Project[] = [];
  private schemaVersion = SCHEMA_VERSION;
  private readonly file: string;
  private saveTimer: ReturnType<typeof setTimeout> | undefined;
  private dirty = false;

  constructor(private readonly dir: string) {
    this.file = path.join(dir, "projects.json");
  }

  async load(): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    try {
      const raw = await readFile(this.file, "utf8");
      const parsed = JSON.parse(raw) as ProjectStore | Project[];
      if (Array.isArray(parsed)) {
        this.projects = parsed;
        this.schemaVersion = 0;
      } else {
        this.projects = Array.isArray(parsed.projects) ? parsed.projects : [];
        this.schemaVersion = typeof parsed.schemaVersion === "number" ? parsed.schemaVersion : 0;
      }
    } catch {
      this.projects = [];
      this.schemaVersion = SCHEMA_VERSION;
    }
    this.projects = this.projects.map(normalizeProject);
    if (this.schemaVersion !== SCHEMA_VERSION) {
      this.schemaVersion = SCHEMA_VERSION;
      this.scheduleSave();
    }
  }

  /** Waits for any debounced write to finish. */
  async flush(): Promise<void> {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = undefined;
    }
    if (!this.dirty) return;
    this.dirty = false;
    await mkdir(this.dir, { recursive: true });
    const payload: ProjectStore = { schemaVersion: SCHEMA_VERSION, projects: this.projects };
    const tmp = `${this.file}.tmp`;
    await writeFile(tmp, JSON.stringify(payload, null, 2), "utf8");
    await rename(tmp, this.file);
  }

  private scheduleSave(): void {
    this.dirty = true;
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = undefined;
      void this.flush().catch(() => undefined);
    }, 200);
  }

  list(): Project[] {
    return this.projects;
  }

  get(id: string): Project | undefined {
    return this.projects.find((project) => project.id === id);
  }

  async create(name: string, rootPath: string): Promise<Project> {
    const project: Project = {
      id: uuid(),
      name: name.trim() || path.basename(rootPath),
      rootPath,
      createdAt: Date.now(),
      messages: [],
    };
    this.projects.push(project);
    this.scheduleSave();
    return project;
  }

  async update(id: string, patch: Partial<Project>): Promise<Project | undefined> {
    const project = this.get(id);
    if (!project) return undefined;
    Object.assign(project, patch);
    this.scheduleSave();
    return project;
  }

  async addMessage(id: string, message: ChatMessage): Promise<void> {
    const project = this.get(id);
    if (!project) return;
    project.messages.push(message);
    if (project.messages.length > 1000) project.messages.splice(0, 200);
    this.scheduleSave();
  }

  async clearMessages(id: string): Promise<void> {
    const project = this.get(id);
    if (!project) return;
    project.messages = [];
    this.scheduleSave();
  }

  async remove(id: string): Promise<void> {
    this.projects = this.projects.filter((project) => project.id !== id);
    this.scheduleSave();
  }

  summaries(running: Set<string>): ProjectSummary[] {
    return this.projects.map((project) => ({
      id: project.id,
      name: project.name,
      rootPath: project.rootPath,
      running: running.has(project.id),
      messageCount: project.messages.length,
      ...(project.branch ? { branch: project.branch } : {}),
      ...(project.baseBranch ? { baseBranch: project.baseBranch } : {}),
      ...(project.activeAgent ? { activeAgent: project.activeAgent } : {}),
    }));
  }
}

function normalizeProject(project: Project): Project {
  return {
    ...project,
    messages: Array.isArray(project.messages) ? project.messages : [],
  };
}
