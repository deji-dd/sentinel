/**
 * Faction data sync worker
 * Runs once daily to update faction data in the NoSQL table
 * Uses system API keys to distribute rate limit load
 */

import {
  TornFactions,
  FactionRoles,
  getSystemKeyPool,
  tornApi,
  Logger,
  FactionRoleMappingDocument,
} from "@sentinel/shared";
import { startEventDrivenRunner } from "../../lib/scheduler.js";
import { ApiKeyRotator } from "@sentinel/shared";

const WORKER_NAME = "faction_sync";
const logger = new Logger(WORKER_NAME);

export function startFactionSync() {
  startEventDrivenRunner({
    worker: WORKER_NAME,
    defaultCadenceSeconds: 86400, // Run once daily
    handler: async () => {
      const finishLog = logger.time();

      try {
        // 1. Get all faction IDs we're tracking from guild mappings
        const factionRoles = FactionRoles.findAll();
        const uniqueFactionIds = Array.from(
          new Set(
            factionRoles
              .map((row: FactionRoleMappingDocument) => row.faction_id)
              .filter(Boolean),
          ),
        ) as number[];

        if (uniqueFactionIds.length === 0) {
          finishLog();
          return;
        }

        logger.info(`Syncing ${uniqueFactionIds.length} factions`);

        // 2. Prepare the System API Key Rotator
        const apiKeys = getSystemKeyPool();
        if (!apiKeys.length) {
          logger.error("No system API key available");
          return;
        }
        const keyRotator = new ApiKeyRotator(apiKeys);

        // 3. Process concurrently with strict pacing
        const delayMs = Math.max(
          100,
          Math.floor(60000 / (50 * apiKeys.length)),
        );

        const results = await keyRotator.processConcurrent(
          uniqueFactionIds.map(String),
          async (factionId, key) => {
            try {
              const res = await tornApi.get("/faction/{id}/basic", {
                apiKey: key,
                pathParams: { id: factionId },
              });
              return { factionId, data: res.basic, error: null };
            } catch (err) {
              return { factionId, data: null, error: err };
            }
          },
          delayMs,
        );

        // 4. Dump into NoSQL Engine
        const docsToInsert = [];

        for (const { factionId, data, error } of results) {
          if (error || !data) {
            continue;
          }

          docsToInsert.push({
            id: factionId,
            data: data,
            updated_at: Date.now(),
          });
        }

        if (docsToInsert.length > 0) {
          TornFactions.insertMany(docsToInsert);
        }

        finishLog();
      } catch (error) {
        logger.error("Faction sync failed", error);
      }
    },
  });
}
