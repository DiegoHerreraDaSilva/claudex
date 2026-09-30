import { randomUUID } from "node:crypto";
import type { PermissionAction } from "./permissionBroker.js";
export interface PermissionInput {
  projectId: string;
  conversationId: string;
  action: PermissionAction;
  tool: string;
  detail: string;
}
export interface PermissionRequest extends PermissionInput {
  id: string;
  createdAt: number;
  expiresAt: number;
}
export type PermissionNotice =
  | { type: "requested"; request: PermissionRequest }
  | { type: "resolved"; id: string; approved: boolean };
export class PermissionCoordinator {
  private readonly pending = new Map<
    string,
    { request: PermissionRequest; finish: (approved: boolean) => void }
  >();
  constructor(
    private readonly notice?: (event: PermissionNotice) => void,
    private readonly timeoutMs = 90_000,
  ) {}
  list(): PermissionRequest[] {
    return [...this.pending.values()].map((item) => item.request);
  }
  resolve(id: string, approved: boolean): boolean {
    const item = this.pending.get(id);
    if (!item) return false;
    if (Date.now() >= item.request.expiresAt) {
      item.finish(false);
      return false;
    }
    item.finish(approved);
    return true;
  }
  request(input: PermissionInput, signal: AbortSignal): Promise<boolean> {
    if (signal.aborted || this.pending.size >= 16) return Promise.resolve(false);
    const request: PermissionRequest = {
      ...input,
      detail: input.detail.slice(0, 8000),
      id: randomUUID(),
      createdAt: Date.now(),
      expiresAt: Date.now() + this.timeoutMs,
    };
    return new Promise((resolve) => {
      const finish = (approved: boolean) => {
        if (!this.pending.delete(request.id)) return;
        clearTimeout(timer);
        signal.removeEventListener("abort", abort);
        this.notice?.({ type: "resolved", id: request.id, approved });
        resolve(approved);
      };
      const abort = () => finish(false);
      const timer = setTimeout(abort, this.timeoutMs);
      this.pending.set(request.id, { request, finish });
      signal.addEventListener("abort", abort, { once: true });
      this.notice?.({ type: "requested", request });
      if (signal.aborted) abort();
    });
  }
}
