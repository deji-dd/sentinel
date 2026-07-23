import {
  Logger,
  tornApi,
  getWorkerApiKey,
  PersonalLogs,
  WorkerSchedules,
  UserConfig,
  SystemState,
  SystemStateDocument,
  TornSchema,
  LogRouteMap,
  LogDataRegistry,
} from "@sentinel/shared";
import { startEventDrivenRunner } from "../../lib/scheduler.js";
import { workerEvents } from "../../lib/event-bus.js";
import { STOCK_LOG_ROUTES } from "./stocks.js";
import { WEALTH_LOG_ROUTES } from "./wealth.js";
import { TRAVEL_LOG_ROUTES } from "./travel.js";
import { GYM_LOG_ROUTES } from "./gym.js";
import { CRIME_LOG_ROUTES } from "./crimes.js";

const WORKER_NAME = "log_manager";
const logger = new Logger(WORKER_NAME);

const LOG_ROUTER: LogRouteMap = {
  ...TRAVEL_LOG_ROUTES,
  ...GYM_LOG_ROUTES,
  ...CRIME_LOG_ROUTES,
  ...STOCK_LOG_ROUTES,
  ...WEALTH_LOG_ROUTES,
};

// Core router dispatcher
function dispatchLog(log: TornSchema<"UserLog">) {
  const logId = log.details.id as keyof LogDataRegistry;
  const mappedParsers = LOG_ROUTER[logId];

  if (mappedParsers) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mappedParsers.forEach((parse) => parse(log as any));
  }
}

function syncSettingsToSchedule() {
  const config = UserConfig.findOne("global");
  const cadence = config?.log_manager_cadence ?? 60;

  const schedule = WorkerSchedules.findOne(WORKER_NAME);

  WorkerSchedules.insertOne({
    id: WORKER_NAME,
    cadence_seconds: cadence,
    next_run_at: schedule?.next_run_at ?? Date.now(),
    last_run_at: schedule?.last_run_at ?? null,
    force_run: false,
  });
}

/**
 * Unified Sync Engine: Handles both live polling and historical pagination
 */
async function syncLogs(): Promise<void> {
  try {
    const finishSync = logger.time();
    const apiKey = getWorkerApiKey("personal");
    if (!apiKey) throw new Error("No personal API key found");

    // Check if we are running a historical backfill
    let backfillState = SystemState.findOne("log_manager_backfill_progress") as
      | Extract<SystemStateDocument, { id: "log_manager_backfill_progress" }>
      | undefined;

    // --- AUTO-START LOGIC ---
    if (!backfillState) {
      logger.info("Initializing user log backfill.");

      backfillState = {
        id: "log_manager_backfill_progress",
        timestamp: Math.floor(Date.now() / 1000),
        status: "in_progress",
        logs_parsed: 0,
        oldest_timestamp_reached: null,
      };
      SystemState.insertOne(backfillState);
    }

    if (backfillState.status === "in_progress") {
      await runHistoricalBatch(apiKey, backfillState);
      return;
    }

    // --- REAL-TIME POLLING MODE ---
    const requiredInits = [
      "crimes_ledger_v2_init",
      "gym_ledger_v2_init",
      "stock_ledger_v2_init",
      "wealth_ledger_v2_init",
    ] as const;

    const pendingInits = requiredInits.filter((initId) => {
      const initRecord = SystemState.findOne(initId) as
        | Extract<SystemStateDocument, { id: typeof initId; init: boolean }>
        | undefined;
      return !initRecord || !initRecord.init;
    });

    if (pendingInits.length > 0) {
      logger.warn(
        `Postponing real-time log polling. Inits still ongoing: ${pendingInits.join(", ")}`,
      );
      return;
    }

    const state = SystemState.findOne<
      Extract<SystemStateDocument, { id: string; timestamp: number }>
    >("log_manager_last_checked");
    let lastCheckedTimestamp = state?.timestamp ?? 0;

    if (lastCheckedTimestamp === 0) {
      lastCheckedTimestamp = Math.floor(Date.now() / 1000);
      SystemState.update({
        id: "log_manager_last_checked",
        timestamp: lastCheckedTimestamp,
      });

      return;
    }

    const res = await tornApi.get("/user/log", {
      apiKey,
      queryParams: { from: lastCheckedTimestamp, limit: 100 },
    });

    if (res.log) {
      let newLogsCount = 0;
      for (const log of res.log) {
        if (PersonalLogs.findOne(String(log.id))) continue;

        PersonalLogs.insertOne(log);
        lastCheckedTimestamp = Math.max(lastCheckedTimestamp, log.timestamp);

        dispatchLog(log);
        newLogsCount++;
      }

      if (newLogsCount > 0) {
        SystemState.update({
          id: "log_manager_last_checked",
          timestamp: lastCheckedTimestamp,
        });
        logger.info(`Saved ${newLogsCount} new logs in ${finishSync()}`);
      }
    }
  } catch (error) {
    logger.error("Error during log sync:", error);
  }
}

/**
 * Pages backward through history using the 'to' query parameter
 */
async function runHistoricalBatch(
  apiKey: string,
  state: Extract<SystemStateDocument, { id: "log_manager_backfill_progress" }>,
) {
  const currentTo = state.oldest_timestamp_reached ?? undefined;
  logger.info(
    `Running historical backfill batch with to=${currentTo ?? "latest"}`,
  );

  const queryParams: Record<string, number> = { limit: 100 };
  if (currentTo) queryParams.to = currentTo;

  const res = await tornApi.get<TornSchema<"UserLogsResponse">>("/user/log", {
    apiKey,
    queryParams,
  });

  if (!res.log || res.log.length === 0) {
    // Reached the end of history
    SystemState.update({
      id: "log_manager_backfill_progress",
      timestamp: Math.floor(Date.now() / 1000),
      status: "completed",
    });
    workerEvents.emit("log_backfill_completed");
    logger.info("Historical log backfill completed.");
    return;
  }

  let oldestInBatch = Date.now() / 1000;
  let parsedCount = state.logs_parsed ?? 0;

  // Iterate directly over the array
  for (const log of res.log) {
    if (!PersonalLogs.findOne(String(log.id))) {
      PersonalLogs.insertOne(log);
      dispatchLog(log);
    }
    parsedCount++;
    if (log.timestamp < oldestInBatch) {
      oldestInBatch = log.timestamp;
    }
  }

  // Update progress state and continue on the next runner tick
  SystemState.update({
    id: "log_manager_backfill_progress",
    timestamp: Math.floor(Date.now() / 1000),
    status: "in_progress",
    logs_parsed: parsedCount,
    oldest_timestamp_reached: oldestInBatch,
  });

  // Convert the epoch seconds to milliseconds for the JS Date object
  const readableDate = new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false, // Forces 24-hour time
  }).format(new Date(oldestInBatch * 1000));

  logger.info(
    `Backfill progress: Total parsed ${parsedCount}, oldest reached: ${readableDate}`,
  );
}

import type { WorkerStartOptions } from "../registry.js";

export function startLogManager(options?: WorkerStartOptions): void {
  syncSettingsToSchedule();

  startEventDrivenRunner({
    worker: WORKER_NAME,
    handler: syncLogs,
    defaultCadenceSeconds: 60,
    initialDelayMs: options?.initialDelayMs,
  });

  workerEvents.on("settings_updated", () => {
    syncSettingsToSchedule();
  });
}
