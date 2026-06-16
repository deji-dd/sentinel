import {
  claimWorker,
  completeWorker,
  failWorker,
  ensureWorkerRegistered,
  fetchDueWorkerSchedules,
  insertWorkerLog,
  TABLE_NAMES,
} from "@sentinel/shared";
import { getKysely } from "@sentinel/shared/db/sqlite.js";
import { Logger } from "./logger.js";

export interface RunConfig {
  worker: string; // worker name, registered in sentinel_workers
  defaultCadenceSeconds: number;
  pollIntervalMs?: number; // Maintained for backward-compatible signature
  handler: () => Promise<void | boolean>;
  initialNextRunAt?: string;
  getDynamicCadence?: () => Promise<number>; // Optional: returns updated cadence based on current state
}

interface ActiveTimer {
  timeoutId: ReturnType<typeof setTimeout>;
  nextRunTime: number; // Scheduled UTC millisecond timestamp
}

// Global registry of all registered worker configurations and active timers
const registeredWorkers = new Map<string, RunConfig>();
const activeTimers = new Map<string, ActiveTimer>();
const registeredWorkerIds = new Map<string, string>(); // name -> ID

// Flag to ensure the central coordinator is only started once
let centralCoordinatorStarted = false;

/**
 * Schedule a worker execution dynamically via setTimeout based on its next_run_at.
 */
function scheduleWorkerTimeout(workerName: string, nextRunAtStr: string): void {
  const existing = activeTimers.get(workerName);
  if (existing) {
    clearTimeout(existing.timeoutId);
  }

  const nextRunTime = new Date(nextRunAtStr).getTime();
  // Node.js setTimeout max delay is 2147483647 ms (approx. 24.8 days) to prevent 32-bit integer overflow
  const MAX_TIMEOUT_MS = 2147483647;
  const delay = Math.min(MAX_TIMEOUT_MS, Math.max(0, nextRunTime - Date.now()));

  const timeoutId = setTimeout(async () => {
    activeTimers.delete(workerName);
    await executeWorkerTick(workerName);
  }, delay);

  activeTimers.set(workerName, { timeoutId, nextRunTime });
}

/**
 * Execute a single worker tick: claims the lock, runs, completes/fails, and schedules next run.
 */
async function executeWorkerTick(workerName: string): Promise<void> {
  const config = registeredWorkers.get(workerName);
  if (!config) return;

  const logger = new Logger(workerName);
  const workerId = registeredWorkerIds.get(workerName);
  if (!workerId) return;

  try {
    // 1. Fetch current due worker schedule to get cadence and current attempts
    const dueRow = (
      await fetchDueWorkerSchedules({
        workerName,
        limit: 1,
      })
    )[0];
    
    // If not due (or another instance claimed it), reschedule based on database next_run_at
    if (!dueRow) {
      await rescheduleFromDb(workerName);
      return;
    }

    // 2. Atomic claim lock
    const claimed = await claimWorker(workerId);
    if (!claimed) {
      await rescheduleFromDb(workerName);
      return;
    }

    const start = Date.now();
    try {
      // 3. Run the handler
      const result = await config.handler();
      const duration = Date.now() - start;

      // If handler returns false, it indicates a skipped run (e.g. already running/not needed)
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
        logger.warn("Skipped: already running");
        await rescheduleFromDb(workerName);
        return;
      }

      // 4. Calculate next cadence
      let nextCadence = dueRow.cadence_seconds;
      if (config.getDynamicCadence) {
        try {
          nextCadence = await config.getDynamicCadence();
        } catch {
          // Fall back to existing cadence
        }
      }

      // 5. Complete worker run (updates next_run_at)
      await completeWorker(workerId, nextCadence);

      await insertWorkerLog({
        worker_id: workerId,
        duration_ms: duration,
        status: "success",
        run_started_at: new Date(start).toISOString(),
        run_finished_at: new Date().toISOString(),
      });

      // 6. Schedule next wake-up timeout
      const nextRunTimeStr = new Date(Date.now() + nextCadence * 1000).toISOString();
      scheduleWorkerTimeout(workerName, nextRunTimeStr);

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

      logger.error("Sync failed", err);

      // Schedule next run after fail backoff (failWorker sets backoff_until)
      await rescheduleFromDb(workerName);
    }
  } catch (err) {
    logger.error("Error executing worker tick", err);
    await rescheduleFromDb(workerName);
  }
}

/**
 * Reads worker schedule from the database and reschedules the wake-up timeout.
 */
