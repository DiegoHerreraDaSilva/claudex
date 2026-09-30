import type { WebSocket } from "ws";
import { runAccountAction, type AccountAction, type AccountResult, type LineSink, type ProviderId } from "../accounts.js";
import { getConfig, setEnvValues } from "../config.js";
import { getCredentialStatus, type CredentialStatus } from "../prerequisites.js";

export interface SettingsHooks {
  getCredentialStatus: () => CredentialStatus;
  applySettings: (values: Record<string, string>) => CredentialStatus;
  runAccountAction: (
    provider: ProviderId,
    action: AccountAction,
    onLine: LineSink,
  ) => Promise<AccountResult>;
}

export function defaultSettingsHooks(): SettingsHooks {
  return {
    getCredentialStatus: () => getCredentialStatus(getConfig()),
    applySettings: (values) => {
      setEnvValues(getConfig().projectRoot, values);
      return getCredentialStatus(getConfig());
    },
    runAccountAction: (provider, action, onLine) =>
      runAccountAction(provider, action, getConfig().projectRoot, onLine),
  };
}

export interface SettingsIncoming {
  type?: string;
  values?: Record<string, string>;
  provider?: string;
  action?: string;
}

/**
 * Handles `settings` and `account` messages shared by the chat app and dashboard.
 * Returns true when the message was consumed.
 */
export function handleSettingsMessage(
  parsed: SettingsIncoming,
  socket: WebSocket,
  broadcast: (payload: unknown) => void,
  hooks: SettingsHooks,
): boolean {
  if (
    parsed.type === "account" &&
    (parsed.provider === "claude" || parsed.provider === "codex") &&
    (parsed.action === "login" || parsed.action === "logout")
  ) {
    const provider: ProviderId = parsed.provider;
    const action: AccountAction = parsed.action;
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
    return true;
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
    return true;
  }

  return false;
}
