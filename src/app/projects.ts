import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { v4 as uuid } from "uuid";

export type ChatRole = "user" | "system" | "assistant" | "tool" | "result" | "error" | "routing";

export interface ChatMessage {
  id: string;
  at: number;
  role: ChatRole;
  text: string;
  meta?: string;
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

export class ProjectRegistry {
  private projects: Project[] = [];
  private readonly file: string;

  constructor(private readonly dir: string) {
    this.file = path.join(dir, "projects.json");
  }

  async load(): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    try {
      const raw = await readFile(this.file, "utf8");
      const parsed = JSON.parse(raw) as Project[];
      this.projects = Array.isArray(parsed) ? parsed : [];
    } catch {
      this.projects = [];
    }
  }

  private async save(): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    await writeFile(this.file, JSON.stringify(this.projects, null, 2), "utf8");
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
    await this.save();
    return project;
  }

  async update(id: string, patch: Partial<Project>): Promise<Project | undefined> {
    const project = this.get(id);
    if (!project) return undefined;
    Object.assign(project, patch);
    await this.save();
    return project;
  }

  async addMessage(id: string, message: ChatMessage): Promise<void> {
    const project = this.get(id);
    if (!project) return;
    project.messages.push(message);
    if (project.messages.length > 1000) project.messages.splice(0, 200);
    await this.save();
  }

  async clearMessages(id: string): Promise<void> {
    const project = this.get(id);
    if (!project) return;
    project.messages = [];
    await this.save();
  }

  async remove(id: string): Promise<void> {
    this.projects = this.projects.filter((project) => project.id !== id);
    await this.save();
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
