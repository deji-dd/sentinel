
import { Logger } from "@sentinel/utils";
import { IpcServer, DEFAULT_IPC_SOCKET_PATH } from "@sentinel/utils/ipc";
import { db, recordBootAlert } from "@sentinel/database";
import { ManagedTornApiClient } from "@sentinel/torn-api-manager";
import { initializeNetworkOptimization } from "./lib/network.js";
import { startRegisteredWorkers } from "./workers/registry.js";

import { runVerificationJob } from "./lib/verification-engine.js";

import { triggerWorkerByName } from "./lib/scheduler.js";

const logger = new Logger("WorkerIndex");

const socketPath = process.env.IPC_SOCKET_PATH ?? DEFAULT_IPC_SOCKET_PATH;

export const ipcServer = new IpcServer(socketPath, async (message: any) => {
  logger.info("IPC Message Received:", message);

  if (message?.action === "verification_request" && message.data) {
    try {
      const result = await runVerificationJob(
        message.data,
        message.apiKeyOverride,
      );
      ipcServer.broadcast({
        action: "verification_response",
        requestId: message.requestId,
        data: result,
      });
    } catch (err) {
      logger.error("Failed to process verification IPC job:", err);
      ipcServer.broadcast({
        action: "verification_response",
        requestId: message.requestId,
        data: {
          guild_id: message.data.guild_id,
          channel_id: message.data.channel_id,
          discord_id: message.data.discord_id,
          error: {
            message: err instanceof Error ? err.message : "Internal error",
          },
        },
      });
    }
    return;
  }

  if (message?.action === "force_run_worker" && message.data?.workerName) {
    const workerName = message.data.workerName;
    try {
      await db.workerSchedule.upsert({
        where: { id: workerName },
        update: { forceRun: true },
        create: { id: workerName, forceRun: true },
      });
      logger.info(
        `Set forceRun = true for worker '${workerName}' in PostgreSQL.`,
      );

      const triggered = triggerWorkerByName(workerName);
      if (triggered) {
        logger.info(
          `Triggered active in-memory runner for '${workerName}' immediately.`,
        );
      }
    } catch (err) {
      logger.error(`Failed to force trigger worker '${workerName}':`, err);
    }
  }
});

async function main() {
  logger.info("Initializing Sentinel Workers...");

  // 1. Initialize global network socket reuse & DNS caching
  initializeNetworkOptimization();

  // 2. Initialize managed Torn API client (per-user rate limiting & key health)
  const tornApiManager = new ManagedTornApiClient();

  // 3. Start IPC Server for inter-process communication
  ipcServer.start();

  // 4. Record boot alert in database for worker process startup notification
  await recordBootAlert("worker");

  // 5. Start registered background workers with staggered boot
  const workerCount = startRegisteredWorkers();
  logger.info(`${workerCount} registered workers.`);

  // Graceful shutdown handling
  const shutdown = async (signal: string) => {
    logger.warn(`Received ${signal}. Shutting down Workers V2...`);
    ipcServer.close();
    await db.$disconnect();
    logger.info("Workers V2 shutdown complete.");
    process.exit(0);
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((err) => {
  logger.error("Fatal error during Workers V2 startup:", err);
  process.exit(1);
});
