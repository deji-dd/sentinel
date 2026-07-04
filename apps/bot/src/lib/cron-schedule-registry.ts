/* eslint-disable @typescript-eslint/no-explicit-any */
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
import { runBazaarMugSeedSync } from "./bazaar-mug-seed.js";

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
  // Clean up legacy bot:daily_summary worker
  const summaryWorker = await db
    .selectFrom(TABLE_NAMES.WORKERS)
    .select(["id"])
    .where("name", "=", "bot:daily_summary")
    .executeTakeFirst();
  
  if (summaryWorker) {
    await db
      .deleteFrom(TABLE_NAMES.WORKER_SCHEDULES)
      .where("worker_id", "=", summaryWorker.id)
      .execute();
    
    await db
      .deleteFrom(TABLE_NAMES.WORKERS)
      .where("id", "=", summaryWorker.id)
      .execute();
    
    logger.info("Successfully cleaned up daily_summary worker registration");
  }

  await ensureWorkerRegistered({
    name: "bot:db_backup",
    cadenceSeconds: DB_BACKUP_CADENCE_SECONDS,
    initialNextRunAt: getNextUtcRun(4, 0),
  });

  await ensureWorkerRegistered({
    name: "bot:token_cleanup",
    cadenceSeconds: TOKEN_CLEANUP_CADENCE_SECONDS,
    initialNextRunAt: new Date().toISOString(),
  });

  await ensureWorkerRegistered({
    name: "bot:revive_maintenance",
    cadenceSeconds: REVIVE_MAINTENANCE_CADENCE_SECONDS,
    initialNextRunAt: new Date().toISOString(),
  });

  // Clean up legacy energy_dashboard worker
  const legacyWorker = await db
    .selectFrom(TABLE_NAMES.WORKERS)
    .select(["id"])
    .where("name", "=", "bot:energy_dashboard")
    .executeTakeFirst();
  
  if (legacyWorker) {
    await db
      .deleteFrom(TABLE_NAMES.WORKER_SCHEDULES)
      .where("worker_id", "=", legacyWorker.id)
      .execute();
    
    await db
      .deleteFrom(TABLE_NAMES.WORKERS)
      .where("id", "=", legacyWorker.id)
      .execute();
    
    logger.info("Successfully cleaned up legacy bot:energy_dashboard worker registration");
  }
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

  // Check if Verification module is enabled at guild level
  const guildConfig = await db
    .selectFrom(TABLE_NAMES.GUILD_CONFIG)
    .select(["enabled_modules"])
    .where("guild_id", "=", guildId)
    .executeTakeFirst();

  let isVerifyEnabled = false;
  if (guildConfig?.enabled_modules) {
    try {
      const modules = typeof guildConfig.enabled_modules === "string"
        ? JSON.parse(guildConfig.enabled_modules)
        : guildConfig.enabled_modules;
      if (Array.isArray(modules) && modules.includes("verify")) {
        isVerifyEnabled = true;
      }
    } catch {
      // Ignored
    }
  }

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
  const shouldBeEnabled = isVerifyEnabled && isScheduleEnabled && guildApiKeys.length > 0;

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

    const reason = !isVerifyEnabled
      ? "module disabled"
      : guildApiKeys.length === 0
      ? "no API keys configured"
      : "no auto-sync enabled factions";
    logger.warn(`Disabling auto-verify worker schedule for guild ${guildName} (${reason})`);
    await setWorkerScheduleEnabled(workerName, false);
  }
}

