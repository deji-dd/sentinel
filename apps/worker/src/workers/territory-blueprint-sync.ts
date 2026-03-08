/**
 * Territory blueprint sync worker
 * Runs once daily to populate sentinel_territory_blueprint with all territory data
 * On first run, also initializes sentinel_territory_state with faction_id = null
 *
 * Uses system API key (single request gets all territories)
 */

import { TABLE_NAMES, ApiKeyRotator } from "@sentinel/shared";
import { startDbScheduledRunner } from "../lib/scheduler.js";
import { getAllSystemApiKeys } from "../lib/api-keys.js";
import { logDuration, logError } from "../lib/logger.js";
import { tornApi } from "../services/torn-client.js";
import { getKysely } from "@sentinel/shared/db/sqlite.js";

export function startTerritoryBlueprintSyncWorker() {
  return startDbScheduledRunner({
    worker: "territory_blueprint_sync",
    defaultCadenceSeconds: 86400, // Once daily (24 hours)
    handler: async () => {
      const startTime = Date.now();
      const db = getKysely();

      try {
        // Get system API keys and initialize rotator for load balancing
        const apiKeys = await getAllSystemApiKeys("system");
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
        const existingCountRow = await db
          .selectFrom(TABLE_NAMES.TERRITORY_BLUEPRINT)
          .select((eb) => eb.fn.count("id").as("count"))
          .executeTakeFirst();

        const isFirstRun = Number(existingCountRow?.count ?? 0) === 0;

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
          neighbors: JSON.stringify(tt.neighbors || []),
          updated_at: new Date().toISOString(),
        }));

        try {
          await db.transaction().execute(async (trx) => {
            for (const row of blueprintData) {
              await trx
                .insertInto(TABLE_NAMES.TERRITORY_BLUEPRINT)
                .values(row)
                .onConflict((oc) =>
                  oc.column("id").doUpdateSet({
                    sector: row.sector,
                    size: row.size,
                    density: row.density,
                    slots: row.slots,
                    respect: row.respect,
                    coordinate_x: row.coordinate_x,
                    coordinate_y: row.coordinate_y,
                    neighbors: row.neighbors,
                    updated_at: row.updated_at,
                  }),
                )
                .execute();
            }
          });
        } catch (error) {
          logError(
            "territory_blueprint_sync",
            `Failed to upsert blueprints: ${error instanceof Error ? error.message : String(error)}`,
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

          try {
            await db.transaction().execute(async (trx) => {
              for (const row of stateData) {
                await trx
                  .insertInto(TABLE_NAMES.TERRITORY_STATE)
                  .values({
                    territory_id: row.territory_id,
                    faction_id: row.faction_id,
                    is_warring: row.is_warring ? 1 : 0,
                  })
                  .execute();
              }
            });
          } catch (error) {
            logError(
              "territory_blueprint_sync",
              `Failed to initialize territory states: ${error instanceof Error ? error.message : String(error)}`,
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
