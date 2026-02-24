/**
 * Territory state sync worker
 * Runs with dynamic cadence based on number of available API keys
 * Fetches territory ownership data and syncs to DB
 * Triggers resolution handshake when ownership changes
 *
 * Uses system API key only (distributed across multiple /torn/territory calls)
 */

import { TABLE_NAMES, TornApiClient } from "@sentinel/shared";
import { startDbScheduledRunner } from "../lib/scheduler.js";
import { supabase, getPersonalApiKey } from "../lib/supabase.js";
import { logDuration, logError } from "../lib/logger.js";
import {
  processAndDispatchNotifications,
} from "../lib/tt-notification-dispatcher.js";

interface TornTerritory {
  id: string;
  occupied_by: number | null;
  acquired_at: number | null;
}

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
 * Note: Currently uses system key only. If/when guild keys are pooled,
 * this can be updated to read from database.
 * 
 * Min: 24s (4+ keys), Max: 96s (with just system key)
 */
function calculateCadence(): number {
  // Currently system key only: 80 requests × 60 / (1 × 50) = 96 seconds
  // This can be made dynamic later if we pool guild keys
  const requestsNeeded = 80; // ~4000 territories / 50 per batch
  const limitPerKeyPerMin = 50; // Torn limit is 100, using 50 for safety
  const numKeys = 1; // System key only for TT sync
  
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
function shouldNotifyGuild(
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
    defaultCadenceSeconds: calculateCadence(), // Dynamic based on available keys
    handler: async () => {
      const startTime = Date.now();

      try {
        // Get system API key
        const apiKey = getPersonalApiKey();
        if (!apiKey) {
          // Silently skip if no system key
          return true;
        }

        // Get all territory IDs
        const { data: allTTs } = await supabase
          .from(TABLE_NAMES.TERRITORY_BLUEPRINT)
          .select("id")
          .order("id");

        if (!allTTs || allTTs.length === 0) {
          console.warn("[Territory State Sync] No territories in blueprint");
          return true;
        }

        const ttIds = allTTs.map((tt) => tt.id);
        console.log(
          `[Territory State Sync] Syncing ${ttIds.length} territories in batches of 50`,
        );

        // Create API client
        const tornApi = new TornApiClient({});

        // Fetch territories in batches of max 50 per request
        const batchSize = 50;
        const changes: TTOwnershipChange[] = [];
        const notifications: TTEventNotification[] = [];

        for (let i = 0; i < ttIds.length; i += batchSize) {
          const batch = ttIds.slice(i, i + batchSize);

          try {
            const response = await tornApi.get("/torn/territory", {
              apiKey,
              queryParams: {
                ids: batch,
              },
            });

            if ("error" in response) {
              console.warn(
                `[Territory State Sync] API error fetching batch at index ${i}: ${(response as any).error.error}`,
              );
              continue;
            }

            const data = response as unknown as { territory: TornTerritory[] };
            const territories = data.territory || [];

            // Compare with DB and detect changes
            for (const tt of territories) {
              const { data: currentState } = await supabase
                .from(TABLE_NAMES.TERRITORY_STATE)
                .select("faction_id")
                .eq("territory_id", tt.id)
                .single();

              const oldFaction = currentState?.faction_id;
              const newFaction = tt.occupied_by;

              // Skip if no change
              if (oldFaction === newFaction) {
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
                activeWar as any,
              );

              notifications.push({
                guild_id: "", // Will be filled in queueGuildNotifications
                territory_id: tt.id,
                event_type: eventType,
                assaulting_faction: (activeWar as any)?.assaulting_faction,
                defending_faction: (activeWar as any)?.defending_faction,
                occupying_faction: newFaction,
              });
            }
          } catch (error) {
            console.error(
              `[Territory State Sync] Error processing batch at index ${i}:`,
              error,
            );
          }
        }

        if (changes.length > 0) {
          console.log(
            `[Territory State Sync] Detected ${changes.length} ownership changes`,
          );

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
            return false;
          }

          // Queue guild notifications
          await queueGuildNotifications(changes, notifications);
        }

        const duration = Date.now() - startTime;
        console.log(
          `[Territory State Sync] Completed: ${changes.length}/${ttIds.length} changes in ${duration}ms`,
        );
        logDuration(
          "territory_state_sync",
          `Synced ${ttIds.length} territories, ${changes.length} changes`,
          duration,
        );

        return true;
      } catch (error) {
        const duration = Date.now() - startTime;
        const message = error instanceof Error ? error.message : String(error);
        console.error("[Territory State Sync] Worker error:", error);
        logError("territory_state_sync", `Failed: ${message}`);
        logDuration("territory_state_sync", `Error: ${message}`, duration);
        return false;
      }
    },
  });
}
