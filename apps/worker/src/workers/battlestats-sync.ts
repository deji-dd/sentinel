import { executeSync } from "../lib/sync.js";
import { getSystemApiKey } from "../lib/api-keys.js";
import { tornApi } from "../services/torn-client.js";
import { Logger } from "../lib/logger.js";
import { startDbScheduledRunner } from "../lib/scheduler.js";
import { TABLE_NAMES } from "@sentinel/shared";
import { getKysely } from "@sentinel/shared/db/sqlite.js";
import { randomUUID } from "crypto";

const BATTLESTATS_WORKER_NAME = "battlestats_sync_worker";
const logger = new Logger(BATTLESTATS_WORKER_NAME);

export async function syncBattlestats(): Promise<void> {
  const apiKey = await getSystemApiKey("personal");
  const db = getKysely();

  try {
    const response = (await tornApi.get("/user", {
      apiKey,
      queryParams: {
        selections: ["battlestats"],
      },
    })) as any;

    const strength = Number(response.strength || 0);
    const speed = Number(response.speed || 0);
    const defense = Number(response.defense || 0);
    const dexterity = Number(response.dexterity || 0);
    const total_stats = Number(response.total || (strength + speed + defense + dexterity));

    if (total_stats === 0) {
      logger.warn("Received 0 total stats from Torn API, skipping snapshot");
      return;
    }

    // Fetch the latest snapshot
    const latest = await db
      .selectFrom(TABLE_NAMES.BATTLESTATS_SNAPSHOTS)
      .selectAll()
      .orderBy("created_at", "desc")
      .limit(1)
      .executeTakeFirst();

    const statsChanged =
      !latest ||
      latest.strength !== strength ||
      latest.speed !== speed ||
      latest.defense !== defense ||
      latest.dexterity !== dexterity;

    if (statsChanged) {
      await db
        .insertInto(TABLE_NAMES.BATTLESTATS_SNAPSHOTS)
        .values({
          id: randomUUID(),
          created_at: new Date().toISOString(),
          strength,
          speed,
          defense,
          dexterity,
          total_stats,
        })
        .execute();

      logger.success(`Recorded new battlestats snapshot: Total ${total_stats.toLocaleString()}`);
    } else {
      logger.debug("Battlestats have not changed, skipping snapshot");
    }
  } catch (error) {
    logger.error("Failed to sync battlestats:", error);
  }
}

export function startBattlestatsSyncWorker(): void {
  startDbScheduledRunner({
    worker: BATTLESTATS_WORKER_NAME,
    defaultCadenceSeconds: 60, // check every 60 seconds
    pollIntervalMs: 5000,
    handler: async () => {
      return await executeSync({
        name: BATTLESTATS_WORKER_NAME,
        timeout: 25000,
        handler: syncBattlestats,
      });
    },
  });
}