export async function syncWarTrackerCronSchedule(
  guildId: string,
  client?: Client | boolean,
): Promise<void> {
  let discordClient: Client | undefined = undefined;
  if (client && typeof client === "object") {
    discordClient = client;
  }

  const workerName = buildWorkerName("bot:war_tracker", guildId);

  // Check if territories module is enabled
  const guildConfig = await db
    .selectFrom(TABLE_NAMES.GUILD_CONFIG)
    .select(["enabled_modules"])
    .where("guild_id", "=", guildId)
    .executeTakeFirst();

  let isTerritoriesEnabled = false;
  if (guildConfig?.enabled_modules) {
    try {
      const modules = typeof guildConfig.enabled_modules === "string"
        ? JSON.parse(guildConfig.enabled_modules)
        : guildConfig.enabled_modules;
      if (Array.isArray(modules) && modules.includes("territories")) {
        isTerritoriesEnabled = true;
      }
    } catch {
      // Ignored
    }
  }

  const trackerRows = await db
    .selectFrom(TABLE_NAMES.WAR_TRACKERS)
    .select(["guild_id", "war_id", "channel_id", "message_id"])
    .where("guild_id", "=", guildId)
    .where("channel_id", "is not", null)
    .distinct()
    .execute();

  const isTrackerActive = trackerRows.length > 0;
  const guildApiKeys = await getGuildApiKeys(guildId);
  const shouldBeEnabled = isTerritoriesEnabled && isTrackerActive && guildApiKeys.length > 0;

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
      currentSchedule.cadence_seconds === WAR_TRACKER_CADENCE_SECONDS
    ) {
      return;
    }
    logger.success(`Enabling war-tracker worker schedule for guild ${guildId} (cadence: ${WAR_TRACKER_CADENCE_SECONDS}s)`);
    await ensureWorkerRegistered({
      name: workerName,
      cadenceSeconds: WAR_TRACKER_CADENCE_SECONDS,
      metadata: { guildId },
    });
  } else {
    if (currentSchedule && currentSchedule.enabled === 1) {
      const reason = !isTerritoriesEnabled
        ? "module disabled"
        : guildApiKeys.length === 0
        ? "no API keys configured"
        : "no active war tracker channels";
      logger.warn(`Disabling war-tracker worker schedule for guild ${guildId} (${reason})`);
      await setWorkerScheduleEnabled(workerName, false);
    }

    // Clean up persistent war tracker messages if module is disabled
    if (!isTerritoriesEnabled && discordClient && isTrackerActive) {
      logger.info(`Cleaning up war tracker messages for guild ${guildId} due to module teardown`);
      for (const tracker of trackerRows) {
        if (tracker.channel_id && tracker.message_id) {
          try {
            const channel = await discordClient.channels.fetch(tracker.channel_id).catch(() => null);
            if (channel && channel.isTextBased()) {
              const msg = await channel.messages.fetch(tracker.message_id).catch(() => null);
              if (msg) {
                await msg.delete().catch(() => null);
              }
            }
          } catch (err) {
            logger.debug(`Failed to delete war tracker message for war ${tracker.war_id}: ${err}`);
          }
        }
      }

      await db
        .updateTable(TABLE_NAMES.WAR_TRACKERS)
        .set({ channel_id: null, message_id: null })
        .where("guild_id", "=", guildId)
        .execute();
    }
  }
}

