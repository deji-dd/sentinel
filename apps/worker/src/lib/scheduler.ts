import {
  fetchDueWorker,
  claimWorker,
  completeWorker,
  failWorker,
} from "./supabase-helpers.js";
import { logError, logWarn } from "./logger.js";

export interface RunConfig {
  worker: string;
  pollIntervalMs?: number;
  handler: () => Promise<void>;
}

export function startDbScheduledRunner(config: RunConfig): NodeJS.Timer {
  const { worker, pollIntervalMs = 5000, handler } = config;

  const timer = setInterval(async () => {
    try {
      const dueRow = await fetchDueWorker(worker);
      if (!dueRow) return;

      const claimed = await claimWorker(worker);
      if (!claimed) return;

      try {
        await handler();
        await completeWorker(worker, dueRow.cadence_seconds);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await failWorker(worker, dueRow.attempts, message);
        logError(worker, `Schedule failed: ${message}`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logWarn(worker, `Scheduler tick error: ${message}`);
    }
  }, pollIntervalMs);

  return timer;
}
