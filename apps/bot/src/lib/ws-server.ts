/* eslint-disable @typescript-eslint/no-explicit-any */
import { WebSocketServer, WebSocket } from "ws";
import { type Server } from "http";
import { Logger } from "./logger.js";

const logger = new Logger("WS");

class WebSocketManager {
  private wss: WebSocketServer | null = null;
  private clients: Set<WebSocket> = new Set();

  /**
   * Initialize the WebSocket server by attaching to the Express HTTP server
   */
  public init(server: Server) {
    this.wss = new WebSocketServer({ noServer: true });

    server.on("upgrade", (request, socket, head) => {
      const url = new URL(request.url || "", `http://${request.headers.host}`);
      if (url.pathname === "/ws") {
        this.wss?.handleUpgrade(request, socket, head, (ws) => {
          this.wss?.emit("connection", ws, request);
        });
      } else {
        socket.destroy();
      }
    });

    this.wss.on("connection", (ws: WebSocket) => {
      logger.info("Client connected to real-time feed");
      this.clients.add(ws);

      // Send greeting
      ws.send(
        JSON.stringify({
          type: "connection_established",
          payload: { status: "ready" },
          timestamp: Date.now(),
        })
      );

      ws.on("message", (message) => {
        try {
          const data = JSON.parse(message.toString());
          if (data.type === "ping") {
            ws.send(JSON.stringify({ type: "pong", timestamp: Date.now() }));
          }
        } catch {
          // Mute JSON parse issues
        }
      });

      ws.on("close", () => {
        logger.info("Client disconnected");
        this.clients.delete(ws);
      });

      ws.on("error", (err) => {
        logger.error(`WebSocket client error: ${err.message}`);
        this.clients.delete(ws);
      });
    });

    logger.info("WebSocket upgrade listener registered on /ws");
  }

  /**
   * Broadcast a message to all connected dashboard clients
   */
  public broadcast(type: string, payload: any) {
    if (!this.wss) return;
    const message = JSON.stringify({ type, payload, timestamp: Date.now() });
    
    let activeClientCount = 0;
    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
        activeClientCount++;
      }
    }
    
    if (activeClientCount > 0) {
      logger.info(`Broadcasted event "${type}" to ${activeClientCount} client(s)`);
    }
  }
}

export const wsManager = new WebSocketManager();
