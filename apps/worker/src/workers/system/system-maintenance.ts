import { Logger } from "@sentinel/utils";
import { db } from "@sentinel/database";
import { startEventDrivenRunner } from "../../lib/scheduler.js";
import type { WorkerStartOptions } from "../registry.js";

const WORKER_NAME = "system_maintenance";
const logger = new Logger(WORKER_NAME);

/**
 * Daily system cleanup and retention manager.
 * Retains 90 days of completed WarLedger data to maintain accuracy for war checks, while pruning stale temporary system state records.
 */
export async function executeMaintenance(): Promise<void> {
  const finishSync = logger.time();

  try {
    const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);

    // 1. Retain 90 days of completed WarLedger records (prune older finished wars)
    const prunedWars = await db.warLedger.deleteMany({
      where: {
        endTime: {
          not: null,
          lt: ninetyDaysAgo,
        },
      },
    });

    if (prunedWars.count > 0) {
      logger.info(
        `Pruned ${prunedWars.count} finished WarLedger records older than 90 days.`,
      );
    }

    // 3. Prune VerificationLogs older than 30 days
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const prunedLogs = await db.verificationLog.deleteMany({
      where: {
        createdAt: { lt: thirtyDaysAgo },
      },
    });

    if (prunedLogs.count > 0) {
      logger.info(
        `Pruned ${prunedLogs.count} VerificationLog records older than 30 days.`,
      );
    }

    finishSync();
  } catch (error) {
    logger.error("Error executing system maintenance:", error);
  }
}

/**
 * Initializes the automated daily system maintenance worker.
 */
export function startSystemMaintenance(options?: WorkerStartOptions): void {
  const ONE_DAY_SECONDS = 86400;

  startEventDrivenRunner({
    worker: WORKER_NAME,
    defaultCadenceSeconds: ONE_DAY_SECONDS,
    initialDelayMs: options?.initialDelayMs,
    handler: async () => {
      await executeMaintenance();
    },
  });

  logger.info("System maintenance worker initialized (cadence: 24h).");
}
