import type { AgentRun } from "../domain/agent.js";
import type { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";
import type { WorkService } from "../application/workService.js";
import { WorkError } from "../application/workService.js";
import {
  workInputSchema,
  scheduleInputSchema,
} from "../infrastructure/persistence/automationStore.js";
import type { ChatService } from "../app/chat.js";
import type { ProjectRegistry } from "../app/projects.js";
import type { CredentialStatus } from "../prerequisites.js";
export function workRoutes(
  work: WorkService,
  chat: ChatService,
  registry: ProjectRegistry,
  credentials: () => CredentialStatus,
) {
  const json = (res: ServerResponse, status: number, data: unknown) => {
    res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(data));
  };
  const body = async (req: IncomingMessage) => {
    if (!req.headers["content-type"]?.startsWith("application/json"))
      throw new WorkError("INVALID_INPUT", "JSON body required");
    let size = 0;
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      size += chunk.length;
      if (size > 32_000) throw new WorkError("INVALID_INPUT", "Request too large");
      chunks.push(chunk);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  };
  return async (req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> => {
    const match = /^\/api\/(work-items|schedules)(?:\/([a-f0-9-]{36})(?:\/(run|stop))?)?$/.exec(
      url.pathname,
    );
    const overview = url.pathname === "/api/work/overview";
    const assistants = url.pathname === "/api/assistants";
    if (!match && !overview && !assistants) return false;
    try {
      const host = req.headers.host ?? "";
      if (
        !/^(localhost|127\.0\.0\.1|\[::1\])(?::[0-9]{1,5})?$/.test(host) ||
        (req.headers.origin && req.headers.origin !== `http://${host}`)
      )
        throw new WorkError("ORIGIN", "Origin not allowed", 403);
      const method = req.method ?? "GET";
      if (overview && method === "GET") {
        json(res, 200, await work.overview());
        return true;
      }
      if (assistants && method === "GET") {
        const accounts = credentials();
        const runs: (AgentRun & { projectId: string; projectName: string; title: string })[] = [];
        for (const project of registry.list())
          for (const conversation of project.conversations) {
            const summary = await chat.missionSummary(conversation.id);
            for (const run of summary?.agentRuns ?? [])
              runs.push({
                ...run,
                projectId: project.id,
                projectName: project.name,
                title: conversation.name,
              });
          }
        json(res, 200, {
          providers: ["claude", "codex"].map((provider) => {
            const account = accounts[provider as "claude" | "codex"];
            const history = runs.filter((run) => run.agentKind === provider);
            const active = registry.list().flatMap((project) =>
              project.conversations
                .filter(
                  (conversation) =>
                    chat.isRunning(conversation.id) &&
                    conversation.activeAgent?.toLowerCase().includes(provider),
                )
                .map((conversation) => ({
                  projectId: project.id,
                  projectName: project.name,
                  conversationId: conversation.id,
                  title: conversation.name,
                })),
            );
            return {
              id: provider,
              connected: account.mode !== "none",
              mode: account.mode,
              account: account.account ?? null,
              active,
              executions: history.length,
              costUsd: history.reduce((sum, run) => sum + run.costUsd, 0),
              recent: history
                .sort((a, b) => b.endedAt - a.endedAt)
                .slice(0, 5)
                .map((run) => ({
                  projectId: run.projectId,
                  conversationId: run.missionId,
                  projectName: run.projectName,
                  title: run.title,
                  model: run.model,
                  endedAt: run.endedAt,
                  costUsd: run.costUsd,
                })),
            };
          }),
          routerConfigured: accounts.typesafe.configured,
        });
        return true;
      }
      if (match) {
        const [, kind, id, action] = match;
        if (kind === "work-items") {
          if (!id && method === "POST")
            json(res, 201, await work.create(workInputSchema.parse(await body(req))));
          else if (id && !action && method === "PUT")
            json(res, 200, await work.edit(id, workInputSchema.parse(await body(req))));
          else if (id && !action && method === "DELETE") {
            await work.remove(id);
            json(res, 200, { ok: true });
          } else if (id && action === "run" && method === "POST")
            json(res, 202, await work.start(id));
          else if (id && action === "stop" && method === "POST") {
            await work.stop(id);
            json(res, 200, { ok: true });
          } else throw new WorkError("METHOD", "Method not allowed", 405);
        } else {
          if (!id && method === "POST")
            json(res, 201, await work.saveSchedule(scheduleInputSchema.parse(await body(req))));
          else if (id && !action && method === "PUT")
            json(res, 200, await work.saveSchedule(scheduleInputSchema.parse(await body(req)), id));
          else if (id && !action && method === "PATCH")
            json(
              res,
              200,
              await work.toggleSchedule(
                id,
                z.object({ enabled: z.boolean() }).parse(await body(req)).enabled,
              ),
            );
          else if (id && !action && method === "DELETE") {
            await work.removeSchedule(id);
            json(res, 200, { ok: true });
          } else throw new WorkError("METHOD", "Method not allowed", 405);
        }
        return true;
      }
      throw new WorkError("METHOD", "Method not allowed", 405);
    } catch (error) {
      const known = error instanceof WorkError;
      const busy =
        error instanceof Error &&
        /busy|active workspace operation|already running/.test(error.message);
      json(
        res,
        known
          ? error.status
          : busy
            ? 409
            : error instanceof z.ZodError || error instanceof SyntaxError
              ? 400
              : 500,
        {
          code: known
            ? error.code
            : busy
              ? "BUSY"
              : error instanceof z.ZodError || error instanceof SyntaxError
                ? "INVALID_INPUT"
                : "STORAGE_ERROR",
          error: known ? error.message : "Unable to complete this operation",
        },
      );
      return true;
    }
  };
}
