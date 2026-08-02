import { Logger } from "@sentinel/utils";
import { db, type Prisma } from "@sentinel/database";
import { type TornSchema } from "@sentinel/torn-api";
import { tornApiManager, getSystemKeyPool } from "@sentinel/torn-api-manager";

const logger = new Logger("FactionTracker");
const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;

type FactionBasicResponse = TornSchema<"FactionBasicResponse">;

// In-memory set tracking faction IDs currently being fetched in-flight
const inFlightFactionIds = new Set<number>();
// In-memory map caching last known updatedAt timestamp (ms) per faction ID
const trackedFactionTimestamps = new Map<number, number>();

/**
 * Synchronous check whether a faction ID is already tracked and fresh in memory.
 */
export function isFactionTrackedFresh(factionId: number): boolean {
  if (inFlightFactionIds.has(factionId)) return true;
  const lastUpdated = trackedFactionTimestamps.get(factionId);
  return Boolean(lastUpdated && lastUpdated > Date.now() - TWENTY_FOUR_HOURS_MS);
}

/**
 * Ensures that all given faction IDs exist in PostgreSQL and have been updated
 * within the last 24 hours. Missing or outdated factions are fetched asynchronously
 * via the system API key pool.
 *
 * Prevents duplicate concurrent API fetches using an in-memory in-flight lock.
 *
 * @param factionIds Array of numeric Torn Faction IDs
 * @returns Promise resolving to the number of factions synced/updated
 */
export async function ensureFactionsTracked(
  factionIds: (number | null | undefined)[],
): Promise<number> {
  const validIds = Array.from(
    new Set(factionIds.filter((id): id is number => typeof id === "number" && id > 0)),
  );

  if (validIds.length === 0) return 0;

  const now = Date.now();
  const cutoff = now - TWENTY_FOUR_HOURS_MS;

  // Filter out IDs that are already known in memory to be fresh (< 24h)
  const idsNeedingCheck = validIds.filter((id) => {
    if (inFlightFactionIds.has(id)) return false;
    const lastUpdated = trackedFactionTimestamps.get(id);
    return !lastUpdated || lastUpdated < cutoff;
  });

  if (idsNeedingCheck.length === 0) {
    return 0;
  }

  try {
    const existing = await db.faction.findMany({
      where: { id: { in: idsNeedingCheck } },
      select: { id: true, updatedAt: true },
    });

    for (const f of existing) {
      trackedFactionTimestamps.set(f.id, f.updatedAt.getTime());
    }

    const existingMap = new Map(existing.map((f) => [f.id, f.updatedAt.getTime()]));

    // Exclude IDs already saved < 24h ago OR currently being fetched in-flight
    const idsToFetch = idsNeedingCheck.filter((id) => {
      const lastUpdated = existingMap.get(id);
      return !lastUpdated || lastUpdated < cutoff;
    });

    if (idsToFetch.length === 0) {
      return 0;
    }

    // Mark IDs as currently in-flight
    for (const id of idsToFetch) {
      inFlightFactionIds.add(id);
    }

    try {
      const keys = await getSystemKeyPool();
      if (keys.length === 0) {
        logger.warn("No system API keys available to fetch faction details.");
        return 0;
      }

      logger.info(`Fetching details for ${idsToFetch.length} missing/outdated factions...`);

      const responses = (await tornApiManager.executeBatch(
        "/faction/{id}/basic",
        idsToFetch,
        keys,
        (factionId) => ({ pathParams: { id: Number(factionId) } }),
      )) as FactionBasicResponse[];

      const validResponses = responses.filter((r) => r && r.basic);

      if (validResponses.length > 0) {
        await db.$transaction(
          validResponses.map((res) => {
            const basic = res.basic;
            const facId = basic.id;
            const dataJson = basic as unknown as Prisma.InputJsonValue;

            return db.faction.upsert({
              where: { id: facId },
              update: {
                name: basic.name ?? `Faction ${facId}`,
                tag: basic.tag ?? null,
                tagImage: basic.tag_image ?? null,
                leaderId: basic.leader_id ?? null,
                coLeaderId: basic.co_leader_id ?? null,
                respect: basic.respect ?? 0,
                capacity: basic.capacity ?? 0,
                membersCount: typeof basic.members === "number" ? basic.members : 0,
                data: dataJson,
                updatedAt: new Date(),
              },
              create: {
                id: facId,
                name: basic.name ?? `Faction ${facId}`,
                tag: basic.tag ?? null,
                tagImage: basic.tag_image ?? null,
                leaderId: basic.leader_id ?? null,
                coLeaderId: basic.co_leader_id ?? null,
                respect: basic.respect ?? 0,
                capacity: basic.capacity ?? 0,
                membersCount: typeof basic.members === "number" ? basic.members : 0,
                data: dataJson,
                createdAt: new Date(),
                updatedAt: new Date(),
              },
            });
          }),
        );

        for (const res of validResponses) {
          if (res.basic?.id) {
            trackedFactionTimestamps.set(res.basic.id, Date.now());
          }
        }

        logger.info(`Successfully synced ${validResponses.length} factions into PostgreSQL.`);
      }

      return validResponses.length;
    } finally {
      // Release in-flight lock for fetched IDs
      for (const id of idsToFetch) {
        inFlightFactionIds.delete(id);
      }
    }
  } catch (error) {
    logger.error("Failed to execute ensureFactionsTracked:", error);
    return 0;
  }
}
