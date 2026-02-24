/**
 * War ledger sync worker
 * Runs every 15 seconds to fetch territory wars from v1 API
 * Upserts new wars and sets is_warring = true on affected territories
 *
 * Uses system API key via v1 API /torn endpoint
 */

import { TABLE_NAMES } from "@sentinel/shared";
import { startDbScheduledRunner } from "../lib/scheduler.js";
import { supabase } from "../lib/supabase.js";
import { getAllSystemApiKeys } from "../lib/api-keys.js";
import { logDuration, logError } from "../lib/logger.js";
import { tornApi } from "../services/torn-client.js";
import { executeSync } from "../lib/sync.js";

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

export function startWarLedgerSyncWorker() {
  return startDbScheduledRunner({
    worker: "war_ledger_sync",
    defaultCadenceSeconds: 5, // Every 5 seconds for real-time war precision
    handler: async () => {
      return await executeSync({
        name: "war_ledger_sync",
        timeout: 60_000, // 1 minute max
        handler: async () => {
          const startTime = Date.now();

          try {
            // Get system API key
            const apiKeys = await getAllSystemApiKeys("all");
            const apiKey = apiKeys[0];
            if (!apiKey) {
              // Silently skip if no API key
              return;
            }

            // Fetch territory wars from v1 API using shared client with rate limiting
            const response = await tornApi.getRaw("/torn", apiKey, {
              selections: "territorywars",
            });

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
            const { data: existingWars } = await supabase
              .from(TABLE_NAMES.WAR_LEDGER)
              .select("war_id")
              .in(
                "war_id",
                validWars.map((w) => w.territory_war_id),
              );

            const existingWarIds = new Set(
              (existingWars || []).map((w) => w.war_id),
            );
            const _newWars = validWars.filter(
              (w) => !existingWarIds.has(w.territory_war_id),
            );
            const _updatedWars = validWars.filter((w) =>
              existingWarIds.has(w.territory_war_id),
            );

            // Upsert war data
            const warData = validWars.map((w) => ({
              war_id: w.territory_war_id,
              territory_id: w.territory_id,
              assaulting_faction: w.assaulting_faction,
              defending_faction: w.defending_faction,
              victor_faction: null, // v1 API doesn't provide victor info, set via state change detection
              start_time: new Date(w.started * 1000).toISOString(),
              end_time: new Date(w.ends * 1000).toISOString(), // v1 API provides end time immediately
            }));

            const { error: upsertError } = await supabase
              .from(TABLE_NAMES.WAR_LEDGER)
              .upsert(warData, { onConflict: "war_id" });

            if (upsertError) {
              logError(
                "war_ledger_sync",
                `Failed to upsert wars: ${upsertError.message}`,
              );
              throw upsertError;
            }

            // Update territory states to mark as warring
            // First, ensure all territory states exist (create if missing)
            const warringTerritories = validWars.map((w) => w.territory_id);

            const { error: insertError } = await supabase
              .from(TABLE_NAMES.TERRITORY_STATE)
              .upsert(
                warringTerritories.map((tid) => ({
                  territory_id: tid,
                  faction_id: null,
                  is_warring: true,
                })),
                { onConflict: "territory_id" },
              );

            if (insertError) {
              logError(
                "war_ledger_sync",
                `Failed to upsert territory states: ${insertError.message}`,
              );
              // Don't return false - this shouldn't block war ledger updates
            } else {
              // Now update remaining territories to is_warring = true
              const { error: stateError } = await supabase
                .from(TABLE_NAMES.TERRITORY_STATE)
                .update({ is_warring: true })
                .in("territory_id", warringTerritories);

              if (stateError) {
                logError(
                  "war_ledger_sync",
                  `Failed to update territory state: ${stateError.message}`,
                );
                // Don't return false - DB update failure shouldn't prevent ledger update
              }
            }

            const duration = Date.now() - startTime;
            logDuration(
              "war_ledger_sync",
              `Sync completed for ${validWars.length} wars`,
              duration,
            );
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
