import { executeSync } from "../lib/sync.js";
import { Logger } from "../lib/logger.js";
import { startDbScheduledRunner } from "../lib/scheduler.js";
import { TABLE_NAMES } from "@sentinel/shared";
import { getKysely } from "@sentinel/shared/db/sqlite.js";

const PRUNING_WORKER_NAME = "battlestats_pruning_worker";
const logger = new Logger(PRUNING_WORKER_NAME);

async function pruneBattlestats(): Promise<void> {
  const startTime = Date.now();
  try {
    const db = getKysely();
    const hundredEightyDaysAgo = new Date(
      Date.now() - 180 * 24 * 60 * 60 * 1000
    ).toISOString();

    const result = await db
      .deleteFrom(TABLE_NAMES.BATTLESTATS_SNAPSHOTS)
      .where("created_at", "<", hundredEightyDaysAgo)
      .executeTakeFirst();

    const deletedCount = Number(result.numDeletedRows || 0);
    logger.success(`Pruning completed. Deleted ${deletedCount} snapshots older than 180 days.`, Date.now() - startTime);
  } catch (error) {
    logger.error("Pruning failed", error, Date.now() - startTime);
  }
}

export function startBattlestatsPruningWorker(): void {
  startDbScheduledRunner({
    worker: PRUNING_WORKER_NAME,
    defaultCadenceSeconds: 86400, // Once a day
    pollIntervalMs: 60000,
    handler: async () => {
      return await executeSync({
        name: PRUNING_WORKER_NAME,
        timeout: 120000, // 2 minutes
        handler: pruneBattlestats,
      });
    },
  });
}
