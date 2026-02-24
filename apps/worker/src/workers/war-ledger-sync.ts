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
  war_id: number;
  territory_id: string;
  assaulting_faction: number;
  defending_faction: number;
  start: number;
  end: number | null;
  winner: number | null;
}

interface TornV1TerritorywarsResponse {
  territorywars: TerritoryWar[];
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
        const wars = data.territorywars || [];

        if (wars.length === 0) {
          logDuration(
            "war_ledger_sync",
            "No active wars",
            Date.now() - startTime,
          );
          return true;
        }

        console.log(`[War Ledger Sync] Processing ${wars.length} wars`);

        // Separate into new wars and ended wars
        const { data: existingWars } = await supabase
          .from(TABLE_NAMES.WAR_LEDGER)
          .select("war_id")
          .in(
            "war_id",
            wars.map((w) => w.war_id),
          );

        const existingWarIds = new Set(
          (existingWars || []).map((w) => w.war_id),
        );
        const newWars = wars.filter((w) => !existingWarIds.has(w.war_id));
        const updatedWars = wars.filter((w) => existingWarIds.has(w.war_id));

        // Upsert war data (new wars will have end_time and victor_faction as null)
        const warData = wars.map((w) => ({
          war_id: w.war_id,
          territory_id: w.territory_id,
          assaulting_faction: w.assaulting_faction,
          defending_faction: w.defending_faction,
          victor_faction: w.winner,
          start_time: new Date(w.start * 1000).toISOString(),
          end_time: w.end ? new Date(w.end * 1000).toISOString() : null,
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
        const warringTerritories = wars.map((w) => w.territory_id);

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
          `Processed ${wars.length} wars`,
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
