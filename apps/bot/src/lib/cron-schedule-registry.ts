import {
  TABLE_NAMES,
  buildWorkerName,
  ensureWorkerRegistered,
  setWorkerScheduleEnabled,
} from "@sentinel/shared";
import { db } from "./db-client.js";
import { getGuildApiKeys } from "./guild-api-keys.js";
import { Logger } from "./logger.js";
import { type Client } from "discord.js";
import { startBazaarMugWatcher, stopBazaarMugWatcher } from "./bazaar-mug-watcher.js";

const logger = new Logger("Scheduler");

const AUTO_VERIFY_CADENCE_SECONDS = 3600;
const WAR_TRACKER_CADENCE_SECONDS = 5;
const TOKEN_CLEANUP_CADENCE_SECONDS = 60 * 60;
const REVIVE_MAINTENANCE_CADENCE_SECONDS = 60;
const DAILY_SUMMARY_CADENCE_SECONDS = 24 * 60 * 60;
const DB_BACKUP_CADENCE_SECONDS = 24 * 60 * 60;

function getNextUtcRun(hour: number, minute: number): string {
  const nowUtc = new Date();
  const nextRun = new Date(nowUtc);

  nextRun.setUTCHours(hour, minute, 0, 0);
  if (nextRun <= nowUtc) {
    nextRun.setUTCDate(nextRun.getUTCDate() + 1);
  }

  return nextRun.toISOString();
}

export async function syncGlobalCronSchedules(): Promise<void> {
  await ensureWorkerRegistered({
    name: "bot:daily_summary",
    cadenceSeconds: DAILY_SUMMARY_CADENCE_SECONDS,
    initialNextRunAt: getNextUtcRun(5, 5),
  });

  await ensureWorkerRegistered({
    name: "bot:db_backup",
    cadenceSeconds: DB_BACKUP_CADENCE_SECONDS,
    initialNextRunAt: getNextUtcRun(4, 0),
  });

  await ensureWorkerRegistered({
    name: "bot:token_cleanup",
    cadenceSeconds: TOKEN_CLEANUP_CADENCE_SECONDS,
  });

  await ensureWorkerRegistered({
    name: "bot:revive_maintenance",
    cadenceSeconds: REVIVE_MAINTENANCE_CADENCE_SECONDS,
  });
}

export async function syncAutoVerifyCronSchedule(
  guildId: string,
  client?: Client | boolean,
  _enabledParam?: boolean,
): Promise<void> {
  // Overload support: if the second parameter is a boolean (from legacy dashboard calls), map it to _enabledParam
  let discordClient: Client | undefined = undefined;
  if (client && typeof client === "object") {
    discordClient = client;
  }

  const workerName = buildWorkerName("bot:auto_verify", guildId);

  // Check if there are any enabled faction mappings for this guild
  const factionRoleRows = await db
    .selectFrom(TABLE_NAMES.FACTION_ROLES)
    .select(["enabled"])
    .where("guild_id", "=", guildId)
    .execute();

  const isScheduleEnabled = factionRoleRows.some(
    (row: any) =>
      row.enabled !== false &&
      row.enabled !== 0 &&
      row.enabled !== "0" &&
      row.enabled !== null &&
      row.enabled !== undefined
  );

  const guildApiKeys = await getGuildApiKeys(guildId);
  const shouldBeEnabled = isScheduleEnabled && guildApiKeys.length > 0;

  // Resolve guild name
  const guildName = discordClient?.guilds.cache.get(guildId)?.name || guildId;

  // Query database to see current scheduler state
  const currentSchedule = await db
    .selectFrom(TABLE_NAMES.WORKER_SCHEDULES)
    .innerJoin(TABLE_NAMES.WORKERS, `${TABLE_NAMES.WORKERS}.id`, `${TABLE_NAMES.WORKER_SCHEDULES}.worker_id`)
    .select([
      `${TABLE_NAMES.WORKER_SCHEDULES}.enabled`,
      `${TABLE_NAMES.WORKER_SCHEDULES}.cadence_seconds`
    ])
    .where(`${TABLE_NAMES.WORKERS}.name`, "=", workerName)
    .executeTakeFirst();

  if (shouldBeEnabled) {
    if (
      currentSchedule &&
      currentSchedule.enabled === 1 &&
      currentSchedule.cadence_seconds === AUTO_VERIFY_CADENCE_SECONDS
    ) {
      // Already correctly enabled, skip database write & log
      return;
    }

    logger.success(`Enabling auto-verify worker schedule for guild ${guildName} (cadence: ${AUTO_VERIFY_CADENCE_SECONDS}s)`);
    await ensureWorkerRegistered({
      name: workerName,
      cadenceSeconds: AUTO_VERIFY_CADENCE_SECONDS,
      initialNextRunAt: new Date().toISOString(), // Run immediately when newly enabled
      metadata: { guildId },
    });
  } else {
    if (!currentSchedule || currentSchedule.enabled === 0) {
      // Already disabled or not registered, skip database write & log
      return;
    }

    const reason = guildApiKeys.length === 0 ? "no API keys configured" : "no auto-sync enabled factions";
    logger.warn(`Disabling auto-verify worker schedule for guild ${guildName} (${reason})`);
    await setWorkerScheduleEnabled(workerName, false);
  }
}

