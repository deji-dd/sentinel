/**
 * Territory blueprint sync worker
 * Runs once daily to populate sentinel_territory_blueprint with all territory data
 * On first run, also initializes sentinel_territory_state with faction_id = null
 *
 * Uses system API key (single request gets all territories)
 */

import { TABLE_NAMES, TornApiClient } from "@sentinel/shared";
import { startDbScheduledRunner } from "../lib/scheduler.js";
import { supabase, getPersonalApiKey } from "../lib/supabase.js";
import { logDuration, logError } from "../lib/logger.js";

interface TornTerritory {
  id: string;
  sector: number;
  size: number;
  density: number;
  slots: number;
  respect: number;
  coordinates: { x: number; y: number };
  neighbors: string[];
}

export function startTerritoryBlueprintSyncWorker() {
  return startDbScheduledRunner({
    worker: "territory_blueprint_sync",
    defaultCadenceSeconds: 86400, // Once daily (24 hours)
    handler: async () => {
      const startTime = Date.now();

      try {
        // Get system API key
        const apiKey = getPersonalApiKey();
        if (!apiKey) {
          logError("territory_blueprint_sync", "No system API key available");
          return false;
        }

        console.log("[Territory Blueprint Sync] Fetching all territories...");

        // Create API client
        const tornApi = new TornApiClient({});

        // Fetch all territories from /torn/territory
        const response = await tornApi.get("/torn/territory", {
          apiKey,
          queryParams: { offset: 0 },
        });

        if ("error" in response) {
          logError(
            "territory_blueprint_sync",
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            `API error: ${(response as any).error.error}`,
          );
          return false;
        }

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const territories = (response as any).territory as TornTerritory[];

        if (!territories || territories.length === 0) {
          console.warn("[Territory Blueprint Sync] No territories returned");
          return true;
        }

        console.log(
          `[Territory Blueprint Sync] Fetched ${territories.length} territories`,
        );

        // Check if this is first run (no blueprints exist yet)
        const { count: existingCount } = await supabase
          .from(TABLE_NAMES.TERRITORY_BLUEPRINT)
          .select("id", { count: "exact" })
          .limit(1);

        const isFirstRun = (existingCount ?? 0) === 0;

        // Prepare upsert data for blueprints
        const blueprintData = territories.map((tt) => ({
          id: tt.id,
          sector: tt.sector,
          size: tt.size,
          density: tt.density,
          slots: tt.slots,
          respect: tt.respect,
          coordinate_x: tt.coordinates.x,
          coordinate_y: tt.coordinates.y,
          neighbors: tt.neighbors,
          updated_at: new Date().toISOString(),
        }));

        // Upsert blueprints
        const { error: blueprintError, count: _blueprintCount } = await supabase
          .from(TABLE_NAMES.TERRITORY_BLUEPRINT)
          .upsert(blueprintData, { onConflict: "id" });

        if (blueprintError) {
          logError(
            "territory_blueprint_sync",
            `Failed to upsert blueprints: ${blueprintError.message}`,
          );
          return false;
        }

        console.log(
          `[Territory Blueprint Sync] Upserted ${blueprintData.length} blueprints`,
        );

        // On first run, initialize territory states with faction_id = null
        if (isFirstRun) {
          console.log(
            "[Territory Blueprint Sync] First run detected - initializing territory states",
          );

          const stateData = territories.map((tt) => ({
            territory_id: tt.id,
            faction_id: null,
            is_warring: false,
          }));

          const { error: stateError } = await supabase
            .from(TABLE_NAMES.TERRITORY_STATE)
            .insert(stateData);

          if (stateError) {
            logError(
              "territory_blueprint_sync",
              `Failed to initialize territory states: ${stateError.message}`,
            );
            return false;
          }

          console.log(
            `[Territory Blueprint Sync] Initialized ${stateData.length} territory states`,
          );
        }

        const duration = Date.now() - startTime;
        console.log(
          `[Territory Blueprint Sync] Completed successfully in ${duration}ms`,
        );
        logDuration(
          "territory_blueprint_sync",
          `Synced ${territories.length} blueprints`,
          duration,
        );

        return true;
      } catch (error) {
        const duration = Date.now() - startTime;
        const message = error instanceof Error ? error.message : String(error);
        console.error("[Territory Blueprint Sync] Worker error:", error);
        logError("territory_blueprint_sync", `Failed: ${message}`);
        logDuration("territory_blueprint_sync", `Error: ${message}`, duration);
        return false;
      }
    },
  });
}
