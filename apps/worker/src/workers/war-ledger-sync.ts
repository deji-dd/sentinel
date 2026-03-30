/**
 * War ledger sync worker
 * Runs every 15 seconds to fetch territory wars from v1 API
 * Upserts new wars and sets is_warring = true on affected territories
 * Dispatches notifications for war start/end events
 *
 * Uses system API key via v1 API /torn endpoint
 */

import { TABLE_NAMES, ApiKeyRotator } from "@sentinel/shared";
import { startDbScheduledRunner } from "../lib/scheduler.js";
import { getAllSystemApiKeys } from "../lib/api-keys.js";
import { logDuration, logError } from "../lib/logger.js";
import { tornApi } from "../services/torn-client.js";
import { executeSync } from "../lib/sync.js";
import { processAndDispatchNotifications } from "../lib/tt-notification-dispatcher.js";
import { getKysely } from "@sentinel/shared/db/sqlite.js";

interface TerritoryWar {
  territory_war_id: number;
  assaulting_faction: number;
  defending_faction: number;
  score: number;
  required_score: number;
  started: number;
  ends: number;
  assaulters: number[];
  defenders: number[];
}

interface TornV1TerritorywarsResponse {
  territorywars: Record<string, TerritoryWar>;
}

interface ExistingWarRow {
  war_id: number;
  territory_id: string;
}

interface ActiveWarRow {
  war_id: number;
  territory_id: string;
  assaulting_faction: number;
  defending_faction: number;
  start_time: string;
}

interface TerritoryStateRow {
  territory_id: string;
  faction_id: number | null;
}

// Track recent war counts for adaptive cadence
const recentWarCounts: number[] = [];
const MAX_HISTORY = 10; // Track last 10 runs
const DB_WRITE_CHUNK_SIZE = 200;

function chunkArray<T>(rows: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < rows.length; i += size) {
    chunks.push(rows.slice(i, i + size));
  }
  return chunks;
}

/**
 * Calculate dynamic cadence based on war activity patterns
 * - If wars are stable (no changes): ramp up to 60s
 * - If wars are changing: ramp down to 5s
 */
function calculateWarCadence(currentWarCount: number): number {
  recentWarCounts.push(currentWarCount);
  if (recentWarCounts.length > MAX_HISTORY) {
    recentWarCounts.shift();
  }

  // Need at least 3 data points to detect patterns
  if (recentWarCounts.length < 3) {
    return 5; // Start aggressive
  }

  // Calculate if war count is stable (no changes in last N runs)
  const allSame = recentWarCounts.every(
    (count) => count === recentWarCounts[0],
  );
  const recentChanges = recentWarCounts.slice(-5); // Last 5 runs
  const recentlyStable = recentChanges.every(
    (count) => count === recentChanges[0],
  );

  if (allSame && recentWarCounts.length >= 5) {
    // Very stable - max cadence
    return 60;
  } else if (recentlyStable) {
    // Recently stable - medium cadence
    return 15;
  } else {
    // Active changes - aggressive cadence
    return 5;
  }
}

