import { executeSync } from "../lib/sync.js";
import { startDbScheduledRunner } from "../lib/scheduler.js";
import { supabase } from "../lib/supabase.js";
import { TABLE_NAMES } from "@sentinel/shared";

const WORKER_NAME = "war_ledger_pruning_worker";
const PRUNE_CADENCE_SECONDS = 86400; // Prune once daily
const RETENTION_DAYS = 95; // Keep 95 days (assault-check needs 90 days + buffer)

/**
 * Prune old war ledger entries beyond retention window
 * Keeps wars from last 95 days for assault-check constraints
 */
async function pruneWarLedger(): Promise<void> {
  const cutoffTime = new Date(
    Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000,
  );

  const { count, error } = await supabase
    .from(TABLE_NAMES.WAR_LEDGER)
    .delete()
    .lt("start_time", cutoffTime.toISOString());

  if (error) {
    const errorMsg =
      error instanceof Error ? error.message : JSON.stringify(error);
    throw new Error(`Failed to prune wars: ${errorMsg}`);
  }
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
