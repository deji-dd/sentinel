/**
 * Territory state sync worker
 * Runs with dynamic cadence based on number of available API keys
 * Fetches territory ownership data and syncs to DB
 * Triggers resolution handshake when ownership changes
 *
 * Uses system API key for /faction/territoryownership endpoint with pagination
 */

import { TABLE_NAMES } from "@sentinel/shared";
import { startDbScheduledRunner } from "../lib/scheduler.js";
import { supabase } from "../lib/supabase.js";
import { getAllSystemApiKeys } from "../lib/api-keys.js";
import { logDuration, logError } from "../lib/logger.js";
import {
  processAndDispatchNotifications,
  type TTEventNotification,
} from "../lib/tt-notification-dispatcher.js";
import { tornApi } from "../services/torn-client.js";
import { executeSync } from "../lib/sync.js";

interface TTOwnershipChange {
  territory_id: string;
  old_faction_id: number | null;
  new_faction_id: number | null;
}

function normalizeFactionId(value: unknown): number | null {
  if (value === null || value === undefined) {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Calculate dynamic cadence based on number of available API keys
 * Current sync loop makes 2 API calls per run (ownership + rackets)
 * Torn API rate limit: 50 req/min per key (safety buffer from 100/min)
 * Formula: (2 requests × 60 seconds) / (numKeys × 50 req/min)
 *
 * Examples:
 * - 1 key: 2×60 / (1×50) = 3 seconds
 * - 2 keys: 2×60 / (2×50) = 2 seconds
 * - 4 keys: 2×60 / (4×50) = 1 second
 *
 * Dynamically counts actual system keys from database.
 * Min is clamped to 15s to avoid overly aggressive scheduling.
 */
async function calculateCadence(): Promise<number> {
  const requestsNeeded = 2; // ownership + rackets
  const limitPerKeyPerMin = 50; // Torn limit is 100, using 50 for safety

  // Count actual system keys available
  const apiKeys = await getAllSystemApiKeys("all");
  const numKeys = Math.max(1, apiKeys.length);

  // cadence = (requests needed × 60s) / (keys available × limit per key)
  const dynamicCadence = Math.ceil(
    (requestsNeeded * 60) / (numKeys * limitPerKeyPerMin),
  );

  // Clamp between 15s (minimum practical) and 120s (reasonable max)
  return Math.max(12, Math.min(120, dynamicCadence));
}

/**
 * Detect if worker is doing a catch-up sync (missed multiple sync cycles)
 * Returns true if last execution was more than 2x expected cadence ago
 */
async function isCatchUpSync(expectedCadenceSeconds: number): Promise<boolean> {
  // Get schedule info from sentinel_worker_schedules
  const { data: schedules } = await supabase
    .from("sentinel_worker_schedules")
    .select("last_run_at")
    .eq(
      "worker_id",
      (
        await supabase
          .from(TABLE_NAMES.WORKERS)
          .select("id")
          .eq("name", "territory_state_sync")
          .maybeSingle()
      ).data?.id,
    )
    .maybeSingle();

  if (!schedules?.last_run_at) {
    return false; // First run or no schedule state
  }

  const lastRunTime = new Date(schedules.last_run_at).getTime();
  const timeSinceLastRun = Date.now() - lastRunTime;
  const expectedInterval = expectedCadenceSeconds * 1000;
  const catchUpThreshold = expectedInterval * 2.5; // Allow 2.5x cadence as normal variance

  return timeSinceLastRun > catchUpThreshold;
}

/**
 * Determine ownership change event type
 */
function determineEventType(
  oldFaction: number | null,
  newFaction: number | null,
  activeWar: { assaulting_faction: number; defending_faction: number } | null,
): TTEventNotification["event_type"] {
  if (activeWar) {
    // War is active - determine outcome
    if (newFaction === activeWar.assaulting_faction) {
      return "assault_succeeded";
    } else if (newFaction === activeWar.defending_faction) {
      return "assault_failed";
    }
    // War active but neither faction owns it? Treat as claim
    return "claimed";
  }

  // No active war
  if (oldFaction !== null && newFaction === null) {
    return "dropped";
  }
  if (oldFaction === null && newFaction !== null) {
    return "claimed";
  }

  // Shouldn't reach here (no change), but default to claimed
  return "claimed";
}

/**
 * Check if guild should be notified about this TT change
 */
function _shouldNotifyGuild(
  config: {
    notification_type: string;
    territory_ids?: string[];
    faction_ids?: number[];
  },
  event: TTEventNotification,
): boolean {
  if (config.notification_type === "all") {
    return true;
  }

  if (config.notification_type === "territories" && config.territory_ids) {
    return config.territory_ids.includes(event.territory_id);
  }

  if (config.notification_type === "factions" && config.faction_ids) {
    // Notify if any relevant faction involved
    const relevantFactions = [
      event.occupying_faction,
      event.assaulting_faction,
      event.defending_faction,
    ].filter((f) => f !== undefined && f !== null);
    return relevantFactions.some((f) => config.faction_ids?.includes(f));
  }

  // Shouldn't reach here
  return false;
}

/**
 * Queue event notification for guild processing
 * Dispatches to bot webhook via HTTP for delivery to Discord
 */
async function queueGuildNotifications(
  _changes: TTOwnershipChange[],
  notifications: TTEventNotification[],
): Promise<void> {
  if (notifications.length === 0) {
    return;
  }

  // Fire notification dispatcher asynchronously without blocking sync
  // (processAndDispatchNotifications returns immediately, queues work internally)
  processAndDispatchNotifications(notifications);
}

export function startTerritoryStateSyncWorker() {
  return startDbScheduledRunner({
    worker: "territory_state_sync",
    defaultCadenceSeconds: 96, // Will be updated based on key count
    getDynamicCadence: calculateCadence,
    handler: async () => {
      await executeSync({
        name: "territory_state_sync",
        timeout: 180_000, // 3 minutes max (allows for rate limiting delays)
        handler: async () => {
          const startTime = Date.now();

          try {
            // Get system API key
            const apiKeys = await getAllSystemApiKeys("all");
            if (!apiKeys.length) {
              // Silently skip if no system key
              return;
            }

            // Get all territory IDs (with explicit limit to bypass default 1000-row limit)
            const { data: allTTs } = await supabase
              .from(TABLE_NAMES.TERRITORY_BLUEPRINT)
              .select("id")
              .order("id")
              .limit(5000); // Explicit limit - must be <= config.toml max_rows setting

            if (!allTTs || allTTs.length === 0) {
              logDuration(
                "territory_state_sync",
                "No territories in blueprint",
                Date.now() - startTime,
              );
              return;
            }

            const ttIds = allTTs.map((tt) => tt.id);

            // Check if this is initial seeding (avoid flooding channel with notifications)
            const { count: existingStates } = await supabase
              .from(TABLE_NAMES.TERRITORY_STATE)
              .select("*", { count: "exact", head: true });

            const isInitialSeeding =
              !existingStates || existingStates < ttIds.length * 0.05; // Less than 5% seeded

            // Check if worker is doing a catch-up sync (suppress notifications to avoid false positives)
            const cadence = await calculateCadence();
            const isCatchUp = await isCatchUpSync(cadence);

            if (isCatchUp) {
              logDuration(
                "territory_state_sync",
                `Catch-up sync detected (>2.5x cadence gap) - ownership notifications will be suppressed this run`,
                0,
              );
            }

            // Fetch territory ownership data using optimal pagination
            const changes: TTOwnershipChange[] = [];
            const notifications: TTEventNotification[] = [];

            // Use optimal pagination - check for empty array to stop
            let allOwnershipData = [];
            let offset = 0;
            let pageCount = 0;
            const limit = 500;

            while (true) {
              pageCount++;
              const response = await tornApi.get(
                "/faction/territoryownership",
                {
                  apiKey: apiKeys[0],
                  queryParams: { offset, limit },
                },
              );

              if ("error" in response) {
                const errorMsg =
                  typeof response.error === "object" &&
                  response.error &&
                  "error" in response.error
                    ? String(response.error.error)
                    : String(response.error);
                logError(
                  "territory_state_sync",
                  `API error fetching ownership page ${pageCount}: ${errorMsg}`,
                );
                throw new Error(errorMsg);
              }

              const territories = response.territoryOwnership || [];

              if (territories.length === 0) {
                break;
              }

              allOwnershipData.push(...territories);

              // If we got fewer results than the limit, we're done
              if (territories.length < limit) {
                break;
              }

              offset += limit;
            }

            // Fetch racket data from v1 API
            const racketResponse = await tornApi.getRaw<{
              rackets?: Record<
                string,
                {
                  name: string;
                  level: number;
                  reward: string;
                  created: number;
                  changed: number;
                  faction: number;
                }
              >;
              error?: { code: number; error: string };
            }>("/torn", apiKeys[0], { selections: "rackets" });

            if (racketResponse.error) {
              logError(
                "territory_state_sync",
                `Failed to fetch rackets: ${racketResponse.error.error}`,
              );
            }

            const racketsByTerritory = racketResponse.rackets || {};

            // Process ownership and racket data, detect all changes
            for (const tt of allOwnershipData) {
              const { data: currentState, error } = await supabase
                .from(TABLE_NAMES.TERRITORY_STATE)
                .select(
                  "faction_id, racket_name, racket_level, racket_created_at, racket_changed_at",
                )
                .eq("territory_id", tt.id)
                .single();

              const oldFaction = normalizeFactionId(currentState?.faction_id);
              const newFaction = normalizeFactionId(tt.owned_by);

              // Get racket data for this territory
              const racket = racketsByTerritory[tt.id];
              const oldRacketName = currentState?.racket_name ?? null;
              const oldRacketLevel = currentState?.racket_level ?? null;
              const newRacketName = racket?.name ?? null;
              const newRacketLevel = racket?.level ?? null;

              // Skip if there was an error other than "not found"
              if (error && error.code !== "PGRST116") {
                logError(
                  "territory_state_sync",
                  `Failed to fetch state for territory ${tt.id}: ${error.message}`,
                );
                continue;
              }

              // Detect ownership changes
              if (oldFaction !== newFaction) {
                changes.push({
                  territory_id: tt.id,
                  old_faction_id: oldFaction,
                  new_faction_id: newFaction,
                });

                // Check for active war to determine event type
                const { data: activeWar } = await supabase
                  .from(TABLE_NAMES.WAR_LEDGER)
                  .select("assaulting_faction,defending_faction,start_time")
                  .eq("territory_id", tt.id)
                  .is("end_time", null)
                  .single();

                const eventType = determineEventType(
                  oldFaction,
                  newFaction,
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  activeWar as any,
                );

                // Calculate war duration if war is active
                let warDurationHours: number | undefined;
                if (
                  activeWar &&
                  (eventType === "assault_succeeded" ||
                    eventType === "assault_failed")
                ) {
                  const warStartTime = new Date(activeWar.start_time);
                  const now = new Date();
                  warDurationHours =
                    (now.getTime() - warStartTime.getTime()) / (1000 * 60 * 60);
                }

                notifications.push({
                  guild_id: "",
                  territory_id: tt.id,
                  event_type: eventType,
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  assaulting_faction: (activeWar as any)?.assaulting_faction,
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  defending_faction: (activeWar as any)?.defending_faction,
                  occupying_faction: newFaction,
                  previous_faction:
                    eventType === "dropped" ? oldFaction : undefined,
                  war_duration_hours: warDurationHours,
                });
              }

              // Detect racket changes
              if (
                oldRacketName !== newRacketName ||
                oldRacketLevel !== newRacketLevel
              ) {
                // Racket spawned
                if (!oldRacketName && newRacketName) {
                  notifications.push({
                    guild_id: "",
                    territory_id: tt.id,
                    event_type: "racket_spawned",
                    occupying_faction: newFaction,
                    racket_name: newRacketName,
                    racket_new_level: newRacketLevel,
                  });
                }
                // Racket despawned
                else if (oldRacketName && !newRacketName) {
                  notifications.push({
                    guild_id: "",
                    territory_id: tt.id,
                    event_type: "racket_despawned",
                    occupying_faction: oldFaction,
                    racket_name: oldRacketName,
                    racket_old_level: oldRacketLevel,
                  });
                }
                // Racket level changed
                else if (
                  oldRacketName === newRacketName &&
                  oldRacketLevel !== newRacketLevel
                ) {
                  notifications.push({
                    guild_id: "",
                    territory_id: tt.id,
                    event_type: "racket_level_changed",
                    occupying_faction: newFaction,
                    racket_name: newRacketName,
                    racket_old_level: oldRacketLevel,
                    racket_new_level: newRacketLevel,
                  });
                }
              }
            }

            // Update database with ownership and racket changes
            if (
              changes.length > 0 ||
              Object.keys(racketsByTerritory).length > 0
            ) {
              // Collect all territories that need updates
              const territoriesToUpdate = new Set<string>();

              changes.forEach((c) => territoriesToUpdate.add(c.territory_id));
              allOwnershipData.forEach((tt) => territoriesToUpdate.add(tt.id));

              const stateUpdates = Array.from(territoriesToUpdate).map(
                (territoryId) => {
                  const ownershipData = allOwnershipData.find(
                    (t) => t.id === territoryId,
                  );
                  const racketData = racketsByTerritory[territoryId];

                  return {
                    territory_id: territoryId,
                    faction_id: normalizeFactionId(ownershipData?.owned_by),
                    racket_name: racketData?.name ?? null,
                    racket_level: racketData?.level ?? null,
                    racket_reward: racketData?.reward ?? null,
                    racket_created_at: racketData?.created ?? null,
                    racket_changed_at: racketData?.changed ?? null,
                  };
                },
              );

              const { error: updateError } = await supabase
                .from(TABLE_NAMES.TERRITORY_STATE)
                .upsert(stateUpdates, { onConflict: "territory_id" });

              if (updateError) {
                logError(
                  "territory_state_sync",
                  `Failed to update territory states: ${updateError.message}`,
                );
                throw updateError;
              }

              // Queue guild notifications
              // Skip if: initial seeding OR catch-up sync detected (to avoid false positives)
              if (!isInitialSeeding && !isCatchUp && notifications.length > 0) {
                await queueGuildNotifications(changes, notifications);
              }

              // If catch-up sync, log suppressed notification count
              if (isCatchUp && notifications.length > 0) {
                const suppressed = notifications.filter((n) =>
                  [
                    "assault_succeeded",
                    "assault_failed",
                    "dropped",
                    "claimed",
                  ].includes(n.event_type),
                ).length;
                if (suppressed > 0) {
                  logDuration(
                    "territory_state_sync",
                    `Suppressed ${suppressed} ownership change notification(s) during catch-up`,
                    0,
                  );
                }
              }
            }

            const ownershipChanges = notifications.filter((n) =>
              [
                "assault_succeeded",
                "assault_failed",
                "dropped",
                "claimed",
              ].includes(n.event_type),
            ).length;
            const racketChanges = notifications.filter((n) =>
              [
                "racket_spawned",
                "racket_despawned",
                "racket_level_changed",
              ].includes(n.event_type),
            ).length;

            const duration = Date.now() - startTime;
            logDuration(
              "territory_state_sync",
              `Sync completed for ${allOwnershipData.length} territories (${ownershipChanges} ownership, ${racketChanges} racket changes)`,
              duration,
            );
          } catch (error) {
            const message =
              error instanceof Error ? error.message : String(error);
            logError("territory_state_sync", `Failed: ${message}`);
            throw error; // Re-throw so executeSync knows this failed
          }
        },
      });
    },
  });
}
