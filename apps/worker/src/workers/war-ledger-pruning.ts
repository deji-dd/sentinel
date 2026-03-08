import { executeSync } from "../lib/sync.js";
import { startDbScheduledRunner } from "../lib/scheduler.js";
import { TABLE_NAMES } from "@sentinel/shared";
import { logDuration } from "../lib/logger.js";
import { getKysely } from "@sentinel/shared/db/sqlite.js";

const WORKER_NAME = "war_ledger_pruning_worker";
const PRUNE_CADENCE_SECONDS = 86400; // Prune once daily
const RETENTION_DAYS = 95; // Keep 95 days (assault-check needs 90 days + buffer)

/**
 * Prune old war ledger entries beyond retention window
 * Keeps wars from last 95 days for assault-check constraints
 */
async function pruneWarLedger(): Promise<void> {
  const startTime = Date.now();
  const cutoffTime = new Date(
    Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000,
  );

  const db = getKysely();
  await db
    .deleteFrom(TABLE_NAMES.WAR_LEDGER)
    .where("start_time", "<", cutoffTime.toISOString())
    .execute();

  const duration = Date.now() - startTime;
  logDuration(WORKER_NAME, "Sync completed", duration);
}
export function startWarLedgerPruningWorker(): void {
  startDbScheduledRunner({
    worker: "war_ledger_pruning_worker",
    defaultCadenceSeconds: PRUNE_CADENCE_SECONDS,
    pollIntervalMs: 5000,
    handler: async () => {
      return await executeSync({
        name: WORKER_NAME,
        timeout: 30000,
        handler: pruneWarLedger,
      });
    },
  });
}