export async function syncWarTrackerCronSchedules(): Promise<void> {
  const guildRows = (await db
    .selectFrom(TABLE_NAMES.WAR_TRACKERS)
    .select(["guild_id"])
    .where("channel_id", "is not", null)
    .distinct()
    .execute()) as Array<{ guild_id: string }>;

  const activeGuildIds = new Set(guildRows.map((row) => row.guild_id));

  for (const guildId of activeGuildIds) {
    const guildApiKeys = await getGuildApiKeys(guildId);
    if (guildApiKeys.length === 0) {
      logger.warn(`Disabling war-tracker worker schedule for guild ${guildId} (no API keys configured)`);
      await setWorkerScheduleEnabled(
        buildWorkerName("bot:war_tracker", guildId),
        false,
      );
      continue;
    }

    const workerName = buildWorkerName("bot:war_tracker", guildId);
    logger.success(`Enabling war-tracker worker schedule for guild ${guildId} (cadence: ${WAR_TRACKER_CADENCE_SECONDS}s)`);
    await ensureWorkerRegistered({
      name: workerName,
      cadenceSeconds: WAR_TRACKER_CADENCE_SECONDS,
      metadata: { guildId },
    });
  }
}

export async function syncAutoVerifyCronSchedules(client?: Client): Promise<void> {
  const guildRows = (await db
    .selectFrom(TABLE_NAMES.GUILD_CONFIG)
    .select(["guild_id"])
    .execute()) as Array<{ guild_id: string }>;

  for (const row of guildRows) {
    await syncAutoVerifyCronSchedule(row.guild_id, client);
  }
}

export async function syncMercenaryTrackerCronSchedules(): Promise<void> {
  // Find guilds that have active mercenary contracts
  const contractRows = await db
    .selectFrom(TABLE_NAMES.MERCENARY_CONTRACTS)
    .select(["guild_id"])
    .where("status", "=", "active")
    .distinct()
    .execute();

  const activeGuildIds = new Set(contractRows.map((row) => row.guild_id).filter(Boolean) as string[]);

  const allGuilds = await db
    .selectFrom(TABLE_NAMES.GUILD_CONFIG)
    .select(["guild_id"])
    .execute();

  for (const row of allGuilds) {
    const guildId = row.guild_id;
    const workerName = buildWorkerName("bot:mercenary_tracker", guildId);

    if (!activeGuildIds.has(guildId)) {
      await setWorkerScheduleEnabled(workerName, false);
      continue;
    }

    // Get count of registered mercenary keys
    const mercKeysCountRow = await db
      .selectFrom(TABLE_NAMES.MERCENARY_REGISTERED_MERCS)
      .select(db.fn.count("id").as("count"))
      .where("guild_id", "=", guildId)
      .where("is_active", "=", 1)
      .where("api_key", "is not", null)
      .executeTakeFirst();

    const keysCount = Number(mercKeysCountRow?.count || 0);

    // Dynamic cadence based on number of registered keys
    // 0-1 keys: 15s, 2-4 keys: 5s, 5+ keys: 3s
    let cadenceSeconds = 15;
    if (keysCount >= 5) {
      cadenceSeconds = 3;
    } else if (keysCount >= 2) {
      cadenceSeconds = 5;
    }

    logger.success(
      `Enabling mercenary-tracker worker schedule for guild ${guildId} (keys: ${keysCount}, cadence: ${cadenceSeconds}s)`,
    );
    await ensureWorkerRegistered({
      name: workerName,
      cadenceSeconds,
      metadata: { guildId },
    });

    // Force execution immediately
    const workerRow = await db
      .selectFrom(TABLE_NAMES.WORKERS)
      .select(["id"])
      .where("name", "=", workerName)
      .executeTakeFirst();

    if (workerRow) {
      await db
        .updateTable(TABLE_NAMES.WORKER_SCHEDULES)
        .set({
          force_run: 1,
          next_run_at: new Date().toISOString(),
        })
        .where("worker_id", "=", workerRow.id)
        .execute();
    }
  }
}

