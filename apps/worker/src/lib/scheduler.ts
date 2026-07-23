import {
  WorkerSchedules,
  WorkerScheduleDocument,
  Logger,
} from "@sentinel/shared";

/**
 * Configuration for the event-driven worker runner.
 */
export interface EventRunnerConfig {
  /** The unique string ID of the worker (e.g., 'state_ticker') */
  worker: string;
  /** The default sleep interval between executions, in seconds */
  defaultCadenceSeconds: number;
  /** Initial delay offset in milliseconds to stagger boot executions */
  initialDelayMs?: number;
  /** The async function containing the core logic to execute when the timer fires. Can return a timestamp (number) for the next execution time */
  handler: () => Promise<number | boolean | void>;
}

/**
 * Initializes a zero-I/O, event-driven background worker.
 * Uses a dual-layer listening approach: native EventEmitters for instant internal updates,
 * and a lightweight heartbeat poll to catch external CLI/dashboard triggers.
 * * @param {EventRunnerConfig} config The initialization parameters for the worker.
 */
export function startEventDrivenRunner(config: EventRunnerConfig): void {
  const logger = new Logger(config.worker);
  let activeTimer: ReturnType<typeof setTimeout> | null = null;
  let isExecuting = false;
  let isInitialBoot = true;

  // 1. Initialize or fetch the schedule on boot
  let schedule = WorkerSchedules.findOne(config.worker);
  if (!schedule) {
    schedule = WorkerSchedules.insertOne({
      id: config.worker,
      cadence_seconds: config.defaultCadenceSeconds,
      next_run_at: Date.now(),
      last_run_at: null,
      force_run: false,
    });
  }

  // 2. The core execution loop
  const executeAndReschedule = async () => {
    if (isExecuting) return; // Prevent overlap if forced while currently running
    isExecuting = true;

    let customNextRunMs: number | undefined;

    try {
      const result = await config.handler();
      if (typeof result === "number") customNextRunMs = result;
    } catch (err) {
      logger.error("Worker execution failed", err);
    } finally {
      isExecuting = false;

      // Calculate the next run time and update the NoSQL document
      const nextRunMs =
        customNextRunMs ?? Date.now() + schedule!.cadence_seconds * 1000;
      schedule = WorkerSchedules.insertOne({
        ...schedule!,
        last_run_at: Date.now(),
        next_run_at: nextRunMs,
        force_run: false, // Clear any active force flags upon completion
      });

      queueNextRun();
    }
  };

  // 3. The zero-I/O sleep calculator
  const queueNextRun = () => {
    if (activeTimer) clearTimeout(activeTimer);

    let delayMs = schedule!.next_run_at - Date.now();

    // If force_run is true or we missed the scheduled window, run instantly
    if (schedule!.force_run || delayMs <= 0) {
      delayMs = 0;
    }

    if (
      isInitialBoot &&
      config.initialDelayMs &&
      config.initialDelayMs > 0 &&
      !schedule!.force_run
    ) {
      delayMs = Math.max(delayMs, config.initialDelayMs);
      logger.info(
        `Staggering initial boot execution by ${config.initialDelayMs}ms...`,
      );
      isInitialBoot = false;
    }

    activeTimer = setTimeout(executeAndReschedule, delayMs);
  };

  // 4. Listen for real-time changes from the UI or Internal processes
  WorkerSchedules.on("change", (updatedDoc: WorkerScheduleDocument) => {
    if (updatedDoc.id === config.worker) {
      const forceTriggered = updatedDoc.force_run && !schedule!.force_run;
      const cadenceChanged =
        updatedDoc.cadence_seconds !== schedule!.cadence_seconds;

      schedule = updatedDoc;

      if (forceTriggered || cadenceChanged) {
        queueNextRun();
      }
    }
  });

  // Kick off the initial lifecycle
  queueNextRun();
}
