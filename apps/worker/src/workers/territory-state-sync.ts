/**
 * Territory state sync worker
 * Runs with dynamic cadence based on number of available API keys
 * Fetches territory ownership data and syncs to DB
 * Triggers resolution handshake when ownership changes
 *
 * Uses system API key only (distributed across multiple /torn/territory calls)
 */

import { TABLE_NAMES } from "@sentinel/shared";
import { startDbScheduledRunner } from "../lib/scheduler.js";
import { supabase } from "../lib/supabase.js";
import { getAllSystemApiKeys } from "../lib/api-keys.js";
import { logDuration, logError } from "../lib/logger.js";
import { processAndDispatchNotifications } from "../lib/tt-notification-dispatcher.js";
import { batchHandler } from "../services/torn-client.js";
import { executeSync } from "../lib/sync.js";

interface TTOwnershipChange {
  territory_id: string;
  old_faction_id: number | null;
  new_faction_id: number | null;
}

interface TTEventNotification {
  guild_id: string;
  territory_id: string;
  event_type: "assault_succeeded" | "assault_failed" | "dropped" | "claimed";
  assaulting_faction?: number;
  defending_faction?: number;
  occupying_faction: number | null;
}

/**
 * Calculate dynamic cadence based on number of available API keys
 * ~4000 territories, max 50 per request = 80 requests
 * Torn API rate limit: 50 req/min per key (safety buffer from 100/min)
 * Formula: (80 requests × 60 seconds) / (numKeys × 50 req/min)
 *
 * Examples:
 * - 1 key: 80×60 / (1×50) = 96 seconds
 * - 2 keys: 80×60 / (2×50) = 48 seconds
 * - 4 keys: 80×60 / (4×50) = 24 seconds
 *
 * Dynamically counts actual system keys from database.
 * Min: 24s (4+ keys), Max: 96s (with just system key)
 */
async function calculateCadence(): Promise<number> {
  const requestsNeeded = 80; // ~4000 territories / 50 per batch
  const limitPerKeyPerMin = 50; // Torn limit is 100, using 50 for safety

  // Count actual system keys available
  const apiKeys = await getAllSystemApiKeys("all");
  const numKeys = Math.max(1, apiKeys.length);

  // cadence = (requests needed × 60s) / (keys available × limit per key)
  const dynamicCadence = Math.ceil(
    (requestsNeeded * 60) / (numKeys * limitPerKeyPerMin),
  );

  // Clamp between 24s (minimum practical) and 120s (reasonable max)
  return Math.max(24, Math.min(120, dynamicCadence));
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

  // Use notification dispatcher to send via bot webhook
  await processAndDispatchNotifications(notifications);
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

            // Batch territories for fetching (max 50 per request)
            const batchSize = 50;
            const changes: TTOwnershipChange[] = [];
            const notifications: TTEventNotification[] = [];

            // Create batch requests for the handler
            const batchRequests = [];
            for (let i = 0; i < ttIds.length; i += batchSize) {
              const batch = ttIds.slice(i, i + batchSize);
              batchRequests.push({
                id: `batch-${Math.floor(i / batchSize)}`,
                item: { ids: batch },
              });
            }

            // Execute batches using the batch handler (handles rate limiting)
            const results = await batchHandler.executeBatch(
              batchRequests,
              apiKeys,
              async (item: { ids: number[] }, key: string) => {
                const response =
                  await import("../services/torn-client.js").then((m) =>
                    m.tornApi.get("/torn/territory", {
                      apiKey: key,
                      queryParams: { ids: item.ids },
                    }),
                  );
                return response;
              },
              {
                concurrent: apiKeys.length > 1,
                delayMs: 0, // Rate limiter handles delays
                retryAttempts: 2,
              },
            );

            // Process results
            for (const batchResult of results) {
              if (!batchResult || !batchResult.success || !batchResult.result) {
                if (batchResult?.error) {
                  logError(
                    "territory_state_sync",
                    `Failed batch ${batchResult.requestId}: ${batchResult.error.message}`,
                  );
                } else if (!batchResult) {
                  logError(
                    "territory_state_sync",
                    "Received undefined batch result from handler",
                  );
                }
                continue;
              }

              const data = batchResult.result;
              if ("error" in data) {
                // API error response
                continue;
              }

              const territories = data.territory || [];

              // Compare with DB and detect changes
              for (const tt of territories) {
                const { data: currentState, error } = await supabase
                  .from(TABLE_NAMES.TERRITORY_STATE)
                  .select("faction_id")
                  .eq("territory_id", tt.id)
                  .single();

                // If row doesn't exist, treat as new territory (null -> occupied_by)
                const oldFaction = currentState?.faction_id ?? null;
                const newFaction =
                  tt.occupied_by === null || tt.occupied_by === undefined
                    ? null
                    : Number(tt.occupied_by);

                // Skip if no change
                if (oldFaction === newFaction) {
                  continue;
                }

                // Skip if there was an error other than "not found"
                if (error && error.code !== "PGRST116") {
                  logError(
                    "territory_state_sync",
                    `Failed to fetch state for territory ${tt.id}: ${error.message}`,
                  );
                  continue;
                }

                changes.push({
                  territory_id: tt.id,
                  old_faction_id: oldFaction,
                  new_faction_id: newFaction,
                });

                // Check for active war to determine event type
                const { data: activeWar } = await supabase
                  .from(TABLE_NAMES.WAR_LEDGER)
                  .select("assaulting_faction,defending_faction")
                  .eq("territory_id", tt.id)
                  .is("end_time", null)
                  .single();

                const eventType = determineEventType(
                  oldFaction,
                  newFaction,
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  activeWar as any,
                );

                notifications.push({
                  guild_id: "", // Will be filled in queueGuildNotifications
                  territory_id: tt.id,
                  event_type: eventType,
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  assaulting_faction: (activeWar as any)?.assaulting_faction,
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  defending_faction: (activeWar as any)?.defending_faction,
                  occupying_faction: newFaction,
                });
              }
            }

            if (changes.length > 0) {
              // Bulk update territory states
              const stateUpdates = changes.map((change) => ({
                territory_id: change.territory_id,
                faction_id: change.new_faction_id,
              }));

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

              // Queue guild notifications (skip during initial seeding to avoid channel flood)
              if (!isInitialSeeding) {
                await queueGuildNotifications(changes, notifications);
              }
            }

            const duration = Date.now() - startTime;
            logDuration(
              "territory_state_sync",
              `Sync completed for ${ttIds.length} territories (${changes.length} changes)`,
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
