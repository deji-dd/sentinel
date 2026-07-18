import {
  Logger,
  tornApi,
  getWorkerApiKey,
  PersonalLogs,
  WorkerSchedules,
  UserConfig,
  SystemState,
  SystemStateDocument,
} from "@sentinel/shared";
import { startEventDrivenRunner } from "../../lib/scheduler.js";
import { workerEvents } from "../../lib/event-bus.js";
import { parseStatGainLog } from "./gym.js";
import { parseStockGainLog, parseStockActivityLog } from "./stocks.js";
import { parseTravelActivityLog } from "./travel.js";

const WORKER_NAME = "log_manager";

function syncSettingsToSchedule() {
  const logger = new Logger("log_manager_settings");
  const config = UserConfig.findOne("global");
  const enabled = config?.log_manager_enabled ?? false;
  const cadence = config?.log_manager_cadence ?? 60;

  const schedule = WorkerSchedules.findOne(WORKER_NAME);

  if (!enabled) {
    // If we're toggling OFF, reset cursor and clear the table as requested
    if (schedule?.enabled !== false) {
      logger.info(
        "Log Manager disabled. Resetting cursor and clearing PersonalLogs table.",
      );
      PersonalLogs.deleteManyBy({});
    }
  }

  WorkerSchedules.insertOne({
    id: WORKER_NAME,
    enabled,
    cadence_seconds: cadence,
    next_run_at: schedule?.next_run_at ?? Date.now(),
    last_run_at: schedule?.last_run_at ?? null,
    force_run: false,
  });
}

async function syncLogs(): Promise<void> {
  const logger = new Logger(WORKER_NAME);
  try {
    const finishSync = logger.time();
    const apiKey = getWorkerApiKey("personal");
    if (!apiKey) throw new Error("No personal API key found");

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
      logger.info(
        `Log Manager initialized. Fetching logs strictly after ${lastCheckedTimestamp}`,
      );
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
        workerEvents.emit("new_log", log);
        newLogsCount++;
      }
      if (newLogsCount > 0) {
        SystemState.update({
          id: "log_manager_last_checked",
          timestamp: lastCheckedTimestamp,
        });
        logger.info(`Persisted ${newLogsCount} new logs.`);
      }
    }
    finishSync();
  } catch (error) {
    logger.error("Error during log sync:", error);
  }
}

export function startLogManager(): void {
  // Sync the initial configuration on boot
  syncSettingsToSchedule();

  startEventDrivenRunner({
    worker: WORKER_NAME,
    handler: syncLogs,
    defaultCadenceSeconds: 60,
  });

  // Hot-reload settings without process restart
  workerEvents.on("settings_updated", () => {
    syncSettingsToSchedule();
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  workerEvents.on("new_log", async (log: any) => {
    const logger = new Logger("log_manager_events");
    logger.info("Intercepted new log: " + log.details.title);
    parseStatGainLog(log);
    parseStockGainLog(log);
    parseStockActivityLog(log);
    parseTravelActivityLog(log);
  });
}
