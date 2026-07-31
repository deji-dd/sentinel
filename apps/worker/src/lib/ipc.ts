import { ipcServer } from "../index.js";
import type { IpcBotMessage } from "@sentinel/schemas";

/**
 * Dispatches a strongly-typed IPC payload to connected clients (e.g. Discord Bot / API).
 */
export function dispatchToBot(payload: IpcBotMessage): void {
  if (ipcServer) {
    ipcServer.broadcast(payload);
  }
}
