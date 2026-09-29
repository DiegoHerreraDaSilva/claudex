import type { Server } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import type {
  AccountAction,
  AccountResult,
  LineSink,
  ProviderId,
} from "../accounts.js";
import type { OrchestratorEventName } from "../events.js";
import type { Orchestrator } from "../orchestrator.js";
import type { CredentialStatus } from "../prerequisites.js";

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

interface SettingsMessage {
  type: "settings";
  values: Record<string, string>;
}

interface AccountMessage {
  type: "account";
  provider: ProviderId;
  action: AccountAction;
}

export interface RealtimeHooks {
  getCredentialStatus: () => CredentialStatus;
  applySettings: (values: Record<string, string>) => CredentialStatus;
  runAccountAction: (
    provider: ProviderId,
    action: AccountAction,
    onLine: LineSink,
  ) => Promise<AccountResult>;
}

export function attachRealtime(
  server: Server,
  orchestrator: Orchestrator,
  hooks: RealtimeHooks,
): WebSocketServer {
  const wss = new WebSocketServer({ server });

  const broadcast = (payload: unknown): void => {
    const encoded = JSON.stringify(payload);
    for (const client of wss.clients) {
      if (client.readyState === WebSocket.OPEN) client.send(encoded);
    }
  };

  wss.on("connection", (socket: WebSocket) => {
    socket.send(JSON.stringify({ type: "snapshot", data: orchestrator.getFleetState() }));
    socket.send(JSON.stringify({ type: "credentials", data: hooks.getCredentialStatus() }));

    socket.on("message", (raw: Buffer | string) => {
      let parsed: CommandMessage | SettingsMessage | AccountMessage;
      try {
        parsed = JSON.parse(raw.toString()) as CommandMessage | SettingsMessage | AccountMessage;
      } catch {
        return;
      }

      if (parsed.type === "command") {
        if (parsed.action === "pause") orchestrator.pause();
        else if (parsed.action === "resume") orchestrator.resume();
        else if (parsed.action === "kill" && parsed.taskId) orchestrator.kill(parsed.taskId);
        broadcast({ type: "command:ack", action: parsed.action, taskId: parsed.taskId ?? null });
        return;
      }

      if (parsed.type === "account") {
        const { provider, action } = parsed;
        broadcast({ type: "account:start", provider, action });
        const onLine: LineSink = (stream, line) => {
          broadcast({ type: "account:output", provider, stream, line });
        };
        void hooks
          .runAccountAction(provider, action, onLine)
          .then((result) => {
            broadcast({ type: "account:done", data: result });
            broadcast({ type: "credentials", data: hooks.getCredentialStatus() });
          })
          .catch((err: unknown) => {
            broadcast({
              type: "account:done",
              data: {
                provider,
                action,
                ok: false,
                code: null,
                message: err instanceof Error ? err.message : String(err),
              },
            });
          });
        return;
      }

      if (parsed.type === "settings") {
        try {
          const status = hooks.applySettings(parsed.values ?? {});
          broadcast({ type: "credentials", data: status });
          broadcast({ type: "settings:ack", ok: true });
          socket.send(JSON.stringify({ type: "settings:ack", ok: true, data: status }));
        } catch (err) {
          socket.send(
            JSON.stringify({
              type: "settings:ack",
              ok: false,
              error: err instanceof Error ? err.message : String(err),
            }),
          );
        }
      }
    });
  });

  for (const name of EVENT_NAMES) {
    orchestrator.on(name, (data) => {
      broadcast({ type: "event", event: name, data });
    });
  }

  return wss;
}
