import { TABLE_NAMES } from "@sentinel/shared";
import { getKysely, sqliteDB } from "@sentinel/shared";
import { SentinelDatabase, Collection } from "@sentinel/shared";
import { renameSync, existsSync, unlinkSync } from "fs";
import { randomUUID } from "crypto";

const isProd = process.env.NODE_ENV === "production";
const TARGET_PATH = isProd ? `./data/sentinel-temp.db` : undefined;

const legacyDb = getKysely();
const newEngine = new SentinelDatabase(TARGET_PATH);

const TABLE_MAPPING: Record<string, string> = {
  [TABLE_NAMES.WORKER_SCHEDULES]: "worker_schedules",
  [TABLE_NAMES.RATE_LIMIT_REQUESTS_PER_USER]: "rate_limit_requests_per_user",
  [TABLE_NAMES.SYSTEM_API_KEYS]: "system_api_keys",
  [TABLE_NAMES.GUILD_API_KEYS]: "guild_api_keys",
  [TABLE_NAMES.API_KEY_USER_MAPPING]: "api_key_user_mapping",
  [TABLE_NAMES.VERIFIED_USERS]: "verified_users",
  [TABLE_NAMES.GUILD_CONFIG]: "guild_config",
  [TABLE_NAMES.FACTION_ROLES]: "faction_roles",
  [TABLE_NAMES.TERRITORY_BLUEPRINT]: "territory_blueprint",
  [TABLE_NAMES.WAR_LEDGER]: "war_ledger",
  [TABLE_NAMES.TORN_FACTIONS]: "torn_factions",
  [TABLE_NAMES.REACTION_ROLE_MESSAGES]: "reaction_role_messages",
  [TABLE_NAMES.REACTION_ROLE_MAPPINGS]: "reaction_role_mappings",
  [TABLE_NAMES.REACTION_ROLE_CONFIG]: "reaction_role_config",
  [TABLE_NAMES.BAZAAR_MUG_CONFIG]: "bazaar_mug_config",
  [TABLE_NAMES.BAZAAR_MUG_TARGETS]: "bazaar_mug_targets",
  [TABLE_NAMES.PUSH_SUBSCRIPTIONS]: "push_subscriptions",
};

/**
 * Executes a one-way data migration from Kysely relational tables to the NoSQL document wrapper.
 * * @description
 * - Development: Reads legacy tables and writes JSON documents into the same local DB file. Safe to execute repeatedly.
 * - Production: Creates a temporary DB, migrates data, and executes a zero-downtime blue/green file swap.
 * * @returns {Promise<void>} Resolves when the migration and file cleanup are fully complete.
 */
async function runMigration(): Promise<void> {
  console.log("Starting Hybrid Data Migration...");

  for (const [oldTableName, newCollectionName] of Object.entries(
    TABLE_MAPPING,
  )) {
    console.log(`Migrating ${oldTableName} ➔ nosql_${newCollectionName}...`);

    try {
      const rows = await legacyDb
        .selectFrom(oldTableName as any)
        .selectAll()
        .execute();

      if (rows.length === 0) {
        console.log(`  ➔ Skipping: No data found in ${oldTableName}.`);
        continue;
      }

      const targetCollection = new Collection<any>(
        newEngine,
        newCollectionName,
      );

      const docsToInsert = rows.map((row) => ({
        id:
          row.id?.toString() ||
          row.guild_id?.toString() ||
          row.discord_id?.toString() ||
          randomUUID(),
        ...row,
      }));

      targetCollection.insertMany(docsToInsert);
      console.log(`  ➔ Success: Migrated ${docsToInsert.length} documents.`);
    } catch (error) {
      console.error(`  ➔ Error migrating ${oldTableName}:`, error);
    }
  }

  await legacyDb.destroy();
  newEngine.optimizeDiskSpace();
  newEngine.close();

  if (isProd) {
    console.log("Executing Blue/Green File Swap for Production...");

    // Bypass private access for this one-time maintenance script to grab absolute paths
    const absoluteOldDbPath = (sqliteDB as any).dbPath;
    const absoluteTempDbPath = (newEngine as any).dbPath;

    try {
      if (existsSync(absoluteOldDbPath))
        unlinkSync(absoluteOldDbPath);
      if (existsSync(absoluteTempDbPath))
        renameSync(absoluteTempDbPath, absoluteOldDbPath);

      // Cleanup lingering SQLite Write-Ahead Logs
      if (existsSync(`${absoluteOldDbPath}-wal`))
        unlinkSync(`${absoluteOldDbPath}-wal`);
      if (existsSync(`${absoluteOldDbPath}-shm`))
        unlinkSync(`${absoluteOldDbPath}-shm`);

      console.log(
        "✅ Blue/Green Swap complete. Temp database is now production database.",
      );
    } catch (err) {
      console.error("❌ Failed to swap files.", err);
    }
  } else {
    console.log(
      "✅ Dev Migration Complete! Legacy and NoSQL tables are coexisting.",
    );
  }
}

runMigration();
