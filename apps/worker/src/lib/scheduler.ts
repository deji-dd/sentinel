import {
  fetchDueWorker,
  claimWorker,
  completeWorker,
  failWorker,
  ensureWorkerRegistered,
  insertWorkerLog,
  updateWorkerCadence,
} from "./supabase-helpers.js";
import { logError, logWarn } from "./logger.js";

export interface RunConfig {
  worker: string; // worker name, registered in sentinel_workers
  defaultCadenceSeconds: number;
  pollIntervalMs?: number;
  handler: () => Promise<void | boolean>;
  initialNextRunAt?: string;
  getDynamicCadence?: () => Promise<number>; // Optional: returns updated cadence based on current state
}

export function startDbScheduledRunner(
  config: RunConfig,
): ReturnType<typeof setInterval> {
  const {
    worker,
    defaultCadenceSeconds,
    pollIntervalMs = 2000, // Check every 2s for faster capacity response
    handler,
    initialNextRunAt,
    getDynamicCadence,
  } = config;

  let workerId: string | null = null;
  ensureWorkerRegistered(worker, defaultCadenceSeconds, initialNextRunAt)
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
        // Move the schedule forward and log the skip for visibility.
        if (result === false) {
          await completeWorker(workerId, dueRow.cadence_seconds);
          await insertWorkerLog({
            worker_id: workerId,
            duration_ms: 0,
            status: "success",
            run_started_at: new Date(start).toISOString(),
            run_finished_at: new Date().toISOString(),
            message: "Skipped: already running or not needed",
          });
          logWarn(worker, "Skipped: already running");
          return;
        }

        // Calculate cadence for next run (use dynamic if provided, otherwise use current)
        let nextCadence = dueRow.cadence_seconds;
        if (getDynamicCadence) {
          try {
            nextCadence = await getDynamicCadence();
          } catch (_err) {
            // Silently ignore cadence calculation errors - use existing cadence
          }
        }

        // Complete worker with calculated cadence (single DB write)
        await completeWorker(workerId, nextCadence);

        await insertWorkerLog({
          worker_id: workerId,
          duration_ms: duration,
          status: "success",
          run_started_at: new Date(start).toISOString(),
          run_finished_at: new Date().toISOString(),
        });
        // Note: Workers log their own success messages, don't duplicate here
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const duration = Date.now() - start;
        await failWorker(workerId, dueRow.attempts, message);
        await insertWorkerLog({
          worker_id: workerId,
          status: "error",
          error_message: message,
          run_started_at: new Date(start).toISOString(),
          run_finished_at: new Date().toISOString(),
          duration_ms: duration,
        });
        logError(worker, `Sync failed: ${message}`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logWarn(worker, `Scheduler tick error: ${message}`);
    }
  }, pollIntervalMs);

  return timer;
}
