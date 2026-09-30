/**
 * Versioned WebSocket protocol shared by the chat app server and the dashboard.
 * The browser client mirrors these message shapes and ignores the `v` field.
 */
export const PROTOCOL_VERSION = 1;

export function envelope<T extends { type: string }>(message: T): T & { v: number } {
  return { v: PROTOCOL_VERSION, ...message };
}

export type ServerMessageType =
  | "projects"
  | "credentials"
  | "settings:ack"
  | "account:start"
  | "account:output"
  | "account:done"
  | "chat:message"
  | "chat:routing"
  | "chat:turn"
  | "chat:diff"
  | "chat:conversations"
  | "chat:usage"
  | "chat:error"
  | "snapshot"
  | "command:ack";

export type ClientMessageType =
  | "chat:send"
  | "chat:action"
  | "chat:stop"
  | "conversation:create"
  | "conversation:rename"
  | "conversation:delete"
  | "conversation:select"
  | "project:delete"
  | "settings"
  | "account"
  | "command";
