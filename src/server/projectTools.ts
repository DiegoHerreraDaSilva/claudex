import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import { commandAction } from "../application/permissionBroker.js";
import { z } from "zod";
import type { ChatService } from "../app/chat.js";
import type { ProjectRegistry } from "../app/projects.js";
import { runGit } from "../app/git.js";
import { MemoryService } from "../application/memoryService.js";
import { CheckpointService, assertMissionWorktree } from "../application/checkpointService.js";
import { inspectRepository } from "../application/repoIntelligence.js";
import { searchRepository } from "../application/repoSearch.js";
import { TerminalService, type TerminalOutput } from "../application/terminalService.js";
const memorySchema = z.object({
  kind: z.enum(["architecture", "decision", "convention"]),
  text: z.string().trim().min(1).max(4000),
});
export function projectToolsRoutes(
  chat: ChatService,
  registry: ProjectRegistry,
  dataDir: string,
  worktreesBase: string,
  emit: (event: TerminalOutput) => void,
) {
  const memory = new MemoryService(path.join(dataDir, "memory"));
  const checkpoints = new CheckpointService(path.join(dataDir, "checkpoints"));
  const terminal = new TerminalService();
  const pendingTerminal = new Map<string, AbortController>();
  const json = (res: ServerResponse, status: number, value: unknown) => {
    res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(value));
  };
  const body = async (req: IncomingMessage) => {
    if (!req.headers["content-type"]?.startsWith("application/json"))
      throw new Error("JSON body required");
    let size = 0;
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      size += chunk.length;
      if (size > 32_000) throw new Error("request too large");
      chunks.push(chunk);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  };
  return async (req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> => {
    const projectMatch =
      /^\/api\/projects\/([^/]+)\/(intelligence|memory|git|missions|terminal)(?:\/([^/]+))?$/.exec(
        url.pathname,
      );
    const missionMatch = /^\/api\/missions\/([^/]+)\/(checkpoints|restore)$/.exec(url.pathname);
    const autonomyMatch = /^\/api\/projects\/([^/]+)\/conversations\/([^/]+)\/autonomy$/.exec(
      url.pathname,
    );
    const permissionMatch = /^\/api\/permissions(?:\/([^/]+))?$/.exec(url.pathname);
    const ask = url.pathname === "/api/repo/ask";
    if (!projectMatch && !missionMatch && !ask && !autonomyMatch && !permissionMatch) return false;
    try {
      const hostname = new URL(`http://${req.headers.host ?? ""}`).hostname;
      if (
        !["127.0.0.1", "localhost", "[::1]"].includes(hostname) ||
        (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`)
      ) {
        json(res, 403, { error: "origin not allowed" });
        return true;
      }
      const method = req.method ?? "GET";
      if (autonomyMatch && method === "PUT") {
        const input = z
          .object({ mode: z.enum(["manual", "assisted", "autonomous"]) })
          .parse(await body(req));
        await chat.setAutonomy(
          decodeURIComponent(autonomyMatch[1]),
          decodeURIComponent(autonomyMatch[2]),
          input.mode,
        );
        json(res, 200, { ok: true });
        return true;
      }
      if (permissionMatch) {
        if (method === "GET" && !permissionMatch[1]) {
          json(res, 200, chat.permissions.list());
          return true;
        }
        if (method === "POST" && permissionMatch[1]) {
          const input = z.object({ approved: z.boolean() }).parse(await body(req));
          const resolved = chat.permissions.resolve(
            decodeURIComponent(permissionMatch[1]),
            input.approved,
          );
          json(res, resolved ? 200 : 404, { ok: resolved });
          return true;
        }
      }
      if (ask && method === "POST") {
        const input = z
          .object({ projectId: z.string(), query: z.string().min(1).max(500) })
          .parse(await body(req));
        const project = registry.get(input.projectId);
        if (!project) {
          json(res, 404, { error: "project not found" });
          return true;
        }
        json(res, 200, await searchRepository(project.rootPath, input.query));
        return true;
      }
      if (missionMatch) {
        const missionId = decodeURIComponent(missionMatch[1]);
        if (
          !registry
            .list()
            .some((project) => project.conversations.some((item) => item.id === missionId))
        ) {
          json(res, 404, { error: "mission not found" });
          return true;
        }
        if (missionMatch[2] === "checkpoints" && method === "GET") {
          json(res, 200, await checkpoints.list(missionId));
          return true;
        }
        if (missionMatch[2] === "restore" && method === "POST") {
          const input = z.object({ checkpointId: z.string().uuid() }).parse(await body(req));
          await chat.restore(missionId, input.checkpointId);
          json(res, 200, { ok: true });
          return true;
        }
      }
      if (projectMatch) {
        const projectId = decodeURIComponent(projectMatch[1]);
        const kind = projectMatch[2];
        const id = projectMatch[3] ? decodeURIComponent(projectMatch[3]) : undefined;
        const project = registry.get(projectId);
        if (!project) {
          json(res, 404, { error: "project not found" });
          return true;
        }
        if (kind === "intelligence" && method === "GET") {
          json(res, 200, await inspectRepository(project.rootPath));
          return true;
        }
        if (kind === "memory") {
          if (method === "GET" && !id) {
            json(res, 200, await memory.list(projectId));
            return true;
          }
          if ((method === "POST" && !id) || (method === "PUT" && id)) {
            const input = memorySchema.parse(await body(req));
            json(
              res,
              id ? 200 : 201,
              id
                ? await memory.update(projectId, id, input.kind, input.text)
                : await memory.add(projectId, input.kind, input.text),
            );
            return true;
          }
          if (method === "DELETE" && id) {
            await memory.remove(projectId, id);
            json(res, 200, { ok: true });
            return true;
          }
        }
        if (kind === "git" && method === "GET") {
          const results = await Promise.all([
            runGit(project.rootPath, ["branch", "--format=%(refname:short)"]),
            runGit(project.rootPath, ["worktree", "list", "--porcelain"]),
            runGit(project.rootPath, ["status", "--short"]),
          ]);
          const worktrees = results[1].stdout
            .trim()
            .split(/\r?\n\r?\n/)
            .filter(Boolean)
            .map((block) =>
              Object.fromEntries(
                block.split(/\r?\n/).map((line) => {
                  const index = line.indexOf(" ");
                  return index < 0 ? [line, true] : [line.slice(0, index), line.slice(index + 1)];
                }),
              ),
            );
          json(res, 200, {
            branches: results[0].stdout.trim().split(/\r?\n/).filter(Boolean),
            worktrees,
            status: results[2].stdout,
          });
          return true;
        }
        if (kind === "missions" && method === "GET") {
          const missions = await Promise.all(
            project.conversations.map(async (conversation) => {
              const summary = await chat.missionSummary(conversation.id);
              return {
                id: conversation.id,
                name: conversation.name,
                status: summary?.status ?? "draft",
                title: summary?.title ?? conversation.name,
                costUsd: conversation.costUsd ?? 0,
                startedAt: summary?.startedAt ?? conversation.createdAt,
                durationMs: summary
                  ? (summary.finishedAt ?? summary.updatedAt) - summary.startedAt
                  : 0,
                branch: conversation.branch,
              };
            }),
          );
          json(
            res,
            200,
            missions.sort((a, b) => b.startedAt - a.startedAt),
          );
          return true;
        }
        if (kind === "terminal" && method === "POST") {
          if (id === "stop") {
            pendingTerminal.get(projectId)?.abort();
            terminal.stop(projectId);
            json(res, 200, { ok: true });
            return true;
          }
          if (!id) {
            const input = z
              .object({
                command: z.string().trim().min(1).max(4000),
                conversationId: z.string().optional(),
                contextConversationId: z.string().optional(),
              })
              .parse(await body(req));
            const result = await chat.withProjectOperation(projectId, async () => {
              const conversation = input.conversationId
                ? registry.getConversation(projectId, input.conversationId)
                : undefined;
              if (input.conversationId && !conversation) throw new Error("conversation not found");
              let cwd = project.rootPath;
              if (conversation) {
                if (!conversation.worktreePath || !conversation.branch)
                  throw new Error("mission has no worktree; select project scope");
                await assertMissionWorktree(
                  project.rootPath,
                  worktreesBase,
                  conversation.worktreePath,
                  conversation.branch,
                );
                cwd = conversation.worktreePath;
              }
              try {
                const contextId =
                  conversation?.id ??
                  input.contextConversationId ??
                  project.activeConversationId ??
                  project.conversations[0]?.id;
                if (!contextId || !registry.getConversation(projectId, contextId))
                  throw new Error("conversation not found");
                const broker = chat.broker(projectId, contextId, cwd);
                const controller = new AbortController();
                pendingTerminal.set(projectId, controller);
                if (
                  !(await broker.authorize(
                    broker.mode === "manual" ? "execute" : commandAction(input.command),
                    "Terminal",
                    input.command,
                    controller.signal,
                  ))
                )
                  throw new Error("command denied by autonomy policy");
                return await terminal.run(projectId, cwd, input.command, emit, broker.mode);
              } finally {
                pendingTerminal.delete(projectId);
                await chat.invalidateChangedMissions(projectId);
              }
            });
            json(res, 200, result);
            return true;
          }
        }
      }
      json(res, 405, { error: "method not allowed" });
    } catch (error) {
      json(res, error instanceof Error && /busy|running/.test(error.message) ? 409 : 400, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return true;
  };
}
