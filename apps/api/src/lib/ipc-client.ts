import { randomUUID } from "crypto";
import { IpcClient, DEFAULT_IPC_SOCKET_PATH } from "@sentinel/utils/ipc";
import { Logger } from "@sentinel/utils";

const logger = new Logger("ApiIPC");

const socketPath = process.env.IPC_SOCKET_PATH ?? DEFAULT_IPC_SOCKET_PATH;

type PendingRequest = {
  resolve: (data: any) => void;
  reject: (reason: any) => void;
  timer: NodeJS.Timeout;
};

const messageListeners = new Set<(message: any) => void>();
const pendingRequests = new Map<string, PendingRequest>();

/**
 * Registers a listener for unsolicited IPC messages pushed from the worker.
 */
export function addIpcMessageListener(listener: (message: any) => void): void {
  messageListeners.add(listener);
}

/**
 * Removes a previously registered IPC message listener.
 */
export function removeIpcMessageListener(
  listener: (message: any) => void,
): void {
  messageListeners.delete(listener);
}

export const ipcClient = new IpcClient(socketPath, (message: any) => {
  // Route request/response correlation
  if (message?.requestId) {
    const pending = pendingRequests.get(message.requestId);
    if (pending) {
      clearTimeout(pending.timer);
      pendingRequests.delete(message.requestId);
      pending.resolve(message.data);
      return;
    }
  }

  // Fan-out to registered broadcast listeners
  for (const listener of messageListeners) {
    try {
      listener(message);
    } catch (err) {
      logger.error("Error in API IPC message listener:", err);
    }
  }
});

/**
 * Sends a typed request to the worker over IPC and waits for a correlated response.
 */
export async function sendIpcRequest<T = any>(
  action: string,
  data: unknown,
  timeoutMs = 20_000,
): Promise<T> {
  const requestId = randomUUID();

  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingRequests.delete(requestId);
      reject(
        new Error(
          `IPC request '${action}' timed out. Worker did not respond in time.`,
        ),
      );
    }, timeoutMs);

    pendingRequests.set(requestId, { resolve, reject, timer });

    ipcClient.send({ action, requestId, data });
  });
}