async function rescheduleFromDb(workerName: string): Promise<void> {
  try {
    const db = getKysely();
    const schedule = await db
      .selectFrom(TABLE_NAMES.WORKER_SCHEDULES)
      .innerJoin(
        TABLE_NAMES.WORKERS,
        `${TABLE_NAMES.WORKER_SCHEDULES}.worker_id`,
        `${TABLE_NAMES.WORKERS}.id`,
      )
      .select([
        `${TABLE_NAMES.WORKER_SCHEDULES}.next_run_at as next_run_at`,
        `${TABLE_NAMES.WORKER_SCHEDULES}.backoff_until as backoff_until`,
      ])
      .where(`${TABLE_NAMES.WORKERS}.name`, "=", workerName)
      .limit(1)
      .executeTakeFirst();

    if (schedule) {
      // If there is an active backoff, we must wait until backoff_until instead of next_run_at
      const targetTime = schedule.backoff_until && new Date(schedule.backoff_until).getTime() > Date.now()
        ? schedule.backoff_until
        : schedule.next_run_at;
      scheduleWorkerTimeout(workerName, targetTime);
    }
  } catch {
    // Fall back to a default safety retry delay if DB read fails
    const safetyTime = new Date(Date.now() + 10000).toISOString(); // 10 seconds
    scheduleWorkerTimeout(workerName, safetyTime);
  }
}

/**
 * Starts the global scheduler coordinator checking all active workers every 10 seconds.
 */
function startCentralCoordinator(): void {
  if (centralCoordinatorStarted) return;
  centralCoordinatorStarted = true;

  const coordinatorLogger = new Logger("scheduler_coordinator");

  // Pre-declared operational variables for V8 GC optimization
  let db: ReturnType<typeof getKysely>;
  let now: string;
  let schedules: Array<{
    name: string;
    next_run_at: string;
    backoff_until: string | null;
    force_run: number | boolean;
  }>;
  let workerName: string;
  let forceRun: boolean;
  let targetTimeStr: string | null;
  let targetTime: number;
  let active: { timeoutId: ReturnType<typeof setTimeout>; nextRunTime: number } | undefined;
  let workerId: string | undefined;

  setInterval(async () => {
    try {
      db = getKysely();
      now = new Date().toISOString();

      // Query all enabled worker schedules to see if they need rescheduling or forced execution
      schedules = await db
        .selectFrom(TABLE_NAMES.WORKER_SCHEDULES)
        .innerJoin(
          TABLE_NAMES.WORKERS,
          `${TABLE_NAMES.WORKER_SCHEDULES}.worker_id`,
          `${TABLE_NAMES.WORKERS}.id`,
        )
        .select([
          `${TABLE_NAMES.WORKERS}.name as name`,
          `${TABLE_NAMES.WORKER_SCHEDULES}.next_run_at as next_run_at`,
          `${TABLE_NAMES.WORKER_SCHEDULES}.backoff_until as backoff_until`,
          `${TABLE_NAMES.WORKER_SCHEDULES}.force_run as force_run`,
        ])
        .where(`${TABLE_NAMES.WORKER_SCHEDULES}.enabled`, "=", 1)
        .execute() as typeof schedules;

      for (const schedule of schedules) {
        workerName = schedule.name;
        
        // Skip if this worker is not registered/active in the current process scope
        if (!registeredWorkers.has(workerName)) {
          continue;
        }

        forceRun = Number(schedule.force_run) === 1;
        targetTimeStr = schedule.backoff_until && new Date(schedule.backoff_until).getTime() > Date.now()
          ? schedule.backoff_until
          : schedule.next_run_at;

        targetTime = targetTimeStr ? new Date(targetTimeStr).getTime() : 0;
        active = activeTimers.get(workerName);

        if (forceRun) {
          // Clear lock/force flag immediately (so it doesn't loop trigger)
          workerId = registeredWorkerIds.get(workerName);
          if (workerId) {
            await db
              .updateTable(TABLE_NAMES.WORKER_SCHEDULES)
              .set({ force_run: 0 })
              .where("worker_id", "=", workerId)
              .execute();
          }
          // Trigger execution immediately
          scheduleWorkerTimeout(workerName, now);
        } else if (targetTimeStr && (!active || targetTime < active.nextRunTime)) {
          // If the worker has no active timeout scheduled, or its next_run_at was rescheduled to be earlier
          scheduleWorkerTimeout(workerName, targetTimeStr);
        }
      }
    } catch (err) {
      coordinatorLogger.error("Central coordinator tick failed", err);
    }
  }, 10000); // 10-second polling for updates/force runs
}

/**
 * Registers a worker schedule and starts the scheduler for it.
 */
export function startDbScheduledRunner(config: RunConfig): void {
  const { worker, defaultCadenceSeconds, initialNextRunAt } = config;
  const logger = new Logger(worker);

  registeredWorkers.set(worker, config);

  ensureWorkerRegistered({
    name: worker,
    cadenceSeconds: defaultCadenceSeconds,
    initialNextRunAt,
  })
    .then((row) => {
      registeredWorkerIds.set(worker, row.id);
      
      // Reschedule from DB to fetch next_run_at and set the timeout
      rescheduleFromDb(worker);

      // Start the central coordinator loop
      startCentralCoordinator();
    })
    .catch((err) => {
      logger.error("Failed to register worker", err);
    });
}
