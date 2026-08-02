import { randomUUID } from "crypto";
import { IpcClient, IpcServer, IPC_SOCKET_PATHS } from "@sentinel/utils/ipc";
import { logger } from "./logger.js";

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

// Point-to-Point Client connecting directly to worker.sock
export const workerIpcClient = new IpcClient(IPC_SOCKET_PATHS.worker, (message: any) => {
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

export const ipcClient = workerIpcClient;

// Bot Socket Server listening for direct incoming connections on bot.sock
export const botIpcServer = new IpcServer(IPC_SOCKET_PATHS.bot, (message: any) => {
  if (message?.action === "get_telemetry") {
    const botMem = process.memoryUsage();
    botIpcServer.broadcast({
      action: "get_telemetry_response",
      requestId: message.requestId,
      data: {
        pid: process.pid,
        status: "online",
        uptimeSeconds: Math.round(process.uptime()),
        memory: {
          rssBytes: botMem.rss,
          heapTotalBytes: botMem.heapTotal,
          heapUsedBytes: botMem.heapUsed,
          externalBytes: botMem.external,
        },
      },
    });
  }
});
botIpcServer.start();

/**
 * Sends a verification job request directly over Point-to-Point UDS to the worker process.
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

    workerIpcClient.send({
      action: "verification_request",
      requestId,
      data: jobData,
    });
  });
}