export async function syncWarTrackerCronSchedules(client?: Client): Promise<void> {
  const guildRows = (await db
    .selectFrom(TABLE_NAMES.GUILD_CONFIG)
    .select(["guild_id"])
    .execute()) as Array<{ guild_id: string }>;

  for (const row of guildRows) {
    await syncWarTrackerCronSchedule(row.guild_id, client);
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

export async function syncMercenaryTrackerCronSchedule(
  guildId: string,
  client?: Client | boolean,
): Promise<void> {
  let discordClient: Client | undefined = undefined;
  if (client && typeof client === "object") {
    discordClient = client;
  }

  const workerName = buildWorkerName("bot:mercenary_tracker", guildId);

  // Check if mercenary module is enabled
  const guildConfig = await db
    .selectFrom(TABLE_NAMES.GUILD_CONFIG)
    .select(["enabled_modules"])
    .where("guild_id", "=", guildId)
    .executeTakeFirst();

  let isMercEnabled = false;
  if (guildConfig?.enabled_modules) {
    try {
      const modules = typeof guildConfig.enabled_modules === "string"
        ? JSON.parse(guildConfig.enabled_modules)
        : guildConfig.enabled_modules;
      if (Array.isArray(modules) && modules.includes("mercenary")) {
        isMercEnabled = true;
      }
    } catch {
      // Ignored
    }
  }

  // Find if guild has active mercenary contracts
  const contractRows = await db
    .selectFrom(TABLE_NAMES.MERCENARY_CONTRACTS)
    .select(["guild_id"])
    .where("guild_id", "=", guildId)
    .where("status", "=", "active")
    .execute();

  const hasActiveContracts = contractRows.length > 0;

  const currentSchedule = await db
    .selectFrom(TABLE_NAMES.WORKER_SCHEDULES)
    .innerJoin(TABLE_NAMES.WORKERS, `${TABLE_NAMES.WORKERS}.id`, `${TABLE_NAMES.WORKER_SCHEDULES}.worker_id`)
    .select([
      `${TABLE_NAMES.WORKER_SCHEDULES}.enabled`,
      `${TABLE_NAMES.WORKER_SCHEDULES}.cadence_seconds`
    ])
    .where(`${TABLE_NAMES.WORKERS}.name`, "=", workerName)
    .executeTakeFirst();

  if (!isMercEnabled || !hasActiveContracts) {
    if (currentSchedule && currentSchedule.enabled === 1) {
      logger.warn(`Disabling mercenary-tracker worker schedule for guild ${guildId} (${!isMercEnabled ? "module disabled" : "no active contracts"})`);
      await setWorkerScheduleEnabled(workerName, false);
    }

    // Clean up persistent registration panel message if module is disabled
    if (!isMercEnabled && discordClient) {
      const config = await db
        .selectFrom(TABLE_NAMES.MERCENARY_CONFIG)
        .select(["merc_registration_channel_id", "merc_registration_message_id"])
        .where("guild_id", "=", guildId)
        .executeTakeFirst();

      if (config && config.merc_registration_message_id && config.merc_registration_channel_id) {
        logger.info(`Cleaning up mercenary registration panel for guild ${guildId} due to module teardown`);
        try {
          const channel = await discordClient.channels.fetch(config.merc_registration_channel_id).catch(() => null);
          if (channel && channel.isTextBased()) {
            const msg = await channel.messages.fetch(config.merc_registration_message_id).catch(() => null);
            if (msg) {
              await msg.delete().catch(() => null);
            }
          }
        } catch (err) {
          logger.debug(`Failed to delete mercenary registration panel message: ${err}`);
        }

        await db
          .updateTable(TABLE_NAMES.MERCENARY_CONFIG)
          .set({ merc_registration_message_id: null })
          .where("guild_id", "=", guildId)
          .execute();
      }
    }
    return;
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

  if (
    currentSchedule &&
    currentSchedule.enabled === 1 &&
    currentSchedule.cadence_seconds === cadenceSeconds
  ) {
    return;
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

export async function syncMercenaryTrackerCronSchedules(client?: Client): Promise<void> {
  const allGuilds = await db
    .selectFrom(TABLE_NAMES.GUILD_CONFIG)
    .select(["guild_id"])
    .execute();

  for (const row of allGuilds) {
    await syncMercenaryTrackerCronSchedule(row.guild_id, client);
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

  // 1. Fetch guild config to check if module is enabled at guild level
  const guildConfig = await db
    .selectFrom(TABLE_NAMES.GUILD_CONFIG)
    .select(["enabled_modules"])
    .where("guild_id", "=", guildId)
    .executeTakeFirst();

  let isModuleEnabledAtGuildLevel = false;
  if (guildConfig?.enabled_modules) {
    try {
      const modules = typeof guildConfig.enabled_modules === "string"
        ? JSON.parse(guildConfig.enabled_modules)
        : guildConfig.enabled_modules;
      if (Array.isArray(modules) && modules.includes("bazaar_mug")) {
        isModuleEnabledAtGuildLevel = true;
      }
    } catch {
      // Ignored
    }
  }

  // 2. Fetch module config
  const config = await db
    .selectFrom(TABLE_NAMES.BAZAAR_MUG_CONFIG)
    .select(["is_enabled", "dashboard_message_id", "notification_channel_id"])
    .where("guild_id", "=", guildId)
    .executeTakeFirst();

  // If enabled in module config but disabled at guild level, auto-disable in module config
  if (!isModuleEnabledAtGuildLevel && config && config.is_enabled === 1) {
    await db
      .updateTable(TABLE_NAMES.BAZAAR_MUG_CONFIG)
      .set({ is_enabled: 0 })
      .where("guild_id", "=", guildId)
      .execute();
  }

  const isModuleEnabled = config?.is_enabled === 1 && isModuleEnabledAtGuildLevel;
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

      // Check if targets are empty. If so, seed immediately and asynchronously
      const targetCountRow = await db
        .selectFrom(TABLE_NAMES.BAZAAR_MUG_TARGETS)
        .select(db.fn.count("player_id").as("count"))
        .where("guild_id", "=", guildId)
        .executeTakeFirst();
      const targetCount = Number(targetCountRow?.count || 0);

      if (targetCount === 0) {
        logger.info(`Targets are empty for guild ${guildId}, running initial bazaar target seeding...`);
        void runBazaarMugSeedSync(discordClient, guildId).catch((err) => {
          logger.error(`Error during initial bazaar target seeding for guild ${guildId}:`, err);
        });
      }
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

    // Clean up persistent dashboard message if module is disabled
    if (!isModuleEnabled && discordClient && config && config.dashboard_message_id && config.notification_channel_id) {
      logger.info(`Cleaning up bazaar mug dashboard for guild ${guildId} due to module teardown`);
      try {
        const channel = await discordClient.channels.fetch(config.notification_channel_id).catch(() => null);
        if (channel && channel.isTextBased()) {
          const msg = await channel.messages.fetch(config.dashboard_message_id).catch(() => null);
          if (msg) {
            await msg.delete().catch(() => null);
          }
        }
      } catch (err) {
        logger.debug(`Failed to delete bazaar mug dashboard message: ${err}`);
      }

      await db
        .updateTable(TABLE_NAMES.BAZAAR_MUG_CONFIG)
        .set({ dashboard_message_id: null })
        .where("guild_id", "=", guildId)
        .execute();
    }

    if (!currentSchedule || currentSchedule.enabled === 0) {
      return;
    }

    const reason = !isModuleEnabledAtGuildLevel
      ? "module disabled"
      : guildApiKeys.length === 0
      ? "no API keys configured"
      : "module disabled";
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

export async function syncReviveTeardown(
  guildId: string,
  client?: Client | boolean,
): Promise<void> {
  let discordClient: Client | undefined = undefined;
  if (client && typeof client === "object") {
    discordClient = client;
  }

  // Check if revive module is enabled
  const guildConfig = await db
    .selectFrom(TABLE_NAMES.GUILD_CONFIG)
    .select(["enabled_modules"])
    .where("guild_id", "=", guildId)
    .executeTakeFirst();

  let isReviveEnabled = false;
  if (guildConfig?.enabled_modules) {
    try {
      const modules = typeof guildConfig.enabled_modules === "string"
        ? JSON.parse(guildConfig.enabled_modules)
        : guildConfig.enabled_modules;
      if (Array.isArray(modules) && modules.includes("revive")) {
        isReviveEnabled = true;
      }
    } catch {
      // Ignored
    }
  }

  if (!isReviveEnabled && discordClient) {
    const config = await db
      .selectFrom(TABLE_NAMES.REVIVE_CONFIG)
      .select(["request_channel_id", "request_message_id"])
      .where("guild_id", "=", guildId)
      .executeTakeFirst();

    if (config && config.request_message_id && config.request_channel_id) {
      logger.info(`Cleaning up revive request panel for guild ${guildId} due to module teardown`);
      try {
        const channel = await discordClient.channels.fetch(config.request_channel_id).catch(() => null);
        if (channel && channel.isTextBased()) {
          const msg = await channel.messages.fetch(config.request_message_id).catch(() => null);
          if (msg) {
            await msg.delete().catch(() => null);
          }
        }
      } catch (err) {
        logger.debug(`Failed to delete revive request panel message: ${err}`);
      }

      await db
        .updateTable(TABLE_NAMES.REVIVE_CONFIG)
        .set({ request_message_id: null })
        .where("guild_id", "=", guildId)
        .execute();
    }
  }
}

export async function syncReactionRolesTeardown(
  guildId: string,
  client?: Client | boolean,
): Promise<void> {
  let discordClient: Client | undefined = undefined;
  if (client && typeof client === "object") {
    discordClient = client;
  }

  // Check if reaction_roles module is enabled
  const guildConfig = await db
    .selectFrom(TABLE_NAMES.GUILD_CONFIG)
    .select(["enabled_modules"])
    .where("guild_id", "=", guildId)
    .executeTakeFirst();

  let isReactionRolesEnabled = false;
  if (guildConfig?.enabled_modules) {
    try {
      const modules = typeof guildConfig.enabled_modules === "string"
        ? JSON.parse(guildConfig.enabled_modules)
        : guildConfig.enabled_modules;
      if (Array.isArray(modules) && modules.includes("reaction_roles")) {
        isReactionRolesEnabled = true;
      }
    } catch {
      // Ignored
    }
  }

  if (!isReactionRolesEnabled && discordClient) {
    // Fetch all reaction role messages for this guild
    const messages = await db
      .selectFrom(TABLE_NAMES.REACTION_ROLE_MESSAGES)
      .select(["id", "channel_id", "message_id"])
      .where("guild_id", "=", guildId)
      .execute();

    if (messages.length > 0) {
      logger.info(`Cleaning up ${messages.length} reaction role messages for guild ${guildId} due to module teardown`);
      for (const msgRecord of messages) {
        try {
          const channel = await discordClient.channels.fetch(msgRecord.channel_id).catch(() => null);
          if (channel && channel.isTextBased()) {
            const msg = await channel.messages.fetch(msgRecord.message_id).catch(() => null);
            if (msg) {
              await msg.delete().catch(() => null);
            }
          }
        } catch (err) {
          logger.debug(`Failed to delete reaction role message ${msgRecord.message_id}: ${err}`);
        }

        // Delete from DB mappings and messages
        await db
          .deleteFrom(TABLE_NAMES.REACTION_ROLE_MAPPINGS)
          .where("message_id", "=", msgRecord.message_id)
          .execute();
        
        await db
          .deleteFrom(TABLE_NAMES.REACTION_ROLE_MESSAGES)
          .where("id", "=", msgRecord.id)
          .execute();
      }
    }
  }
}

export async function syncAllGuildCronSchedules(
  guildId: string,
  client?: Client | boolean,
): Promise<void> {
  await syncAutoVerifyCronSchedule(guildId, client);
  await syncWarTrackerCronSchedule(guildId, client);
  await syncMercenaryTrackerCronSchedule(guildId, client);
  await syncBazaarMugCronSchedule(guildId, client);
  await syncReviveTeardown(guildId, client);
  await syncReactionRolesTeardown(guildId, client);
}
