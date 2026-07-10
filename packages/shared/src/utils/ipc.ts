import net from "net";
import fs from "fs";
import { Logger } from "./logger.js";

const logger = new Logger("IPC");

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type IpcMessageHandler = (message: any) => void;

/**
 * UDS IPC Server implementation.
 * Listens on a Unix Domain Socket and splits incoming streams by newline to parse JSON.
 */
export class IpcServer {
  private server: net.Server;
  private path: string;
  private onMessage: IpcMessageHandler;
  private shutdownHook: () => void;

  constructor(socketPath: string, onMessage: IpcMessageHandler) {
    this.path = socketPath;
    this.onMessage = onMessage;
    this.server = net.createServer((socket) => {
      let buffer = "";

      socket.on("data", (data) => {
        buffer += data.toString();
        let newlineIndex;

        while ((newlineIndex = buffer.indexOf("\n")) !== -1) {
          const chunk = buffer.slice(0, newlineIndex);
          buffer = buffer.slice(newlineIndex + 1);

          if (chunk.trim()) {
            try {
              const payload = JSON.parse(chunk);
              this.onMessage(payload);
            } catch (err) {
              logger.error("Failed to parse incoming IPC message:", err);
            }
          }
        }
      });

      socket.on("error", (err) => {
        logger.error(`IPC Server Socket Error: ${err.message}`);
      });
    });

    this.server.on("error", (err) => {
      logger.error(`IPC Server Error: ${err.message}`);
    });

    // Graceful shutdown handling
    this.shutdownHook = () => this.close();
    process.on("SIGINT", this.shutdownHook);
    process.on("SIGTERM", this.shutdownHook);
  }

  public start() {
    if (fs.existsSync(this.path)) {
      try {
        fs.unlinkSync(this.path);
      } catch (err) {
        logger.error(`Failed to unlink existing socket ${this.path}`, err);
      }
    }

    this.server.listen(this.path, () => {
      logger.info(`IPC Server listening on ${this.path}`);
    });
  }

  public close() {
    logger.info(`Shutting down IPC Server at ${this.path}`);
    this.server.close();
    process.removeListener("SIGINT", this.shutdownHook);
    process.removeListener("SIGTERM", this.shutdownHook);
    if (fs.existsSync(this.path)) {
      try {
        fs.unlinkSync(this.path);
      } catch (e) {
        /* silent */
      }
    }
  }
}

/**
 * UDS IPC Client implementation.
 * Connects to a Unix Domain Socket, auto-reconnects, and queues messages if disconnected.
 */
export class IpcClient {
  private path: string;
  private socket: net.Socket | null = null;
  private isConnecting = false;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private messageQueue: string[] = [];
  private onMessage?: IpcMessageHandler;

  constructor(socketPath: string, onMessage?: IpcMessageHandler) {
    this.path = socketPath;
    this.onMessage = onMessage;
    this.connect();
  }

  private connect() {
    if (this.isConnecting || this.socket) return;
    this.isConnecting = true;

    const socket = net.createConnection(this.path);

    let buffer = "";

    socket.on("connect", () => {
      this.isConnecting = false;
      this.socket = socket;
      // Flush queue
      while (this.messageQueue.length > 0) {
        const msg = this.messageQueue.shift();
        if (msg) this.socket.write(msg + "\n");
      }
    });

    socket.on("data", (data) => {
      if (!this.onMessage) return;
      buffer += data.toString();
      let newlineIndex;
      while ((newlineIndex = buffer.indexOf("\n")) !== -1) {
        const chunk = buffer.slice(0, newlineIndex);
        buffer = buffer.slice(newlineIndex + 1);
        if (chunk.trim()) {
          try {
            this.onMessage(JSON.parse(chunk));
          } catch (err) {
            logger.error("Failed to parse incoming IPC client message:", err);
          }
        }
      }
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    socket.on("error", (err: any) => {
      // Ignore ENOENT/ECONNREFUSED as they just mean the server isn't up
      if (err.code !== "ENOENT" && err.code !== "ECONNREFUSED") {
        logger.error(`IPC Client Error: ${err.message}`);
      }
      this.cleanup();
    });

    socket.on("close", () => {
      this.cleanup();
    });
  }

  private cleanup() {
    if (this.socket) {
      this.socket.destroy();
      this.socket = null;
    }
    this.isConnecting = false;

    // Auto reconnect
    if (!this.reconnectTimer) {
      this.reconnectTimer = setTimeout(() => {
        this.reconnectTimer = null;
        this.connect();
      }, 5000); // 5s backoff
    }
  }

  /**
   * Send a JSON payload to the IPC Server
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  public send(payload: any) {
    const data = JSON.stringify(payload);
    if (this.socket && !this.socket.destroyed) {
      this.socket.write(data + "\n");
    } else {
      // Queue it up (limit to 1000 messages to prevent memory leak)
      if (this.messageQueue.length < 1000) {
        this.messageQueue.push(data);
      }
    }
  }
}
