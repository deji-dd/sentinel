import { randomUUID } from "crypto";
import { IpcClient, IpcServer, IPC_SOCKET_PATHS } from "@sentinel/utils/ipc";
import { Logger } from "@sentinel/utils";

const logger = new Logger("ApiIPC");

type PendingRequest = {
  resolve: (data: any) => void;
  reject: (reason: any) => void;
  timer: NodeJS.Timeout;
};

const pendingRequests = new Map<string, PendingRequest>();

function handleIncomingMessage(message: any) {
  if (message?.requestId) {
    const pending = pendingRequests.get(message.requestId);
    if (pending) {
      clearTimeout(pending.timer);
      pendingRequests.delete(message.requestId);
      pending.resolve(message.data);
      return;
    }
  }
}

// Point-to-Point Clients connecting directly to target socket servers
export const workerIpcClient = new IpcClient(IPC_SOCKET_PATHS.worker, handleIncomingMessage);
export const botIpcClient = new IpcClient(IPC_SOCKET_PATHS.bot, handleIncomingMessage);

// Re-export workerIpcClient as default ipcClient for backwards compatibility
export const ipcClient = workerIpcClient;

// API Socket Server listening for direct incoming connections on api.sock
export const apiIpcServer = new IpcServer(IPC_SOCKET_PATHS.api, (message: any) => {
  if (message?.action === "get_telemetry") {
    const apiMem = process.memoryUsage();
    apiIpcServer.broadcast({
      action: "get_telemetry_response",
      requestId: message.requestId,
      data: {
        pid: process.pid,
        status: "online",
        uptimeSeconds: Math.round(process.uptime()),
        memory: {
          rssBytes: apiMem.rss,
          heapTotalBytes: apiMem.heapTotal,
          heapUsedBytes: apiMem.heapUsed,
          externalBytes: apiMem.external,
        },
      },
    });
  }
});
apiIpcServer.start();

/**
 * Sends a typed request directly to worker or bot over Point-to-Point UDS.
 */
export async function sendIpcRequest<T = any>(
  action: string,
  data: unknown,
  timeoutMs = 20_000,
  target: "worker" | "bot" = "worker",
): Promise<T> {
  const requestId = randomUUID();
  const client = target === "bot" ? botIpcClient : workerIpcClient;

  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingRequests.delete(requestId);
      reject(
        new Error(
          `IPC request '${action}' to '${target}' timed out. Target did not respond in time.`,
        ),
      );
    }, timeoutMs);

    pendingRequests.set(requestId, { resolve, reject, timer });

    client.send({ action, requestId, data });
  });
}
