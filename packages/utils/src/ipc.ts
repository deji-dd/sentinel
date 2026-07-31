import net from "net";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { Logger } from "./logger.js";

const logger = new Logger("IPC");

/**
 * Default Unix socket path for IPC communication, resolved relative to this
 * package file so it points to `<workspace-root>/data/sentinel_ipc.sock`
 * regardless of which app's `process.cwd()` is active.
 */
export const DEFAULT_IPC_SOCKET_PATH = path.resolve(
  fileURLToPath(new URL("../../../", import.meta.url)),
  "data/sentinel_ipc.sock",
);

export type IpcMessageHandler<T = unknown> = (message: T) => void;

/**
 * Optimized Unix Domain Socket (UDS) IPC Server.
 * Listens on a Unix socket path and parses newline-delimited JSON messages.
 */
export class IpcServer<T = unknown> {
  private server: net.Server;
  private socketPath: string;
  private onMessage: IpcMessageHandler<T>;
  private shutdownHook: () => void;
  private activeSockets = new Set<net.Socket>();

  constructor(socketPath: string, onMessage: IpcMessageHandler<T>) {
    this.socketPath = socketPath;
    this.onMessage = onMessage;

    this.server = net.createServer((socket) => {
      this.activeSockets.add(socket);
      let buffer = "";

      socket.on("data", (chunk) => {
        buffer += chunk.toString("utf8");
        let newlineIndex: number;

        while ((newlineIndex = buffer.indexOf("\n")) !== -1) {
          const rawMessage = buffer.slice(0, newlineIndex).trim();
          buffer = buffer.slice(newlineIndex + 1);

          if (rawMessage) {
            try {
              const payload = JSON.parse(rawMessage);
              this.onMessage(payload);
            } catch (err) {
              logger.error("Failed to parse incoming IPC message:", err);
            }
          }
        }
      });

      socket.on("error", (err) => {
        logger.error(`IPC Socket Error: ${err.message}`);
      });

      socket.on("close", () => {
        this.activeSockets.delete(socket);
      });
    });

    this.server.on("error", (err) => {
      logger.error(`IPC Server Error: ${err.message}`);
    });

    this.shutdownHook = () => this.close();
    process.on("SIGINT", this.shutdownHook);
    process.on("SIGTERM", this.shutdownHook);
  }

  /**
   * Starts listening on the configured socket path.
   */
  start(): void {
    const parentDir = path.dirname(this.socketPath);
    if (!fs.existsSync(parentDir)) {
      try {
        fs.mkdirSync(parentDir, { recursive: true });
      } catch (err) {
        logger.error(`Failed to create socket directory at ${parentDir}:`, err);
      }
    }

    if (fs.existsSync(this.socketPath)) {
      try {
        fs.unlinkSync(this.socketPath);
      } catch (err) {
        logger.error(`Failed to unlink stale socket at ${this.socketPath}:`, err);
      }
    }

    this.server.listen(this.socketPath, () => {
      logger.info(`IPC Server listening on ${this.socketPath}`);
    });
  }

  /**
   * Broadcasts a JSON message to all connected clients.
   */
  broadcast(payload: T): void {
    const data = JSON.stringify(payload) + "\n";
    for (const socket of this.activeSockets) {
      if (!socket.destroyed) {
        socket.write(data);
      }
    }
  }

  /**
   * Gracefully shuts down the server and removes socket file.
   */
  close(): void {
    logger.info(`Shutting down IPC Server at ${this.socketPath}`);
    process.removeListener("SIGINT", this.shutdownHook);
    process.removeListener("SIGTERM", this.shutdownHook);

    for (const socket of this.activeSockets) {
      socket.destroy();
    }
    this.activeSockets.clear();

    this.server.close();

    if (fs.existsSync(this.socketPath)) {
      try {
        fs.unlinkSync(this.socketPath);
      } catch (e) {
        // silent cleanup catch
      }
    }
  }
}

/**
 * Optimized UDS IPC Client with exponential backoff and bounded memory queue.
 */
export class IpcClient<T = unknown> {
  private socketPath: string;
  private socket: net.Socket | null = null;
  private isConnecting = false;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private reconnectAttempts = 0;
  private messageQueue: string[] = [];
  private maxQueueSize = 1000;
  private onMessage?: IpcMessageHandler<T>;

  constructor(socketPath: string, onMessage?: IpcMessageHandler<T>) {
    this.socketPath = socketPath;
    this.onMessage = onMessage;
    this.connect();
  }

  private connect(): void {
    if (this.isConnecting || this.socket) return;
    this.isConnecting = true;

    const socket = net.createConnection(this.socketPath);
    let buffer = "";

    socket.on("connect", () => {
      this.isConnecting = false;
      this.socket = socket;
      this.reconnectAttempts = 0;
      logger.info(`IPC Client connected to ${this.socketPath}`);

      // Flush queued messages
      while (this.messageQueue.length > 0) {
        const msg = this.messageQueue.shift();
        if (msg && this.socket && !this.socket.destroyed) {
          this.socket.write(msg);
        }
      }
    });

    socket.on("data", (chunk) => {
      if (!this.onMessage) return;
      buffer += chunk.toString("utf8");
      let newlineIndex: number;

      while ((newlineIndex = buffer.indexOf("\n")) !== -1) {
        const rawMessage = buffer.slice(0, newlineIndex).trim();
        buffer = buffer.slice(newlineIndex + 1);

        if (rawMessage) {
          try {
            this.onMessage(JSON.parse(rawMessage));
          } catch (err) {
            logger.error("Failed to parse incoming client IPC message:", err);
          }
        }
      }
    });

    socket.on("error", (err: Error & { code?: string }) => {
      if (err.code !== "ENOENT" && err.code !== "ECONNREFUSED") {
        logger.error(`IPC Client Error: ${err.message}`);
      }
      this.cleanup();
    });

    socket.on("close", () => {
      this.cleanup();
    });
  }

  private cleanup(): void {
    if (this.socket) {
      this.socket.removeAllListeners();
      this.socket.destroy();
      this.socket = null;
    }
    this.isConnecting = false;

    // Exponential backoff reconnect: 1s, 2s, 4s, max 10s
    if (!this.reconnectTimer) {
      this.reconnectAttempts++;
      const backoffMs = Math.min(1000 * Math.pow(2, this.reconnectAttempts - 1), 10000);
      this.reconnectTimer = setTimeout(() => {
        this.reconnectTimer = null;
        this.connect();
      }, backoffMs);
    }
  }

  /**
   * Sends a JSON payload to the IPC server, or queues it if disconnected.
   */
  send(payload: T): void {
    const data = JSON.stringify(payload) + "\n";
    if (this.socket && !this.socket.destroyed) {
      this.socket.write(data);
    } else {
      if (this.messageQueue.length >= this.maxQueueSize) {
        this.messageQueue.shift(); // Drop oldest message to prevent memory leaks
      }
      this.messageQueue.push(data);
    }
  }

  /**
   * Closes the client connection and cancels reconnect timers.
   */
  close(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.cleanup();
  }
}
