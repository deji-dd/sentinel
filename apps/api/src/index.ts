import Fastify, { type FastifyError } from "fastify";
import cors from "@fastify/cors";
import { db } from "@sentinel/database";
import { Logger } from "@sentinel/utils";
import { guildRoutes } from "./routes/guilds.js";
// Establish IPC connection to worker at startup (auto-reconnects on worker restart)
import { ipcClient } from "./lib/ipc-client.js";
const logger = new Logger("SentinelApi");
const PORT = parseInt(process.env.API_PORT || "3001", 10);
const HOST = process.env.API_HOST || "0.0.0.0";

const app = Fastify({
  logger: false,
});

/**
 * Initialize plugins, routes, and start Fastify server
 */
async function startServer(): Promise<void> {
  try {
    // Request logging hooks
    app.addHook("onRequest", async (request) => {
      (request as any).startTime = performance.now();
    });

    app.addHook("onResponse", async (request, reply) => {
      const startTime = (request as any).startTime || performance.now();
      const duration = Math.round(performance.now() - startTime);
      const method = request.method;
      const url = request.url;
      const status = reply.statusCode;

      logger.info(`${method} ${url} -> ${status} (${duration}ms)`);
    });

    // Centralized error handler logging
    app.setErrorHandler((error: FastifyError, request, reply) => {
      logger.error(`Error processing ${request.method} ${request.url}:`, error);
      const statusCode = error.statusCode ?? 500;
      reply.status(statusCode).send({
        error: error.name ?? "InternalServerError",
        message: error.message ?? "An internal server error occurred",
      });
    });

    await app.register(cors, {
      origin: true,
      credentials: true,
    });

    // Register Guild Routes
    await app.register(guildRoutes);

    // Health check endpoint
    app.get("/health", async (_request, reply) => {
      try {
        await db.$queryRaw`SELECT 1`;
        return reply.send({
          status: "ok",
          component: "sentinel-api",
          timestamp: new Date().toISOString(),
          database: "connected",
        });
      } catch (err) {
        return reply.status(503).send({
          status: "error",
          component: "sentinel-api",
          timestamp: new Date().toISOString(),
          database: "disconnected",
          error: err instanceof Error ? err.message : String(err),
        });
      }
    });

    await app.listen({ port: PORT, host: HOST });
    logger.info(`Fastify API Gateway listening on http://${HOST}:${PORT}`);
  } catch (err) {
    logger.error("Failed to start Fastify API server:", err);
    process.exit(1);
  }
}

startServer();
