import { WorkService } from "../application/workService.js";
import { workRoutes } from "./workRoutes.js";
import { projectToolsRoutes } from "./projectTools.js";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { existsSync } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer, WebSocket } from "ws";
import type { ChatService } from "../app/chat.js";
import { isGitRepo } from "../app/git.js";
import type { ProjectRegistry } from "../app/projects.js";
import type { OrchestratorConfig } from "../config.js";
import { getCredentialStatus } from "../prerequisites.js";
import { getClaudeUsage, type ClaudeUsage } from "../agents/claude.js";
import { envelope } from "./protocol.js";
import {
  defaultSettingsHooks,
  handleSettingsMessage,
  type SettingsIncoming,
} from "./settingsChannel.js";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

export interface AppServerOptions {
  chat: ChatService;
  registry: ProjectRegistry;
  config: OrchestratorConfig;
  chatUiDir?: string;
  startedAt?: number;
}

export interface AppServer {
  server: Server;
  wss: WebSocketServer;
  listen(port: number): Promise<number>;
}

function defaultChatUiDir(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "chat");
}

export function createAppServer(options: AppServerOptions): AppServer {
  const chatUiDir = options.chatUiDir ?? defaultChatUiDir();
  const startedAt = options.startedAt ?? Date.now();
  const { chat, registry, config } = options;
  let usageCache: { at: number; value: ClaudeUsage | null } | null = null;

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://localhost");
      const method = req.method ?? "GET";

      if (await automationRoute(req, res, url)) return;
      if (await toolsRoute(req, res, url)) return;

      if (url.pathname === "/health") {
        return json(res, 200, {
          status: "ok",
          uptime: Math.round((Date.now() - startedAt) / 1000),
          projects: registry.list().length,
        });
      }
      if (url.pathname === "/api/credentials") {
        return json(res, 200, getCredentialStatus(config));
      }
      if (url.pathname === "/api/usage") {
        const cred = getCredentialStatus(config);
        let claude: ClaudeUsage | null = null;
        if (cred.claude.mode !== "none") {
          if (usageCache && Date.now() - usageCache.at < 300_000) claude = usageCache.value;
          else {
            claude = await getClaudeUsage(config.projectRoot);
            usageCache = { at: Date.now(), value: claude };
          }
        }
        const tokens = registry
          .list()
          .flatMap((project) => project.conversations)
          .reduce(
            (acc, conversation) => ({
              inputTokens: acc.inputTokens + (conversation.usage?.inputTokens ?? 0),
              outputTokens: acc.outputTokens + (conversation.usage?.outputTokens ?? 0),
              runs: acc.runs + (conversation.usage?.runs ?? 0),
            }),
            { inputTokens: 0, outputTokens: 0, runs: 0 },
          );
        const costUsd = registry
          .list()
          .flatMap((project) => project.conversations)
          .reduce((acc, conversation) => acc + (conversation.costUsd ?? 0), 0);
        return json(res, 200, {
          claude,
          codex: {
            mode: cred.codex.mode,
            account: cred.codex.account ?? null,
            plan: cred.codex.plan ?? null,
          },
          tokens,
          costUsd: Math.round(costUsd * 1e6) / 1e6,
          experimental: true,
          note:
            cred.codex.mode === "subscription"
              ? "ChatGPT plan quota is not exposed by the Codex SDK; showing tokens only."
              : null,
        });
      }
      if (url.pathname === "/api/projects" && method === "GET") {
        return json(res, 200, registry.summaries(chatRunning(chat)));
      }
      if (url.pathname === "/api/projects" && method === "POST") {
        const body = (await readBody(req)) as { name?: string; rootPath?: string };
        const rootPath = (body.rootPath ?? "").trim();
        if (!rootPath) return json(res, 400, { error: "rootPath is required" });
        if (!(await isGitRepo(rootPath))) {
          return json(res, 400, { error: "the selected folder is not a git repository" });
        }
        const project = await registry.create(body.name ?? "", rootPath);
        chat.emitProjects();
        return json(res, 201, project);
      }
      if (url.pathname === "/api/validate-path" && method === "POST") {
        const body = (await readBody(req)) as { rootPath?: string };
        const rootPath = (body.rootPath ?? "").trim();
        return json(res, 200, { isGitRepo: rootPath ? await isGitRepo(rootPath) : false });
      }
      if (url.pathname === "/api/preview" && method === "POST") {
        const body = (await readBody(req)) as { text?: string };
        const text = (body.text ?? "").trim();
        if (!text) return json(res, 400, { error: "text is required" });
        return json(res, 200, await chat.preview(text));
      }
      if (url.pathname === "/api/fs/list" && method === "GET") {
        return json(res, 200, await listDirectory(url.searchParams.get("path") ?? ""));
      }

      const missionSummaryMatch = /^\/api\/missions\/([^/]+)\/summary$/.exec(url.pathname);
      if (missionSummaryMatch?.[1] && method === "GET") {
        const summary = await chat.missionSummary(decodeURIComponent(missionSummaryMatch[1]));
        return summary ? json(res, 200, summary) : json(res, 404, { error: "mission not found" });
      }

      const missionEventsMatch = /^\/api\/missions\/([^/]+)\/events$/.exec(url.pathname);
      if (missionEventsMatch?.[1] && method === "GET") {
        const missionId = decodeURIComponent(missionEventsMatch[1]);
        return json(res, 200, await chat.missionEvents(missionId));
      }

      const conversationMatch = /^\/api\/projects\/([^/]+)\/conversations\/([^/]+)$/.exec(
        url.pathname,
      );
      if (conversationMatch?.[1] && conversationMatch[2]) {
        const projectId = decodeURIComponent(conversationMatch[1]);
        const conversationId = decodeURIComponent(conversationMatch[2]);
        if (method === "DELETE") {
          await chat.removeConversation(projectId, conversationId);
          return json(res, 200, { ok: true });
        }
      }

      const projectMatch = /^\/api\/projects\/([^/]+)$/.exec(url.pathname);
      if (projectMatch?.[1]) {
        const projectId = decodeURIComponent(projectMatch[1]);
        if (method === "GET") {
          const snapshot = await chat.snapshot(projectId);
          if (!snapshot) return json(res, 404, { error: "project not found" });
          return json(res, 200, snapshot);
        }
        if (method === "DELETE") {
          await chat.removeProject(projectId);
          return json(res, 200, { ok: true });
        }
      }

      return await serveStatic(res, chatUiDir, url.pathname);
    } catch (err) {
      return json(res, 500, { error: err instanceof Error ? err.message : String(err) });
    }
  });

  const wss = new WebSocketServer({ server });
  const settingsHooks = defaultSettingsHooks();
  const broadcast = (payload: unknown): void => {
    const encoded = JSON.stringify(payload);
    for (const client of wss.clients) {
      if (client.readyState === WebSocket.OPEN) client.send(encoded);
    }
  };

  const work = new WorkService(
    chat,
    registry,
    config.dataDir,
    () => broadcast(envelope({ type: "work:updated" })),
    () => getCredentialStatus(config).claude.mode !== "none",
  );
  const automationRoute = workRoutes(work, chat, registry, () => getCredentialStatus(config));
  server.on("close", () => work.stopScheduler());

  const toolsRoute = projectToolsRoutes(
    chat,
    registry,
    config.dataDir,
    config.worktreesDir,
    (event) => broadcast(envelope({ type: "terminal:out", ...event })),
  );

  chat.on("permission:notice", (notice) =>
    broadcast(envelope({ type: "permission:notice", notice })),
  );
  chat.on("projects:updated", (data) =>
    broadcast(envelope({ type: "projects", data: data.projects })),
  );
  chat.on("chat:message", (data) => broadcast(envelope({ type: "chat:message", ...data })));
  chat.on("chat:routing", (data) => broadcast(envelope({ type: "chat:routing", ...data })));
  chat.on("chat:turn", (data) => broadcast(envelope({ type: "chat:turn", ...data })));
  chat.on("chat:diff", (data) => broadcast(envelope({ type: "chat:diff", ...data })));
  chat.on("mission:summary", (summary) =>
    broadcast(envelope({ type: "mission:summary", summary })),
  );
  chat.on("mission:event", (data) => broadcast(envelope({ type: "mission:event", event: data })));

  wss.on("connection", (socket: WebSocket) => {
    socket.send(JSON.stringify(envelope({ type: "permissions", data: chat.permissions.list() })));
    socket.send(
      JSON.stringify(envelope({ type: "projects", data: registry.summaries(chatRunning(chat)) })),
    );
    socket.send(
      JSON.stringify(envelope({ type: "credentials", data: settingsHooks.getCredentialStatus() })),
    );
    socket.on("message", (raw: Buffer | string) => {
      let parsed: SettingsIncoming & {
        projectId?: string;
        conversationId?: string;
        text?: string;
        name?: string;
      };
      try {
        parsed = JSON.parse(raw.toString()) as typeof parsed;
      } catch {
        return;
      }
      if (handleSettingsMessage(parsed, socket, broadcast, settingsHooks)) return;

      if (
        parsed.type === "chat:send" &&
        parsed.projectId &&
        parsed.conversationId &&
        typeof parsed.text === "string"
      ) {
        void chat
          .send(parsed.projectId, parsed.conversationId, parsed.text)
          .catch((err: unknown) => {
            socket.send(
              JSON.stringify(
                envelope({
                  type: "chat:error",
                  projectId: parsed.projectId,
                  conversationId: parsed.conversationId,
                  error: err instanceof Error ? err.message : String(err),
                }),
              ),
            );
          });
        return;
      }
      if (parsed.type === "chat:stop" && parsed.projectId && parsed.conversationId) {
        chat.stop(parsed.projectId, parsed.conversationId);
        return;
      }
      if (
        parsed.type === "chat:action" &&
        parsed.projectId &&
        parsed.conversationId &&
        parsed.action
      ) {
        const projectId = parsed.projectId;
        const conversationId = parsed.conversationId;
        const run =
          parsed.action === "apply"
            ? chat.apply(projectId, conversationId)
            : parsed.action === "discard"
              ? chat.discard(projectId, conversationId)
              : Promise.resolve({ ok: false, reason: "unknown action" });
        void run
          .then((result) =>
            socket.send(
              JSON.stringify(
                envelope({ type: "chat:action:result", projectId, conversationId, ...result }),
              ),
            ),
          )
          .catch((err: unknown) => {
            socket.send(
              JSON.stringify(
                envelope({
                  type: "chat:action:result",
                  projectId,
                  conversationId,
                  ok: false,
                  reason: err instanceof Error ? err.message : String(err),
                }),
              ),
            );
          });
        return;
      }
      if (parsed.type === "conversation:create" && parsed.projectId) {
        const projectId = parsed.projectId;
        void registry.createConversation(projectId, parsed.name).then(() => chat.emitProjects());
        return;
      }
      if (
        parsed.type === "conversation:rename" &&
        parsed.projectId &&
        parsed.conversationId &&
        parsed.name
      ) {
        void registry
          .renameConversation(parsed.projectId, parsed.conversationId, parsed.name)
          .then(() => chat.emitProjects());
        return;
      }
      if (parsed.type === "conversation:delete" && parsed.projectId && parsed.conversationId) {
        void chat
          .removeConversation(parsed.projectId, parsed.conversationId)
          .catch(() => undefined);
        return;
      }
      if (parsed.type === "project:delete" && parsed.projectId) {
        void chat.removeProject(parsed.projectId).catch(() => undefined);
      }
    });
  });

  return {
    server,
    wss,
    async listen(port: number): Promise<number> {
      await work.initialize();
      return new Promise<number>((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, "127.0.0.1", () => {
          const address = server.address();
          void work.startScheduler().catch(() => work.stopScheduler());
          resolve(typeof address === "object" && address ? address.port : port);
        });
      });
    },
  };
}

