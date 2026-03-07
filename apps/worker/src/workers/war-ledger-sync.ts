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
import { getDB } from "@sentinel/shared/db/sqlite.js";

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
          const db = getDB();

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
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const errorObj = (response as any).error;
              const errorMsg =
                typeof errorObj === "object" && errorObj?.error
                  ? errorObj.error
                  : String(errorObj);
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
              const warIdPlaceholders = warIds.map(() => "?").join(", ");
              existingWars = db
                .prepare(
                  `SELECT war_id, territory_id
                   FROM "${TABLE_NAMES.WAR_LEDGER}"
                   WHERE war_id IN (${warIdPlaceholders})`,
                )
                .all(...warIds) as ExistingWarRow[];
            }

            const existingWarIds = new Set(
              (existingWars || []).map((w) => w.war_id),
            );

            // Check if this is bootstrap mode (empty war ledger)
            // If so, don't send notifications for "new" wars - just sync the data
            const totalWarCount = (
              db
                .prepare(
                  `SELECT COUNT(*) as count FROM "${TABLE_NAMES.WAR_LEDGER}"`,
                )
                .get() as { count: number }
            ).count;

            const isBootstrapMode = (totalWarCount || 0) === 0;

            const newWars = validWars.filter(
              (w) => !existingWarIds.has(w.territory_war_id),
            );

            // Detect ended wars (wars in DB but not in API response)
            const allActiveWars = db
              .prepare(
                `SELECT war_id, territory_id, assaulting_faction, defending_faction, start_time
                 FROM "${TABLE_NAMES.WAR_LEDGER}"
                 WHERE end_time IS NULL`,
              )
              .all() as ActiveWarRow[];

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
              const territoryState = db
                .prepare(
                  `SELECT faction_id FROM "${TABLE_NAMES.TERRITORY_STATE}" WHERE territory_id = ? LIMIT 1`,
                )
                .get(war.territory_id) as
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
              db.prepare(
                `UPDATE "${TABLE_NAMES.WAR_LEDGER}"
                 SET end_time = ?, victor_faction = ?
                 WHERE war_id = ?`,
              ).run(new Date().toISOString(), victor, war.war_id);

              // Mark territory as not warring
              db.prepare(
                `UPDATE "${TABLE_NAMES.TERRITORY_STATE}" SET is_warring = 0 WHERE territory_id = ?`,
              ).run(war.territory_id);
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
              const upsertWarTx = db.transaction(
                (
                  rows: Array<{
                    war_id: number;
                    territory_id: string;
                    assaulting_faction: number;
                    defending_faction: number;
                    victor_faction: number | null;
                    start_time: string;
                    end_time: string | null;
                  }>,
                ) => {
                  const stmt = db.prepare(
                    `INSERT INTO "${TABLE_NAMES.WAR_LEDGER}"
                     (war_id, territory_id, assaulting_faction, defending_faction, victor_faction, start_time, end_time)
                     VALUES (?, ?, ?, ?, ?, ?, ?)
                     ON CONFLICT(war_id) DO UPDATE SET
                       territory_id = excluded.territory_id,
                       assaulting_faction = excluded.assaulting_faction,
                       defending_faction = excluded.defending_faction,
                       victor_faction = excluded.victor_faction,
                       start_time = excluded.start_time,
                       end_time = excluded.end_time`,
                  );

                  for (const row of rows) {
                    stmt.run(
                      row.war_id,
                      row.territory_id,
                      row.assaulting_faction,
                      row.defending_faction,
                      row.victor_faction,
                      row.start_time,
                      row.end_time,
                    );
                  }
                },
              );

              upsertWarTx(warData);
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
              const territoryPlaceholders = warringTerritories
                .map(() => "?")
                .join(", ");
              existingStates = db
                .prepare(
                  `SELECT territory_id, faction_id
                   FROM "${TABLE_NAMES.TERRITORY_STATE}"
                   WHERE territory_id IN (${territoryPlaceholders})`,
                )
                .all(...warringTerritories) as TerritoryStateRow[];
            }

            const existingIds = new Set(
              (existingStates || []).map((row) => row.territory_id),
            );
            const missingIds = warringTerritories.filter(
              (territoryId) => !existingIds.has(territoryId),
            );

            if (missingIds.length > 0) {
              try {
                const insertMissingTx = db.transaction(
                  (territoryIds: string[]) => {
                    const stmt = db.prepare(
                      `INSERT INTO "${TABLE_NAMES.TERRITORY_STATE}" (territory_id, is_warring)
                     VALUES (?, ?)`,
                    );
                    for (const territoryId of territoryIds) {
                      stmt.run(territoryId, 1);
                    }
                  },
                );
                insertMissingTx(missingIds);
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
                const updatePlaceholders = warringTerritories
                  .map(() => "?")
                  .join(", ");
                db.prepare(
                  `UPDATE "${TABLE_NAMES.TERRITORY_STATE}"
                   SET is_warring = 1
                   WHERE territory_id IN (${updatePlaceholders})`,
                ).run(...warringTerritories);
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
