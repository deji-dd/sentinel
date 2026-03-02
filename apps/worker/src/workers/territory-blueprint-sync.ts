/**
 * Territory blueprint sync worker
 * Runs once daily to populate sentinel_territory_blueprint with all territory data
 * On first run, also initializes sentinel_territory_state with faction_id = null
 *
 * Uses system API key (single request gets all territories)
 */

import { TABLE_NAMES, ApiKeyRotator } from "@sentinel/shared";
import { startDbScheduledRunner } from "../lib/scheduler.js";
import { supabase } from "../lib/supabase.js";
import { getAllSystemApiKeys } from "../lib/api-keys.js";
import { logDuration, logError } from "../lib/logger.js";
import { tornApi } from "../services/torn-client.js";

export function startTerritoryBlueprintSyncWorker() {
  return startDbScheduledRunner({
    worker: "territory_blueprint_sync",
    defaultCadenceSeconds: 86400, // Once daily (24 hours)
    handler: async () => {
      const startTime = Date.now();

      try {
        // Get system API keys and initialize rotator for load balancing
        const apiKeys = await getAllSystemApiKeys("all");
        if (!apiKeys.length) {
          logError("territory_blueprint_sync", "No system API key available");
          return false;
        }

        // Create API key rotator to distribute requests across all available keys
        const keyRotator = new ApiKeyRotator(apiKeys);

        // OPTIMIZATION: Parallel pagination instead of sequential
        // Fetch first page to determine total count
        const firstResponse = await tornApi.get("/torn/territory", {
          apiKey: keyRotator.getNextKey(),
          queryParams: { offset: 0, limit: 250 },
        });

        const allTerritories = [...(firstResponse.territory || [])];

        // Calculate remaining pages (we know there are ~4100+ territories)
        // Estimate based on first page: if we got 250, there are likely more pages
        const limit = 250;
        const firstPageSize = allTerritories.length;

        // If we got a full page, assume there are more territories
        // Use a safe estimate of ~4200 total territories (actual is ~4108)
        if (firstPageSize >= limit) {
          const estimatedTotal = 4200;
          const pageCount = Math.ceil(estimatedTotal / limit);

          // Generate offsets for remaining pages
          const remainingOffsets = Array.from(
            { length: pageCount - 1 },
            (_, i) => (i + 1) * limit,
          );

          // Fetch all remaining pages in parallel
          const remainingResponses = await Promise.all(
            remainingOffsets.map((offset) =>
              tornApi.get("/torn/territory", {
                apiKey: keyRotator.getNextKey(),
                queryParams: { offset, limit },
              }),
            ),
          );

          // Combine all remaining territories (filter out empty responses)
          for (const response of remainingResponses) {
            if (response.territory && response.territory.length > 0) {
              allTerritories.push(...response.territory);
            }
          }
        }

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
