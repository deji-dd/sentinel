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

const DB_WRITE_CHUNK_SIZE = 250;

function chunkArray<T>(rows: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < rows.length; i += size) {
    chunks.push(rows.slice(i, i + size));
  }
  return chunks;
}

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

        const limit = 250;
        const territories: Array<{
          id: string;
          sector: number;
          size: number;
          density: number;
          slots: number;
          respect: number;
          coordinates: { x: number; y: number };
          neighbors?: string[];
        }> = [];

        for (let offset = 0; ; offset += limit) {
          const response = await tornApi.get("/torn/territory", {
            apiKey: keyRotator.getNextKey(),
            queryParams: { offset, limit },
          });
          const page = response.territory || [];
          if (page.length === 0) {
            break;
          }

          territories.push(...page);
          if (page.length < limit) {
            break;
          }
        }

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
          for (const chunk of chunkArray(blueprintData, DB_WRITE_CHUNK_SIZE)) {
            await db
              .insertInto(TABLE_NAMES.TERRITORY_BLUEPRINT)
              .values(chunk)
              .onConflict((oc) =>
                oc.column("id").doUpdateSet((eb) => ({
                  sector: eb.ref("excluded.sector"),
                  size: eb.ref("excluded.size"),
                  density: eb.ref("excluded.density"),
                  slots: eb.ref("excluded.slots"),
                  respect: eb.ref("excluded.respect"),
                  coordinate_x: eb.ref("excluded.coordinate_x"),
                  coordinate_y: eb.ref("excluded.coordinate_y"),
                  neighbors: eb.ref("excluded.neighbors"),
                  updated_at: eb.ref("excluded.updated_at"),
                })),
              )
              .execute();
          }
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
            for (const chunk of chunkArray(stateData, DB_WRITE_CHUNK_SIZE)) {
              await db
                .insertInto(TABLE_NAMES.TERRITORY_STATE)
                .values(
                  chunk.map((row) => ({
                    territory_id: row.territory_id,
                    faction_id: row.faction_id,
                    is_warring: row.is_warring ? 1 : 0,
                  })),
                )
                .onConflict((oc) => oc.column("territory_id").doNothing())
                .execute();
            }
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