function chatRunning(chat: ChatService): Set<string> {
  const running = new Set<string>();
  for (const project of chat.registryRef.list()) {
    for (const conversation of project.conversations) {
      if (chat.isRunning(conversation.id)) running.add(conversation.id);
    }
  }
  return running;
}

interface FsEntry {
  name: string;
  path: string;
  isGitRepo: boolean;
}

interface FsListing {
  path: string;
  parent: string | null;
  roots: string[];
  entries: FsEntry[];
  error?: string;
}

async function listRoots(): Promise<string[]> {
  if (process.platform !== "win32") return ["/"];
  const found: string[] = [];
  for (const letter of "ABCDEFGHIJKLMNOPQRSTUVWXYZ") {
    const drive = `${letter}:\\`;
    if (existsSync(drive)) found.push(drive);
  }
  return found;
}

async function listDirectory(requested: string): Promise<FsListing> {
  const roots = await listRoots();
  if (!requested.trim()) {
    return {
      path: "",
      parent: null,
      roots,
      entries: roots.map((root) => ({
        name: root,
        path: root,
        isGitRepo: existsSync(path.join(root, ".git")),
      })),
    };
  }
  const dir = path.resolve(requested);
  try {
    const dirents = await readdir(dir, { withFileTypes: true });
    const entries: FsEntry[] = [];
    for (const dirent of dirents) {
      if (!dirent.isDirectory()) continue;
      const full = path.join(dir, dirent.name);
      entries.push({
        name: dirent.name,
        path: full,
        isGitRepo: existsSync(path.join(full, ".git")),
      });
    }
    entries.sort((a, b) =>
      a.isGitRepo === b.isGitRepo ? a.name.localeCompare(b.name) : a.isGitRepo ? -1 : 1,
    );
    const parent = path.dirname(dir);
    return { path: dir, parent: parent === dir ? null : parent, roots, entries };
  } catch (err) {
    return {
      path: dir,
      parent: path.dirname(dir),
      roots,
      entries: [],
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw.trim() ? JSON.parse(raw) : {};
}

function json(res: ServerResponse, status: number, payload: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

async function serveStatic(res: ServerResponse, root: string, pathname: string): Promise<void> {
  const relative = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const target = path.resolve(root, relative);
  if (!target.startsWith(root)) {
    json(res, 403, { error: "forbidden" });
    return;
  }
  let filePath = target;
  try {
    const info = await stat(filePath);
    if (info.isDirectory()) filePath = path.join(filePath, "index.html");
  } catch {
    filePath = path.join(root, "index.html");
  }
  const body = await readFile(filePath);
  res.writeHead(200, {
    "Content-Type": MIME[path.extname(filePath)] ?? "application/octet-stream",
    "Cache-Control": "no-cache",
  });
  res.end(body);
}
