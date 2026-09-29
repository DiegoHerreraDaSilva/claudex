import type { Server } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import type { OrchestratorEventName } from "../events.js";
import type { Orchestrator } from "../orchestrator.js";

const EVENT_NAMES: OrchestratorEventName[] = [
  "task:created",
  "task:decided",
  "task:started",
  "task:message",
  "task:completed",
  "task:failed",
  "fleet:updated",
];

interface CommandMessage {
  type: "command";
  action: "pause" | "resume" | "kill";
  taskId?: string;
}

export function attachRealtime(server: Server, orchestrator: Orchestrator): WebSocketServer {
  const wss = new WebSocketServer({ server });

  const broadcast = (payload: unknown): void => {
    const encoded = JSON.stringify(payload);
    for (const client of wss.clients) {
      if (client.readyState === WebSocket.OPEN) client.send(encoded);
    }
  };

  wss.on("connection", (socket: WebSocket) => {
    socket.send(JSON.stringify({ type: "snapshot", data: orchestrator.getFleetState() }));

    socket.on("message", (raw: Buffer | string) => {
      let parsed: CommandMessage;
      try {
        parsed = JSON.parse(raw.toString()) as CommandMessage;
      } catch {
        return;
      }
      if (parsed.type !== "command") return;
      if (parsed.action === "pause") orchestrator.pause();
      else if (parsed.action === "resume") orchestrator.resume();
      else if (parsed.action === "kill" && parsed.taskId) orchestrator.kill(parsed.taskId);
      broadcast({ type: "command:ack", action: parsed.action, taskId: parsed.taskId ?? null });
    });
  });

  for (const name of EVENT_NAMES) {
    orchestrator.on(name, (data) => {
      broadcast({ type: "event", event: name, data });
    });
  }

  return wss;
}
