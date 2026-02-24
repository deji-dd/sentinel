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

        // Create API client
        const tornApi = new TornApiClient({});

        // Fetch all territories with pagination support
        const allTerritories = [];
        let nextUrl: string | null = null;
        let offset = 0;
        let pageCount = 0;

        do {
          pageCount++;
          const response = await tornApi.get("/torn/territory", {
            apiKey,
            queryParams: { offset },
          });

          if ("error" in response) {
            const errorMsg =
              typeof response.error === "object" &&
              response.error &&
              "error" in response.error
                ? String(response.error.error)
                : String(response.error);
            logError(
              "territory_blueprint_sync",
              `API error on page ${pageCount}: ${errorMsg}`,
            );
            return false;
          }

          const territories = response.territory;
          const metadata = response._metadata;

          if (!territories || territories.length === 0) {
            break;
          }

          allTerritories.push(...territories);

          // Check for next page
          nextUrl = metadata?.links?.next || null;
          if (nextUrl) {
            // Extract offset from next URL
            const nextUrlObj = new URL(nextUrl);
            const nextOffset = nextUrlObj.searchParams.get("offset");
            offset = nextOffset ? parseInt(nextOffset) : offset + 250;
          }
        } while (nextUrl);

        const territories = allTerritories;

        if (!territories || territories.length === 0) {
          logDuration(
            "territory_blueprint_sync",
            "No territories returned",
            Date.now() - startTime,
          );
          return true;
        }

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

        // On first run, initialize territory states with faction_id = null
        if (isFirstRun) {
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
        }

        const duration = Date.now() - startTime;
        logDuration(
          "territory_blueprint_sync",
          `Sync completed for ${territories.length} territories`,
          duration,
        );

        return true;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logError("territory_blueprint_sync", `Failed: ${message}`);
        return false;
      }
    },
  });
}
