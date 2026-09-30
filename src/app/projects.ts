import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { v4 as uuid } from "uuid";

export const SCHEMA_VERSION = 2;

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

export interface Conversation {
  id: string;
  name: string;
  createdAt: number;
  messages: ChatMessage[];
  claudeSessionId?: string;
  codexThreadId?: string;
  activeAgent?: string;
  branch?: string;
  worktreePath?: string;
}

export interface Project {
  id: string;
  name: string;
  rootPath: string;
  createdAt: number;
  baseBranch?: string;
  activeConversationId?: string;
  conversations: Conversation[];
}

export interface ConversationSummary {
  id: string;
  name: string;
  createdAt: number;
  messageCount: number;
  running: boolean;
  activeAgent?: string;
  branch?: string;
}

export interface ProjectSummary {
  id: string;
  name: string;
  rootPath: string;
  baseBranch?: string;
  running: boolean;
  conversations: ConversationSummary[];
  activeConversationId?: string;
}

interface ProjectStore {
  schemaVersion: number;
  projects: Project[];
}

type LegacyProject = Partial<Project> & {
  messages?: ChatMessage[];
  claudeSessionId?: string;
  codexThreadId?: string;
  activeAgent?: string;
  branch?: string;
  worktreePath?: string;
};

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
      const parsed = JSON.parse(raw) as ProjectStore | LegacyProject[];
      if (Array.isArray(parsed)) {
        this.projects = parsed.map((p) => migrateProject(p));
        this.schemaVersion = 1;
      } else {
        this.projects = (Array.isArray(parsed.projects) ? parsed.projects : []).map((p) =>
          migrateProject(p as LegacyProject),
        );
        this.schemaVersion = typeof parsed.schemaVersion === "number" ? parsed.schemaVersion : 0;
      }
    } catch {
      this.projects = [];
      this.schemaVersion = SCHEMA_VERSION;
    }
    if (this.schemaVersion !== SCHEMA_VERSION) {
      this.schemaVersion = SCHEMA_VERSION;
      this.scheduleSave();
    }
  }

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

  getConversation(projectId: string, conversationId: string): Conversation | undefined {
    return this.get(projectId)?.conversations.find((c) => c.id === conversationId);
  }

  async create(name: string, rootPath: string): Promise<Project> {
    const conversation = newConversation("Chat 1");
    const project: Project = {
      id: uuid(),
      name: name.trim() || path.basename(rootPath),
      rootPath,
      createdAt: Date.now(),
      conversations: [conversation],
      activeConversationId: conversation.id,
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

  async createConversation(projectId: string, name?: string): Promise<Conversation | undefined> {
    const project = this.get(projectId);
    if (!project) return undefined;
    const conversation = newConversation(name?.trim() || `Chat ${project.conversations.length + 1}`);
    project.conversations.push(conversation);
    project.activeConversationId = conversation.id;
    this.scheduleSave();
    return conversation;
  }

  async renameConversation(projectId: string, conversationId: string, name: string): Promise<void> {
    const conversation = this.getConversation(projectId, conversationId);
    if (!conversation) return;
    conversation.name = name.trim().slice(0, 80) || conversation.name;
    this.scheduleSave();
  }

  async updateConversation(
    projectId: string,
    conversationId: string,
    patch: Partial<Conversation>,
  ): Promise<Conversation | undefined> {
    const conversation = this.getConversation(projectId, conversationId);
    if (!conversation) return undefined;
    Object.assign(conversation, patch);
    this.scheduleSave();
    return conversation;
  }

  async setActiveConversation(projectId: string, conversationId: string): Promise<void> {
    const project = this.get(projectId);
    if (!project) return;
    if (!project.conversations.some((c) => c.id === conversationId)) return;
    project.activeConversationId = conversationId;
    this.scheduleSave();
  }

  async deleteConversation(projectId: string, conversationId: string): Promise<Conversation | undefined> {
    const project = this.get(projectId);
    if (!project) return undefined;
    const index = project.conversations.findIndex((c) => c.id === conversationId);
    if (index === -1) return undefined;
    const [removed] = project.conversations.splice(index, 1);
    if (project.conversations.length === 0) {
      project.conversations.push(newConversation("Chat 1"));
    }
    if (project.activeConversationId === conversationId || !project.activeConversationId) {
      project.activeConversationId = project.conversations[0]!.id;
    }
    this.scheduleSave();
    return removed;
  }

  async addMessage(projectId: string, conversationId: string, message: ChatMessage): Promise<void> {
    const conversation = this.getConversation(projectId, conversationId);
    if (!conversation) return;
    conversation.messages.push(message);
    if (conversation.messages.length > 1000) conversation.messages.splice(0, 200);
    this.scheduleSave();
  }

  async clearConversation(projectId: string, conversationId: string): Promise<void> {
    const conversation = this.getConversation(projectId, conversationId);
    if (!conversation) return;
    conversation.messages = [];
    this.scheduleSave();
  }

  async remove(id: string): Promise<Project | undefined> {
    const removed = this.get(id);
    this.projects = this.projects.filter((project) => project.id !== id);
    this.scheduleSave();
    return removed;
  }

  summaries(runningConversations: Set<string>): ProjectSummary[] {
    return this.projects.map((project) => {
      const conversations: ConversationSummary[] = project.conversations.map((conversation) => ({
        id: conversation.id,
        name: conversation.name,
        createdAt: conversation.createdAt,
        messageCount: conversation.messages.length,
        running: runningConversations.has(conversation.id),
        ...(conversation.activeAgent ? { activeAgent: conversation.activeAgent } : {}),
        ...(conversation.branch ? { branch: conversation.branch } : {}),
      }));
      return {
        id: project.id,
        name: project.name,
        rootPath: project.rootPath,
        running: conversations.some((c) => c.running),
        conversations,
        ...(project.baseBranch ? { baseBranch: project.baseBranch } : {}),
        ...(project.activeConversationId ? { activeConversationId: project.activeConversationId } : {}),
      };
    });
  }
}

function newConversation(name: string): Conversation {
  return { id: uuid(), name, createdAt: Date.now(), messages: [] };
}

function migrateProject(project: LegacyProject): Project {
  const conversations: Conversation[] = Array.isArray(project.conversations)
    ? project.conversations.map(normalizeConversation)
    : [];
  if (conversations.length === 0) {
    conversations.push({
      id: uuid(),
      name: "Chat 1",
      createdAt: project.createdAt ?? Date.now(),
      messages: Array.isArray(project.messages) ? project.messages : [],
      ...(project.claudeSessionId ? { claudeSessionId: project.claudeSessionId } : {}),
      ...(project.codexThreadId ? { codexThreadId: project.codexThreadId } : {}),
      ...(project.activeAgent ? { activeAgent: project.activeAgent } : {}),
      ...(project.branch ? { branch: project.branch } : {}),
      ...(project.worktreePath ? { worktreePath: project.worktreePath } : {}),
    });
  }
  const activeConversationId =
    project.activeConversationId && conversations.some((c) => c.id === project.activeConversationId)
      ? project.activeConversationId
      : conversations[0]!.id;
  return {
    id: project.id ?? uuid(),
    name: project.name ?? "project",
    rootPath: project.rootPath ?? "",
    createdAt: project.createdAt ?? Date.now(),
    conversations,
    activeConversationId,
    ...(project.baseBranch ? { baseBranch: project.baseBranch } : {}),
  };
}

function normalizeConversation(conversation: Conversation): Conversation {
  return {
    ...conversation,
    messages: Array.isArray(conversation.messages) ? conversation.messages : [],
  };
}
