/**
 * War ledger sync worker
 * Runs every 15 seconds to fetch territory wars from v1 API
 * Upserts new wars and sets is_warring = true on affected territories
 *
 * Uses system API key via v1 API /torn endpoint
 */

import { TABLE_NAMES, TornApiClient } from "@sentinel/shared";
import { startDbScheduledRunner } from "../lib/scheduler.js";
import { supabase, getPersonalApiKey } from "../lib/supabase.js";
import { logDuration, logError } from "../lib/logger.js";

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
    defaultCadenceSeconds: 15, // Every 15 seconds for real-time war tracking
    handler: async () => {
      const startTime = Date.now();

      try {
        // Get system API key
        const apiKey = getPersonalApiKey();
        if (!apiKey) {
          // Silently return - this is high frequency
          return false;
        }

        // Create API client
        const tornApi = new TornApiClient({});

        // Fetch territory wars from v1 API
        const response = await tornApi.getRaw("/torn", apiKey, {
          selections: "territorywars",
        });

        if ("error" in response) {
          // Silently skip on error for high-frequency worker
          return false;
        }

        const data = response as unknown as TornV1TerritorywarsResponse;
        const warEntries = Object.entries(data.territorywars || {});

        if (warEntries.length === 0) {
          logDuration(
            "war_ledger_sync",
            "No active wars",
            Date.now() - startTime,
          );
          return true;
        }

        console.log(`[War Ledger Sync] Processing ${warEntries.length} wars`);

        // Transform to array with territory code included
        const wars: Array<TerritoryWar & { territory_id: string }> =
          warEntries.map(([territoryCode, war]) => ({
            ...war,
            territory_id: territoryCode,
          }));

        // Check which territories exist in blueprint (handle new territories)
        const { data: existingBlueprints } = await supabase
          .from(TABLE_NAMES.TERRITORY_BLUEPRINT)
          .select("territory_id")
          .in(
            "territory_id",
            wars.map((w) => w.territory_id),
          );

        const existingTerritoryIds = new Set(
          (existingBlueprints || []).map((b) => b.territory_id),
        );
        const validWars = wars.filter((w) =>
          existingTerritoryIds.has(w.territory_id),
        );
        const orphanedWars = wars.filter(
          (w) => !existingTerritoryIds.has(w.territory_id),
        );

        if (orphanedWars.length > 0) {
          console.warn(
            `[War Ledger Sync] Skipping ${orphanedWars.length} wars for non-existent territories: ${orphanedWars.map((w) => w.territory_id).join(", ")}`,
          );
        }

        if (validWars.length === 0) {
          logDuration(
            "war_ledger_sync",
            "No valid wars (blueprints not synced)",
            Date.now() - startTime,
          );
          return true;
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
        const newWars = validWars.filter(
          (w) => !existingWarIds.has(w.territory_war_id),
        );
        const updatedWars = validWars.filter((w) =>
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
          console.warn(
            `[War Ledger Sync] Failed to upsert wars: ${upsertError.message}`,
          );
          return false;
        }

        // Update territory states to mark as warring
        const warringTerritories = validWars.map((w) => w.territory_id);

        const { error: stateError } = await supabase
          .from(TABLE_NAMES.TERRITORY_STATE)
          .update({ is_warring: true })
          .in("territory_id", warringTerritories);

        if (stateError) {
          console.warn(
            `[War Ledger Sync] Failed to update territory state: ${stateError.message}`,
          );
          // Don't return false - DB update failure shouldn't prevent ledger update
        }

        if (newWars.length > 0) {
          console.log(
            `[War Ledger Sync] Found ${newWars.length} new wars, ${updatedWars.length} updated`,
          );
        }

        const duration = Date.now() - startTime;
        logDuration(
          "war_ledger_sync",
          `Processed ${validWars.length} wars`,
          duration,
        );

        return true;
      } catch (error) {
        const duration = Date.now() - startTime;
        console.error("[War Ledger Sync] Worker error:", error);
        logDuration(
          "war_ledger_sync",
          `Error: ${error instanceof Error ? error.message : String(error)}`,
          duration,
        );
        return false;
      }
    },
  });
}
