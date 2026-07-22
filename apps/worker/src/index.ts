import { initializeNetworkPipelining } from "./lib/network.js";
initializeNetworkPipelining();

// Global process error handlers
process.on("uncaughtException", (err) => {
  const msg = err instanceof Error ? err.message : String(err);
  if (
    msg.includes("other side closed") ||
    msg.includes("UND_ERR_SOCKET") ||
    msg.includes("ECONNRESET") ||
    msg.includes("socket hang up")
  ) {
    logger.warn(
      "[Process] Gracefully caught transient network socket error:",
      msg,
    );
  } else {
    logger.error("[Process] Uncaught Exception:", err);
  }
});

process.on("unhandledRejection", (reason, promise) => {
  console.error(
    "[Process] Unhandled Rejection at:",
    promise,
    "reason:",
    reason,
  );
});

import {
  initializeApiKeyMappings,
  initializeRateLimitCache,
} from "@sentinel/shared";
import { startWorkers } from "./workers/registry.js";
import {
  Logger,
  sentinelDbEngine,
  startMetricsReporter,
  stopMetricsReporter,
  SystemState,
} from "@sentinel/shared";
import { setupIpcServer } from "./lib/ipc/index.js";

const logger = new Logger("worker_root");

/**
 * The master bootstrap sequence for the Sentinel background worker layer.
 * Initializes required rate limiters, memory caches, and dynamically boots the
 * event-driven worker runners based on the assigned operational scope.
 * * @returns {Promise<void>} Resolves when all scheduled runners are actively ticking.
 */
async function startAllWorkers(): Promise<void> {
  logger.warn("Starting workers");

  try {
    await setupIpcServer();

    startMetricsReporter("worker");
    logger.info("Worker process initialized and running.");
    await initializeApiKeyMappings();
    initializeRateLimitCache();

    const startedCount = startWorkers();
    logger.info(`Started ${startedCount} worker runners`);

    SystemState.insertOne({
      id: "worker_boot_alert",
      component: "worker",
      message: "Worker process successfully booted up.",
      timestamp: Date.now(),
      reported: false,
    });
  } catch (error) {
    logger.error("Failed to start workers:", error);
    process.exit(1);
  }
}

let isShuttingDown = false;

/**
 * Safely intercepts OS termination signals (Ctrl+C, PM2 restart) to perform a graceful teardown.
 * Ensures the SQLite WAL is flushed and file locks are released before the Node process dies.
 * * @param {string} signal The OS signal received (e.g., 'SIGINT', 'SIGTERM').
 */
const handleShutdown = (signal: string) => {
  if (isShuttingDown) return;
  isShuttingDown = true;

  logger.warn(`📛 Received ${signal}. Executing graceful shutdown...`);

  try {
    stopMetricsReporter("worker");
    sentinelDbEngine.close();
    logger.info("Database connection safely closed.");
    process.exit(0);
  } catch (err) {
    logger.error("Error during database shutdown:", err);
    process.exit(1);
  }
};

process.on("SIGINT", () => handleShutdown("SIGINT"));
process.on("SIGTERM", () => handleShutdown("SIGTERM"));

// Start execution
startAllWorkers().catch((error) => {
  console.error(
    "[CRITICAL] Failed to start workers:",
    error instanceof Error ? error.message : error,
  );
  process.exit(1);
});