export function startWarLedgerSyncWorker() {
  return startDbScheduledRunner({
    worker: "war_ledger_sync",
    defaultCadenceSeconds: 5, // Every 5 seconds for real-time war precision
    getDynamicCadence: async () => {
      // Return current calculated cadence based on recent activity
      return recentWarCounts.length > 0
        ? calculateWarCadence(recentWarCounts[recentWarCounts.length - 1])
        : 5;
    },
    handler: async () => {
      return await executeSync({
        name: "war_ledger_sync",
        timeout: 60_000, // 1 minute max
        handler: async () => {
          const startTime = Date.now();
          const db = getKysely();

          try {
            // Get system API keys and initialize rotator for load balancing
            const apiKeys = await getAllSystemApiKeys("system");
            if (!apiKeys.length) {
              // Silently skip if no API key
              return;
            }

            // Create API key rotator to distribute requests across all available keys
            const keyRotator = new ApiKeyRotator(apiKeys);

            // Fetch territory wars from v1 API using shared client with rate limiting
            const response = await tornApi.getRaw(
              "/torn",
              keyRotator.getNextKey(),
              {
                selections: "territorywars",
              },
            );

            if ("error" in response) {
              // Log API error with timestamp before skipping
              const errorObj = (response as { error?: unknown }).error;
              let errorMsg = String(errorObj);
              if (
                typeof errorObj === "object" &&
                errorObj !== null &&
                "error" in errorObj
              ) {
                errorMsg = String(
                  (errorObj as { error?: unknown }).error ?? errorObj,
                );
              }
              logError(
                "war_ledger_sync",
                `API error (${new Date().toISOString()}): ${errorMsg}`,
              );
              // Just return - no need to throw, API error is expected sometimes
              return;
            }

            const data = response as unknown as TornV1TerritorywarsResponse;
            const warEntries = Object.entries(data.territorywars || {});

            if (warEntries.length === 0) {
              logDuration(
                "war_ledger_sync",
                "No active wars",
                Date.now() - startTime,
              );
              return;
            }

            // Transform to array with territory code included
            const wars: Array<TerritoryWar & { territory_id: string }> =
              warEntries.map(([territoryCode, war]) => ({
                ...war,
                territory_id: territoryCode,
              }));

            // All wars are valid - blueprint sync will populate territories
            // We don't depend on blueprint existing first
            const validWars = wars;

            if (validWars.length === 0) {
              logDuration(
                "war_ledger_sync",
                "No active wars",
                Date.now() - startTime,
              );
              return;
            }

            // Separate into new wars and existing wars
            const warIds = validWars.map((w) => w.territory_war_id);
            let existingWars: ExistingWarRow[] = [];
            if (warIds.length > 0) {
              existingWars = (await db
                .selectFrom(TABLE_NAMES.WAR_LEDGER)
                .select(["war_id", "territory_id"])
                .where("war_id", "in", warIds)
                .execute()) as ExistingWarRow[];
            }

            const existingWarIds = new Set(
              (existingWars || []).map((w) => w.war_id),
            );

            // Check if this is bootstrap mode (empty war ledger)
            // If so, don't send notifications for "new" wars - just sync the data
            const totalWarCountRow = await db
              .selectFrom(TABLE_NAMES.WAR_LEDGER)
              .select((eb) => eb.fn.count("war_id").as("count"))
              .executeTakeFirst();
            const totalWarCount = Number(totalWarCountRow?.count ?? 0);

            const isBootstrapMode = (totalWarCount || 0) === 0;

            const newWars = validWars.filter(
              (w) => !existingWarIds.has(w.territory_war_id),
            );

            // Detect ended wars (wars in DB but not in API response)
            const allActiveWars = (await db
              .selectFrom(TABLE_NAMES.WAR_LEDGER)
              .select([
                "war_id",
                "territory_id",
                "assaulting_faction",
                "defending_faction",
                "start_time",
              ])
              .where("end_time", "is", null)
              .execute()) as ActiveWarRow[];

            const activeWarIds = new Set(
              validWars.map((w) => w.territory_war_id),
            );
            const endedWars = (allActiveWars || []).filter(
              (w) => !activeWarIds.has(w.war_id),
            );

            // Prepare notifications
            const notifications: Array<{
              guild_id: string;
              territory_id: string;
              event_type:
                | "war_started"
                | "war_ended"
                | "peace_treaty"
                | "assault_succeeded"
                | "assault_failed";
              assaulting_faction?: number;
              defending_faction?: number;
              occupying_faction: number | null;
              war_id?: number;
              war_duration_hours?: number;
            }> = [];

            // Add war started notifications (skip in bootstrap mode to prevent cascade)
            if (!isBootstrapMode) {
              for (const war of newWars) {
                notifications.push({
                  guild_id: "",
                  territory_id: war.territory_id,
                  event_type: "war_started",
                  assaulting_faction: war.assaulting_faction,
                  defending_faction: war.defending_faction,
                  occupying_faction: null,
                  war_id: war.territory_war_id,
                });
              }
            }

            // Add war ended notifications and update DB
            for (const war of endedWars) {
              // Get current owner to determine victor
              const territoryState = (await db
                .selectFrom(TABLE_NAMES.TERRITORY_STATE)
                .select("faction_id")
                .where("territory_id", "=", war.territory_id)
                .limit(1)
                .executeTakeFirst()) as
                | { faction_id: number | null }
                | undefined;

              const victor = territoryState?.faction_id ?? null;
              const now = new Date();
              const warStartTime = new Date(war.start_time);
              const hoursSinceStart =
                (now.getTime() - warStartTime.getTime()) / (1000 * 60 * 60);

              // Truce: war ended before 72 hours (3 days) AND defender still owns territory
              const isTruce =
                hoursSinceStart < 72 && victor === war.defending_faction;

              // Determine assault outcome
              let eventType:
                | "peace_treaty"
                | "war_ended"
                | "assault_succeeded"
                | "assault_failed" = "war_ended";
              if (isTruce) {
                eventType = "peace_treaty";
              } else if (victor === war.assaulting_faction) {
                eventType = "assault_succeeded";
              } else if (victor === war.defending_faction) {
                eventType = "assault_failed";
              }
              // else: neither faction owns it (shouldn't happen), use generic war_ended

              notifications.push({
                guild_id: "",
                territory_id: war.territory_id,
                event_type: eventType,
                assaulting_faction: war.assaulting_faction,
                defending_faction: war.defending_faction,
                occupying_faction: victor,
                war_id: war.war_id,
                war_duration_hours: hoursSinceStart,
              });

              // Mark war as ended in DB
              await db
                .updateTable(TABLE_NAMES.WAR_LEDGER)
                .set({
                  end_time: new Date().toISOString(),
                  victor_faction: victor,
                })
                .where("war_id", "=", war.war_id)
                .execute();

              // Mark territory as not warring
              await db
                .updateTable(TABLE_NAMES.TERRITORY_STATE)
                .set({ is_warring: 0 })
                .where("territory_id", "=", war.territory_id)
                .execute();
            }

            // Upsert war data
            const warData = validWars.map((w) => ({
              war_id: w.territory_war_id,
              territory_id: w.territory_id,
              assaulting_faction: w.assaulting_faction,
              defending_faction: w.defending_faction,
              victor_faction: null, // v1 API doesn't provide victor info, set via state change detection
              start_time: new Date(w.started * 1000).toISOString(),
              end_time: null, // Active wars must have null end_time
            }));

            try {
              for (const chunk of chunkArray(warData, DB_WRITE_CHUNK_SIZE)) {
                await db
                  .insertInto(TABLE_NAMES.WAR_LEDGER)
                  .values(chunk)
                  .onConflict((oc) =>
                    oc.column("war_id").doUpdateSet((eb) => ({
                      territory_id: eb.ref("excluded.territory_id"),
                      assaulting_faction: eb.ref("excluded.assaulting_faction"),
                      defending_faction: eb.ref("excluded.defending_faction"),
                      victor_faction: eb.ref("excluded.victor_faction"),
                      start_time: eb.ref("excluded.start_time"),
                      end_time: eb.ref("excluded.end_time"),
                    })),
                  )
                  .execute();
              }
            } catch (error) {
              logError(
                "war_ledger_sync",
                `Failed to upsert wars: ${error instanceof Error ? error.message : String(error)}`,
              );
              throw error;
            }

            // Update territory states to mark as warring
            // First, ensure missing territory_state rows exist without clobbering faction_id
            const warringTerritories = validWars.map((w) => w.territory_id);

            let existingStates: TerritoryStateRow[] = [];
            if (warringTerritories.length > 0) {
              existingStates = (await db
                .selectFrom(TABLE_NAMES.TERRITORY_STATE)
                .select(["territory_id", "faction_id"])
                .where("territory_id", "in", warringTerritories)
                .execute()) as TerritoryStateRow[];
            }

            const existingIds = new Set(
              (existingStates || []).map((row) => row.territory_id),
            );
            const missingIds = warringTerritories.filter(
              (territoryId) => !existingIds.has(territoryId),
            );

            if (missingIds.length > 0) {
              try {
                for (const chunk of chunkArray(
                  missingIds,
                  DB_WRITE_CHUNK_SIZE,
                )) {
                  await db
                    .insertInto(TABLE_NAMES.TERRITORY_STATE)
                    .values(
                      chunk.map((territoryId) => ({
                        territory_id: territoryId,
                        is_warring: 1,
                      })),
                    )
                    .onConflict((oc) => oc.column("territory_id").doNothing())
                    .execute();
                }
              } catch (error) {
                logError(
                  "war_ledger_sync",
                  `Failed to insert missing territory states: ${error instanceof Error ? error.message : String(error)}`,
                );
              }
            }

            // Mark all active-war territories as warring without touching faction ownership
            if (warringTerritories.length > 0) {
              try {
                await db
                  .updateTable(TABLE_NAMES.TERRITORY_STATE)
                  .set({ is_warring: 1 })
                  .where("territory_id", "in", warringTerritories)
                  .execute();
              } catch (error) {
                logError(
                  "war_ledger_sync",
                  `Failed to update territory state: ${error instanceof Error ? error.message : String(error)}`,
                );
                // Don't return false - DB update failure shouldn't prevent ledger update
              }
            }

            const duration = Date.now() - startTime;
            logDuration(
              "war_ledger_sync",
              `Sync completed for ${validWars.length} wars (${newWars.length} new, ${endedWars.length} ended)`,
              duration,
            );

            // Dispatch notifications for war changes
            if (notifications.length > 0) {
              await processAndDispatchNotifications(notifications);
            }

            // Update cadence calculation with current war count
            calculateWarCadence(validWars.length);
          } catch (error) {
            const message =
              error instanceof Error ? error.message : String(error);
            logError("war_ledger_sync", `Failed: ${message}`);
            throw error; // Re-throw so executeSync knows this failed
          }
        },
      });
    },
  });
}
