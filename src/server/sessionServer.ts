import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { WebSocketServer, WebSocket } from "ws";
import { z } from "zod";
import { SessionService, SessionError } from "../application/sessionService.js";
import { getCredentialStatus } from "../prerequisites.js";
import { runAccountAction } from "../accounts.js";
import { setEnvValues, type OrchestratorConfig } from "../config.js";
import { TerminalService } from "../application/terminalService.js";
import { agentForComplexity } from "../agents/types.js";
import { configuredEffort } from "../agents/effort.js";
import { attachmentInputSchema } from "../application/attachments.js";
export function createSessionServer({
  sessions,
  config,
  uiDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../chat"),
}: {
  sessions: SessionService;
  config: OrchestratorConfig;
  uiDir?: string;
}) {
  const terminals = new TerminalService();
  function local(req: IncomingMessage): boolean {
    const host = req.headers.host ?? "";
    return (
      /^(127\.0\.0\.1|localhost|\[::1\])(?::\d{1,5})?$/.test(host) &&
      (!req.headers.origin || req.headers.origin === `http://${host}`) &&
      req.headers["sec-fetch-site"] !== "cross-site"
    );
  }
  const server = createServer(async (req, res) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; frame-ancestors 'none'",
    );
    if (!local(req)) return json(res, 403, { error: "Origem não permitida." });
    try {
      const url = new URL(req.url ?? "/", "http://localhost");
      const method = req.method ?? "GET";
      const attachmentRoute = /^\/api\/projects\/([^/]+)\/attachments\/([a-f0-9-]{36})$/.exec(
        url.pathname,
      );
      if (attachmentRoute && method === "GET") {
        const file = sessions.attachment(attachmentRoute[1], attachmentRoute[2]);
        const bytes = await readFile(file.path);
        res.writeHead(200, {
          "Content-Type": file.mimeType,
          "Content-Disposition": `${file.mimeType.startsWith("image/") ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(file.name)}`,
          "Cache-Control": "no-store",
        });
        res.end(bytes);
        return;
      }
      const terminalRoute = /^\/api\/projects\/([^/]+)\/terminal$/.exec(url.pathname);
      if (terminalRoute) {
        const project = sessions.projects().find((p) => p.id === terminalRoute[1]);
        if (!project) throw new SessionError("Projeto não encontrado.", 404);
        if (method === "GET") return json(res, 200, terminals.snapshot(project.id));
        if (method === "POST") {
          const body = z
            .object({
              action: z.enum(["open", "write", "stop", "clear"]),
              input: z.string().max(16000).optional(),
            })
            .parse(await readBody(req));
          if (body.action === "open") terminals.open(project.id, project.rootPath);
          if (body.action === "write") {
            if (!body.input) throw new SessionError("Informe um comando.");
            try {
              terminals.write(project.id, body.input);
            } catch {
              throw new SessionError("Abra o terminal antes de enviar comandos.");
            }
          }
          if (body.action === "stop") await terminals.stop(project.id);
          if (body.action === "clear") terminals.clear(project.id);
          return json(res, 200, terminals.snapshot(project.id));
        }
      }
      if (url.pathname === "/health") return json(res, 200, { status: "ok" });
      if (url.pathname === "/api/projects") {
        if (method === "GET") return json(res, 200, sessions.projects());
        if (method === "POST") {
          const body = z
            .object({
              rootPath: z.string().trim().min(1).max(4096),
              name: z.string().trim().max(120).optional(),
            })
            .parse(await readBody(req));
          return json(res, 201, await sessions.addProject(body.rootPath, body.name));
        }
      }
      const projectRoute = /^\/api\/projects\/([^/]+)(\/sessions)?$/.exec(url.pathname);
      if (projectRoute) {
        if (method === "DELETE" && !projectRoute[2]) {
          await sessions.removeProject(projectRoute[1]);
          await terminals.stop(projectRoute[1]);
          return json(res, 200, { ok: true });
        }
        if (method === "POST" && projectRoute[2]) {
          const body = z
            .object({
              text: z.string().trim().max(32000),
              attachments: z.array(attachmentInputSchema).max(8).default([]),
            })
            .parse(await readBody(req, 30 * 1024 * 1024));
          return json(res, 202, await sessions.start(projectRoute[1], body.text, body.attachments));
        }
      }
      const sessionRoute = /^\/api\/sessions\/([^/]+)(\/stop|\/compact)?$/.exec(url.pathname);
      if (sessionRoute) {
        if (method === "GET" && !sessionRoute[2])
          return json(res, 200, sessions.session(sessionRoute[1]));
        if (method === "DELETE" && !sessionRoute[2]) {
          await sessions.closeSession(sessionRoute[1]);
          return json(res, 200, { ok: true });
        }
        if (method === "POST" && sessionRoute[2] === "/compact")
          return json(res, 200, await sessions.compact(sessionRoute[1]));
        if (method === "POST" && sessionRoute[2] === "/stop") {
          sessions.stop(sessionRoute[1]);
          return json(res, 200, { ok: true });
        }
      }
      if (url.pathname === "/api/credentials" && method === "GET")
        return json(res, 200, getCredentialStatus(config));
      if (url.pathname === "/api/settings" && method === "POST") {
        const body = z
          .object({
            values: z.record(
              z.string(),
              z
                .string()
                .max(4096)
                .refine((v) => !/[\r\n]/.test(v)),
            ),
          })
          .parse(await readBody(req));
        for (const key of [
          "DEFAULT_SIMPLE_MODEL",
          "DEFAULT_COMPLEX_MODEL",
          "DEFAULT_PLANNER_MODEL",
        ]) {
          if (
            body.values[key] !== undefined &&
            !/^(?:(?:claude|codex):)?[a-zA-Z0-9][a-zA-Z0-9._/-]{0,199}$/.test(body.values[key])
          )
            throw new SessionError("Informe um provedor e modelo válidos para cada agente.");
        }
        const roleSettings = [
          ["SIMPLE", "defaultSimpleModel", "defaultSimpleEffort"],
          ["COMPLEX", "defaultComplexModel", "defaultComplexEffort"],
          ["PLANNER", "defaultPlannerModel", "defaultPlannerEffort"],
        ] as const;
        const next = { ...config };
        for (const [role, modelField, effortField] of roleSettings) {
          const model = body.values[`DEFAULT_${role}_MODEL`];
          const effort = body.values[`DEFAULT_${role}_EFFORT`];
          if (model !== undefined) next[modelField] = model;
          if (effort !== undefined) {
            if (effort !== "" && !configuredEffort(effort))
              throw new SessionError("Informe um nível de esforço válido.");
            next[effortField] = configuredEffort(effort);
          }
        }
        for (const complexity of ["balanced", "strong", "judgment"] as const) {
          try {
            agentForComplexity(complexity, {
              simpleModel: next.defaultSimpleModel,
              complexModel: next.defaultComplexModel,
              plannerModel: next.defaultPlannerModel,
              simpleEffort: next.defaultSimpleEffort,
              complexEffort: next.defaultComplexEffort,
              plannerEffort: next.defaultPlannerEffort,
            });
          } catch (error) {
            throw new SessionError(error instanceof Error ? error.message : "Esforço inválido.");
          }
        }
        setEnvValues(config.dataDir, body.values);
        for (const [, modelField, effortField] of roleSettings) {
          config[modelField] = next[modelField];
          config[effortField] = next[effortField];
        }
        return json(res, 200, getCredentialStatus(config));
      }
      if (url.pathname === "/api/accounts" && method === "POST") {
        const body = z
          .object({ provider: z.enum(["claude", "codex"]), action: z.enum(["login", "logout"]) })
          .parse(await readBody(req));
        const result = await runAccountAction(
          body.provider,
          body.action,
          config.projectRoot,
          (stream, line) => broadcast({ type: "account:output", stream, line }),
        );
        return json(res, 200, result);
      }
      if (url.pathname === "/api/fs/list" && method === "GET") {
        const folder = path.resolve(url.searchParams.get("path") || homedir());
        const entries = (await readdir(folder, { withFileTypes: true }))
          .filter((e) => e.isDirectory())
          .map((e) => ({ name: e.name, path: path.join(folder, e.name) }));
        entries.sort((a, b) => a.name.localeCompare(b.name));
        return json(res, 200, { path: folder, parent: path.dirname(folder), entries });
      }
      if (url.pathname.startsWith("/api/"))
        return json(res, 404, { error: "Rota não encontrada." });
      if (method !== "GET") return json(res, 405, { error: "Método não permitido." });
      const relative =
        url.pathname === "/" ? "index.html" : decodeURIComponent(url.pathname).replace(/^\/+/, "");
      const target = path.resolve(uiDir, relative);
      const inside = path.relative(uiDir, target);
      if (inside.startsWith("..") || path.isAbsolute(inside))
        return json(res, 403, { error: "Arquivo não permitido." });
      try {
        if (!(await stat(target)).isFile()) throw new Error();
        const mime: Record<string, string> = {
          ".html": "text/html; charset=utf-8",
          ".js": "text/javascript; charset=utf-8",
          ".css": "text/css; charset=utf-8",
        };
        res.writeHead(200, {
          "Content-Type": mime[path.extname(target)] ?? "application/octet-stream",
          "Cache-Control": "no-cache",
        });
        res.end(await readFile(target));
      } catch {
        json(res, 404, { error: "Arquivo não encontrado." });
      }
    } catch (error) {
      json(
        res,
        error instanceof SessionError
          ? error.status
          : error instanceof z.ZodError || error instanceof SyntaxError
            ? 400
            : 500,
        {
          error:
            error instanceof SessionError
              ? error.message
              : error instanceof z.ZodError || error instanceof SyntaxError
                ? "Dados inválidos."
                : "Não foi possível concluir a operação.",
        },
      );
    }
  });
  const wss = new WebSocketServer({ noServer: true, maxPayload: 4096 });
  server.on("upgrade", (req, socket, head) => {
    if (!local(req)) {
      socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws));
  });
  function broadcast(payload: unknown) {
    for (const ws of wss.clients)
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload));
  }
  const updated = () => broadcast({ type: "projects", data: sessions.projects() });
  const terminalUpdated = (data: unknown) => broadcast({ type: "terminal", data });
  terminals.on("updated", terminalUpdated);
  sessions.on("updated", updated);
  const activity = (data: unknown) => broadcast({ type: "activity", data });
  sessions.on("activity", activity);
  const storageError = () =>
    broadcast({
      type: "error",
      message:
        "Não foi possível salvar o histórico. Verifique o espaço e as permissões da pasta de dados.",
    });
  sessions.on("storage-error", storageError);
  wss.on("connection", (ws) => {
    ws.on("error", () => undefined);
    ws.send(JSON.stringify({ type: "projects", data: sessions.projects() }));
  });
  return {
    server,
    wss,
    listen(port: number): Promise<number> {
      return new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, "127.0.0.1", () => {
          const address = server.address();
          resolve(typeof address === "object" && address ? address.port : port);
        });
      });
    },
    async close() {
      await terminals.close();
      terminals.off("updated", terminalUpdated);
      for (const ws of wss.clients) ws.terminate();
      wss.close();
      await sessions.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      sessions.off("updated", updated);
      sessions.off("activity", activity);
      sessions.off("storage-error", storageError);
    },
  };
}
async function readBody(req: IncomingMessage, maxBytes = 128000): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) throw new SessionError("Pedido muito grande.", 413);
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}
function json(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}
