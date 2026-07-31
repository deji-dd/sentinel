import { randomUUID } from "crypto";
import { IpcClient, DEFAULT_IPC_SOCKET_PATH } from "@sentinel/utils/ipc";
import { logger } from "./logger.js";

const socketPath = process.env.IPC_SOCKET_PATH ?? DEFAULT_IPC_SOCKET_PATH;

type PendingRequest = {
  resolve: (data: any) => void;
  reject: (reason: any) => void;
  timer: NodeJS.Timeout;
};

const messageListeners = new Set<(message: any) => void>();
const pendingRequests = new Map<string, PendingRequest>();

export function addIpcMessageListener(listener: (message: any) => void): void {
  messageListeners.add(listener);
}

export const ipcClient = new IpcClient(socketPath, (message: any) => {
  if (message?.action === "verification_response" && message.requestId) {
    const pending = pendingRequests.get(message.requestId);
    if (pending) {
      clearTimeout(pending.timer);
      pendingRequests.delete(message.requestId);
      pending.resolve(message.data);
    }
  }

  for (const listener of messageListeners) {
    try {
      listener(message);
    } catch (err) {
      logger.error("Error in IPC message listener:", err);
    }
  }
});

/**
 * Sends a verification job request over UDS IPC to the worker process.
 */
export async function sendVerificationRequest(
  jobData: {
    guild_id: string;
    channel_id: string;
    discord_id: string;
    current_role_ids: string[];
    current_nickname: string | null;
  },
  timeoutMs = 20000,
): Promise<any> {
  const requestId = randomUUID();

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingRequests.delete(requestId);
      reject(new Error("Verification job timed out. Worker process did not respond in time."));
    }, timeoutMs);

    pendingRequests.set(requestId, { resolve, reject, timer });

    ipcClient.send({
      action: "verification_request",
      requestId,
      data: jobData,
    });
  });
}
