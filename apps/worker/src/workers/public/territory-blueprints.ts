import { Logger } from "@sentinel/utils";
import { db, type Prisma } from "@sentinel/database";
import { type TornSchema } from "@sentinel/torn-api";
import {
  tornApiManager,
  getSystemKeyPool,
} from "@sentinel/torn-api-manager";
import { startEventDrivenRunner } from "../../lib/scheduler.js";
import type { WorkerStartOptions } from "../registry.js";

const WORKER_NAME = "torn_territory_blueprints_sync";
const logger = new Logger(WORKER_NAME);

type SingleTerritory = TornSchema<"TornTerritory">;

/**
 * Calculates the target epoch timestamp for the next upcoming 03:00 UTC execution.
 */
function getNext0300UtcTimestamp(lastRunAt: number | null): number {
  const now = Date.now();
  if (!lastRunAt || now - lastRunAt > 86400000) return now;
  const target = new Date(now);
  target.setUTCHours(3, 0, 0, 0);
  if (now >= target.getTime()) target.setUTCDate(target.getUTCDate() + 1);
  return target.getTime();
}

/**
 * Core extraction and bulk dump engine for territory blueprints.
 * Fetches system API keys and executes multi-key parallel batch requests across offsets.
 */
async function fetchAndDumpBlueprints(): Promise<number> {
  const finishLog = logger.time();

  try {
    // 1. Fetch system key pool
    const keys = await getSystemKeyPool();
    logger.info(`${keys.length} API keys in key pool.`);

    const limit = 250;
    const estimatedTotal = 4500;
    const pageCount = Math.ceil(estimatedTotal / limit);
    const offsets = Array.from({ length: pageCount }, (_, i) => i * limit);

    // 2. Execute parallel batch requests across all offsets using key pool & rate limiter
    const responses = (await tornApiManager.executeBatch(
      "/torn/territory",
      offsets,
      keys,
      (offset) => ({ queryParams: { offset, limit } }),
    )) as TornSchema<"TornTerritoriesResponse">[];

    const territories: SingleTerritory[] = responses.flatMap(
      (res) => res.territory || [],
    );

    if (territories.length === 0) {
      logger.warn("Received empty territories response from Torn API.");
      return getNext0300UtcTimestamp(Date.now());
    }

    logger.info(
      `Fetched ${territories.length} territory blueprints across ${offsets.length} parallel requests. Dumping to PostgreSQL...`,
    );

    // 3. Bulk database transaction in chunks of 500
    const chunkSize = 500;
    for (let i = 0; i < territories.length; i += chunkSize) {
      const chunk = territories.slice(i, i + chunkSize);
      await db.$transaction(
        chunk.map((tt) => {
          const jsonData = tt as unknown as Prisma.InputJsonValue;
          return db.territoryBlueprint.upsert({
            where: { id: tt.id },
            update: {
              sector: tt.sector,
              size: tt.size,
              density: tt.density,
              slots: tt.slots,
              data: jsonData,
              updatedAt: new Date(),
            },
            create: {
              id: tt.id,
              sector: tt.sector,
              size: tt.size,
              density: tt.density,
              slots: tt.slots,
              data: jsonData,
              createdAt: new Date(),
              updatedAt: new Date(),
            },
          });
        }),
      );
    }

    finishLog();

    // 4. Return target next run timestamp (03:00 UTC)
    return getNext0300UtcTimestamp(Date.now());
  } catch (error) {
    logger.error("Failed to sync territory blueprints:", error);
    throw error;
  }
}

/**
 * Initializes and starts the territory blueprint worker.
 */
export function startTerritoryBlueprintSync(
  options?: WorkerStartOptions,
): void {
  startEventDrivenRunner({
    worker: WORKER_NAME,
    defaultCadenceSeconds: 86400,
    initialDelayMs: options?.initialDelayMs,
    handler: fetchAndDumpBlueprints,
  });
}
