import {
  fetchDueWorker,
  claimWorker,
  completeWorker,
  failWorker,
  ensureWorkerRegistered,
  insertWorkerLog,
} from "./supabase-helpers.js";
import { logError, logWarn } from "./logger.js";

export interface RunConfig {
  worker: string; // worker name, registered in sentinel_workers
  defaultCadenceSeconds: number;
  pollIntervalMs?: number;
  handler: () => Promise<void | boolean>;
}

export function startDbScheduledRunner(config: RunConfig): NodeJS.Timer {
  const {
    worker,
    defaultCadenceSeconds,
    pollIntervalMs = 5000,
    handler,
  } = config;

  let workerId: string | null = null;
  ensureWorkerRegistered(worker, defaultCadenceSeconds)
    .then((row) => {
      workerId = row.id;
    })
    .catch((err) => {
      logError(
        worker,
        `Failed to register worker: ${err instanceof Error ? err.message : String(err)}`,
      );
    });

  const timer = setInterval(async () => {
    if (!workerId) return;
    try {
      const dueRow = await fetchDueWorker(workerId);
      if (!dueRow) return;

      const claimed = await claimWorker(workerId);
      if (!claimed) return;

      const start = Date.now();
      try {
        const result = await handler();
        const duration = Date.now() - start;

        // If handler returns false, it indicates a skipped run (e.g., already running)
        // Move the schedule forward but avoid recording a success log with zero duration.
        if (result === false) {
          await completeWorker(workerId, dueRow.cadence_seconds);
          return;
        }

        await completeWorker(workerId, dueRow.cadence_seconds);
        await insertWorkerLog({
          worker_id: workerId,
          duration_ms: duration,
          status: "success",
          run_started_at: new Date(start).toISOString(),
          run_finished_at: new Date().toISOString(),
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await failWorker(workerId, dueRow.attempts, message);
        await insertWorkerLog({
          worker_id: workerId,
          status: "error",
          error_message: message,
          run_started_at: new Date(start).toISOString(),
          run_finished_at: new Date().toISOString(),
        });
        logError(worker, `Schedule failed: ${message}`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logWarn(worker, `Scheduler tick error: ${message}`);
    }
  }, pollIntervalMs);

  return timer;
}