export async function syncBazaarMugCronSchedule(
  guildId: string,
  client?: Client | boolean,
): Promise<void> {
  let discordClient: Client | undefined = undefined;
  if (client && typeof client === "object") {
    discordClient = client;
  }

  const workerName = buildWorkerName("bot:bazaar_mug_seed", guildId);

  // Check if Bazaar Mug is enabled in config
  const config = await db
    .selectFrom(TABLE_NAMES.BAZAAR_MUG_CONFIG)
    .select(["is_enabled"])
    .where("guild_id", "=", guildId)
    .executeTakeFirst();

  const isModuleEnabled = config?.is_enabled === 1;
  const guildApiKeys = await getGuildApiKeys(guildId);
  const shouldBeEnabled = isModuleEnabled && guildApiKeys.length > 0;

  const guildName = discordClient?.guilds.cache.get(guildId)?.name || guildId;

  const currentSchedule = await db
    .selectFrom(TABLE_NAMES.WORKER_SCHEDULES)
    .innerJoin(TABLE_NAMES.WORKERS, `${TABLE_NAMES.WORKERS}.id`, `${TABLE_NAMES.WORKER_SCHEDULES}.worker_id`)
    .select([
      `${TABLE_NAMES.WORKER_SCHEDULES}.enabled`,
      `${TABLE_NAMES.WORKER_SCHEDULES}.cadence_seconds`
    ])
    .where(`${TABLE_NAMES.WORKERS}.name`, "=", workerName)
    .executeTakeFirst();

  const CADENCE_SECONDS = 21600; // 6 hours

  if (shouldBeEnabled) {
    if (discordClient) {
      await startBazaarMugWatcher(guildId, discordClient);
    }
    if (
      currentSchedule &&
      currentSchedule.enabled === 1 &&
      currentSchedule.cadence_seconds === CADENCE_SECONDS
    ) {
      return;
    }

    logger.success(`Enabling bazaar-mug-seed worker schedule for guild ${guildName} (cadence: ${CADENCE_SECONDS}s)`);
    await ensureWorkerRegistered({
      name: workerName,
      cadenceSeconds: CADENCE_SECONDS,
      initialNextRunAt: new Date().toISOString(), // Run immediately when newly enabled
      metadata: { guildId },
    });
  } else {
    await stopBazaarMugWatcher(guildId);
    if (!currentSchedule || currentSchedule.enabled === 0) {
      return;
    }

    const reason = guildApiKeys.length === 0 ? "no API keys configured" : "module disabled";
    logger.warn(`Disabling bazaar-mug-seed worker schedule for guild ${guildName} (${reason})`);
    await setWorkerScheduleEnabled(workerName, false);
  }
}

export async function syncBazaarMugCronSchedules(client?: Client): Promise<void> {
  const guildRows = (await db
    .selectFrom(TABLE_NAMES.GUILD_CONFIG)
    .select(["guild_id"])
    .execute()) as Array<{ guild_id: string }>;

  for (const row of guildRows) {
    await syncBazaarMugCronSchedule(row.guild_id, client);
  }
}
