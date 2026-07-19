import Fastify from "fastify";
import {
  Logger,
  sentinelDbEngine,
  startMetricsReporter,
  stopMetricsReporter,
  SystemState,
} from "@sentinel/shared";
import healthRoutes from "./routes/health.js";
import statusRoutes from "./routes/status.js";
import ledgerRoutes from "./routes/ledger.js";
import { crimesRoutes } from "./routes/crimes.js";
import { gymRoutes } from "./routes/gym.js";
import { stocksRoutes } from "./routes/stocks.js";
import { configRoutes } from "./routes/config.js";
import { settingsRoutes } from "./routes/settings.js";
import { travelRoutes } from "./routes/travel.js";
import { wealthRoutes } from "./routes/wealth.js";
import cors from "@fastify/cors";
import websocket from "@fastify/websocket";

startMetricsReporter("api");

const logger = new Logger("api_gateway");
const fastify = Fastify({ logger: false }); // We'll use our own logger or integrate later

const PORT = parseInt(process.env.PORT || "3001", 10);
const HOST = "0.0.0.0";

// Register routes
fastify.register(cors, {
  origin: "*", // The user approved "any origin is fine"
});
fastify.register(websocket);
fastify.register(healthRoutes);
fastify.register(statusRoutes);
fastify.register(ledgerRoutes);
fastify.register(crimesRoutes, { prefix: "/api/crimes" });
fastify.register(gymRoutes, { prefix: "/api/gym" });
fastify.register(stocksRoutes, { prefix: "/api/stocks" });
fastify.register(configRoutes, { prefix: "/api/config" });
fastify.register(settingsRoutes, { prefix: "/api/settings" });
fastify.register(travelRoutes, { prefix: "/api/travel" });
fastify.register(wealthRoutes, { prefix: "/api/wealth" });

async function start() {
  try {
    // Ensure the database is ready
    if (!sentinelDbEngine.db || !sentinelDbEngine.db.open) {
      throw new Error("Shared SQLite Database failed to open.");
    }

    await fastify.listen({ port: PORT, host: HOST });
    logger.info(`Fastify API Gateway listening on http://${HOST}:${PORT}`);

    SystemState.update({
      id: "api_boot_alert",
      component: "api",
      message: "API Gateway process successfully booted up.",
      timestamp: Date.now(),
      reported: false,
    });
  } catch (err) {
    logger.error("Error starting API Gateway:", err);
    process.exit(1);
  }
}

// Graceful shutdown
const shutdown = async (signal: string) => {
  logger.info(`Received ${signal}. Shutting down API Gateway...`);

  try {
    await fastify.close();
    logger.info("Fastify server closed.");

    // Stop metrics reporter first while DB is still open
    stopMetricsReporter("api");

    // Close shared database connection
    sentinelDbEngine.close();
    process.exit(0);
  } catch (err) {
    logger.error("Error during shutdown:", err);
    process.exit(1);
  }
};

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

start();
