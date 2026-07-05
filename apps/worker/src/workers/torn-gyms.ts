/* eslint-disable @typescript-eslint/no-explicit-any, no-empty */
import { executeSync } from "../lib/sync.js";
import { Logger } from "../lib/logger.js";
import { startDbScheduledRunner } from "../lib/scheduler.js";
import { TABLE_NAMES } from "@sentinel/shared";
import { getKysely } from "@sentinel/shared/db/sqlite.js";

const GYM_WORKER_NAME = "torn_gyms_worker";
const gymLogger = new Logger(GYM_WORKER_NAME);

async function parseAndSaveGymLogs(db: any, logs: any[]): Promise<number> {
  let inserted = 0;
  for (const log of logs) {
    const logId = String(log.log_id);
    const timestamp = Number(log.timestamp);
    let details: any = {};
    let data: any = {};
    
    try {
      const parsedData = typeof log.data === "string" ? JSON.parse(log.data) : log.data || {};
      details = parsedData.details || parsedData || {};
      data = parsedData || {};
    } catch {}

    const logIdNum = details.id ? Number(details.id) : 0;
    if (logIdNum === 5320) {
      const gymId = data.gym ? parseInt(String(data.gym), 10) : null;
      if (gymId) {
        await db
          .updateTable(TABLE_NAMES.TORN_GYMS)
          .set({ unlocked: 1 })
          .where("id", "=", gymId)
          .execute();
        inserted++;
      }
      continue;
    }

    const title = String(log.title || details.title || "");
    const isTrainLog = title.toLowerCase().startsWith("gym train");
    if (!isTrainLog) continue;

    const statMatch = title.match(/gym train (strength|defense|speed|dexterity)/i);
    if (!statMatch) continue;
    const stat = statMatch[1].toLowerCase();

    const gain = parseFloat(String(data[`${stat}_increased`] || "0"));
    const energy = parseInt(String(data.energy_used || 0), 10);
    const happy = parseInt(String(data.happy_used || 0), 10);
    const gymId = data.gym ? parseInt(String(data.gym), 10) : null;

    if (!stat || isNaN(gain) || gain <= 0) continue;

    await db
      .insertInto(TABLE_NAMES.GYM_TRAIN_LOGS as any)
      .values({
        log_id: logId,
        timestamp,
        stat,
        gain,
        energy,
        happy,
        gym_id: gymId,
      })
      .onConflict((oc: any) => oc.column("log_id").doNothing())
      .execute();

    inserted++;
  }
  return inserted;
}

export async function syncGymTrainLogs(): Promise<void> {
  const db = getKysely();

  // Wait for central_log_manager backfill to complete first
  const scheduleRow = await db
    .selectFrom("sentinel_worker_schedules as s")
    .innerJoin("sentinel_workers as w", "s.worker_id", "w.id")
    .select("s.metadata")
    .where("w.name", "=", "central_log_manager")
    .executeTakeFirst();

  let isBackfilling = true;
  if (scheduleRow?.metadata) {
    try {
      const parsed = JSON.parse(scheduleRow.metadata);
      if (parsed.backfill_complete) {
        isBackfilling = false;
      }
    } catch {}
  }

  if (isBackfilling) {
    gymLogger.info("Central Log Manager backfill in progress. Deferring run...");
    return;
  }

  // Find the latest timestamp in sentinel_gym_train_logs
  const latestLog = await db
    .selectFrom(TABLE_NAMES.GYM_TRAIN_LOGS as any)
    .select("timestamp")
    .orderBy("timestamp", "desc")
    .limit(1)
    .executeTakeFirst();

  const fromTimestamp = latestLog ? Number(latestLog.timestamp) : 0;
  gymLogger.info(`Syncing gym train logs from local DB since timestamp ${fromTimestamp}...`);

  try {
    // Query central logs table instead of Torn API
    const rawLogs = await db
      .selectFrom(TABLE_NAMES.USER_LOGS as any)
      .selectAll()
      .where("category", "=", "Gym")
      .where("timestamp", ">", fromTimestamp)
      .orderBy("timestamp", "asc")
      .execute();

    if (rawLogs.length === 0) {
      gymLogger.info("No new local logs to parse.");
      return;
    }

    gymLogger.info(`Found ${rawLogs.length} unprocessed gym logs in local DB. Parsing...`);
    const inserted = await parseAndSaveGymLogs(db, rawLogs);
    
    if (inserted > 0) {
      gymLogger.success(`Successfully parsed and saved ${inserted} gym train log entries.`);
    } else {
      gymLogger.info("Parsed logs were skipped or already up to date.");
    }
  } catch (error) {
    gymLogger.error("Failed to sync gym train logs from local DB", error);
  }
}

export function startTornGymsWorker(): void {
  startDbScheduledRunner({
    worker: GYM_WORKER_NAME,
    defaultCadenceSeconds: 60, // Run every minute to parse new logs
    pollIntervalMs: 5000,
    handler: async () => {
      return await executeSync({
        name: GYM_WORKER_NAME,
        timeout: 60000,
        handler: syncGymTrainLogs,
      });
    },
  });
}
