import { createServer, type Server, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { FleetUpdatedEvent } from "../events.js";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

export interface FleetProvider {
  getFleetState(): FleetUpdatedEvent;
}

function defaultDashboardDir(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "dashboard");
}

export function createStaticServer(
  provider: FleetProvider,
  options: { dashboardDir?: string; startedAt?: number } = {},
): Server {
  const dashboardDir = options.dashboardDir ?? defaultDashboardDir();
  const startedAt = options.startedAt ?? Date.now();

  return createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://localhost");

      if (url.pathname === "/health") {
        const fleet = provider.getFleetState();
        return sendJson(res, 200, {
          status: "ok",
          uptime: Math.round((Date.now() - startedAt) / 1000),
          tasks: fleet.tasks.length,
          parallelized: fleet.parallelized,
        });
      }

      if (url.pathname === "/api/state") {
        return sendJson(res, 200, provider.getFleetState());
      }

      const relative = url.pathname === "/" ? "index.html" : url.pathname.replace(/^\/+/, "");
      const target = path.resolve(dashboardDir, relative);
      if (!target.startsWith(dashboardDir)) {
        return sendJson(res, 403, { error: "forbidden" });
      }

      let filePath = target;
      try {
        const info = await stat(filePath);
        if (info.isDirectory()) filePath = path.join(filePath, "index.html");
      } catch {
        filePath = path.join(dashboardDir, "index.html");
      }

      const body = await readFile(filePath);
      res.writeHead(200, {
        "Content-Type": MIME[path.extname(filePath)] ?? "application/octet-stream",
        "Cache-Control": "no-cache",
      });
      res.end(body);
    } catch (err) {
      sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
    }
  });
}

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(body);
}

export type { IncomingMessage };
