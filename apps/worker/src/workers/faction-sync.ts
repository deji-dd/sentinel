/**
 * Faction data sync worker
 * Runs once daily to update faction data in sentinel_torn_factions table
 * Uses system API keys to distribute rate limit load
 */

import { TABLE_NAMES, ApiKeyRotator } from "@sentinel/shared";
import { startDbScheduledRunner } from "../lib/scheduler.js";
import { getAllSystemApiKeys } from "../lib/api-keys.js";
import { logDuration, logError } from "../lib/logger.js";
import { tornApi } from "../services/torn-client.js";
import { getKysely } from "@sentinel/shared/db/sqlite.js";

interface FactionRoleRow {
  faction_id: number | null;
}

export function startFactionSyncWorker() {
  return startDbScheduledRunner({
    worker: "faction_sync",
    defaultCadenceSeconds: 86400, // Run once daily (24 hours)
    handler: async () => {
      const startTime = Date.now();
      const db = getKysely();

      try {
        // Get all faction IDs we're tracking from guild faction role mappings
        const factionRoles = (await db
          .selectFrom(TABLE_NAMES.FACTION_ROLES)
          .select("faction_id")
          .execute()) as FactionRoleRow[];

        const uniqueFactionIds = Array.from(
          new Set(
            factionRoles
              .map((row) => row.faction_id)
              .filter((id) => id != null) || [],
          ),
        ) as number[];

        if (uniqueFactionIds.length === 0) {
          logDuration(
            "faction_sync",
            "No factions to sync",
            Date.now() - startTime,
          );
          return true;
        }

        console.log(
          `[Faction Sync] Syncing ${uniqueFactionIds.length} factions`,
        );

        // Get available API keys and initialize rotator for load balancing
        const apiKeys = await getAllSystemApiKeys("system");
        if (!apiKeys.length) {
          logError("faction_sync", "No system API key available");
          return false;
        }

        // Create API key rotator to distribute requests across all available keys
        const keyRotator = new ApiKeyRotator(apiKeys);

        // Sync faction data in batches using shared client with rate limiting
        let successCount = 0;
        let errorCount = 0;
        const batchSize = 10;

        for (let i = 0; i < uniqueFactionIds.length; i += batchSize) {
          const batch = uniqueFactionIds.slice(i, i + batchSize);

          // Process batch in parallel
          const promises = batch.map(async (factionId) => {
            try {
              const response = await tornApi.get("/faction/{id}/basic", {
                apiKey: keyRotator.getNextKey(),
                pathParams: { id: factionId },
              });

              // If we get here, API call succeeded
              const basic = response.basic;

              // Upsert to database
              const updatedAt = new Date().toISOString();
              await db
                .insertInto(TABLE_NAMES.TORN_FACTIONS)
                .values({
                  id: basic.id,
                  name: basic.name,
                  tag: basic.tag,
                  tag_image: basic.tag_image,
                  leader_id: basic.leader_id,
                  co_leader_id: basic.co_leader_id,
                  respect: basic.respect,
                  days_old: basic.days_old,
                  capacity: basic.capacity,
                  members: basic.members,
                  is_enlisted: basic.is_enlisted ? 1 : 0,
                  rank: basic.rank?.name || null,
                  best_chain: basic.best_chain,
                  note: basic.note || null,
                  updated_at: updatedAt,
                })
                .onConflict((oc) =>
                  oc.column("id").doUpdateSet({
                    name: basic.name,
                    tag: basic.tag,
                    tag_image: basic.tag_image,
                    leader_id: basic.leader_id,
                    co_leader_id: basic.co_leader_id,
                    respect: basic.respect,
                    days_old: basic.days_old,
                    capacity: basic.capacity,
                    members: basic.members,
                    is_enlisted: basic.is_enlisted ? 1 : 0,
                    rank: basic.rank?.name || null,
                    best_chain: basic.best_chain,
                    note: basic.note || null,
                    updated_at: updatedAt,
                  }),
                )
                .execute();

              return { success: true };
            } catch (error) {
              // TornApiClient throws errors (including Torn API errors)
              console.warn(
                `[Faction Sync] Error syncing faction ${factionId}: ${error instanceof Error ? error.message : String(error)}`,
              );
              return { success: false };
            }
          });

          const results = await Promise.all(promises);
          successCount += results.filter((r) => r.success).length;
          errorCount += results.filter((r) => !r.success).length;
        }

        const duration = Date.now() - startTime;
        console.log(
          `[Faction Sync] Completed: ${successCount}/${uniqueFactionIds.length} synced, ${errorCount} errors`,
        );
        logDuration(
          "faction_sync",
          `Synced ${successCount} factions`,
          duration,
        );

        return true;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logError("faction_sync", `Sync failed: ${message}`);
        return false;
      }
    },
  });
}
