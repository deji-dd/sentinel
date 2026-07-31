import { Logger } from "@sentinel/utils";
import { db, type Prisma } from "@sentinel/database";
import { type TornSchema } from "@sentinel/torn-api";
import {
  tornApiManager,
  getSystemKeyPool,
  getSystemKeys,
} from "@sentinel/torn-api-manager";
import { startEventDrivenRunner } from "../../lib/scheduler.js";
import { dispatchToBot } from "../../lib/ipc.js";
import { ensureFactionsTracked } from "../../lib/faction-tracker.js";
import type { WorkerStartOptions } from "../registry.js";
import type { IpcWarPayload, IpcTerritoryPayload } from "@sentinel/schemas";

const WORKER_NAME = "torn_territory_activity_sync";
const logger = new Logger(WORKER_NAME);

type ApiOwnership = TornSchema<"FactionTerritoryOwnership">;
type ApiRacket = TornSchema<"TornRacket">;

type ApiTerritoryWarV1 = {
  territorywars?: Record<
    string,
    {
      territory_war_id: number;
      assaulting_faction: number;
      defending_faction: number;
      started: number;
      score: number;
      required_score: number;
      ended?: number;
    }
  >;
};

/**
 * Calculates safe polling cadence in seconds based on available system API key pool size.
 */
function calculateOptimalCadence(
  keyCount: number,
  requestsPerLoop: number,
): number {
  const maxRequestsPerMinute = Math.max(1, keyCount) * 30;
  const maxLoopsPerMinute = Math.floor(maxRequestsPerMinute / requestsPerLoop);
  return Number((60 / Math.max(1, maxLoopsPerMinute)).toFixed(2));
}

/**
 * Core state reconciliation engine for territory ownership, rackets, and warfare.
 */
async function executeActivityEngine(): Promise<number> {
  const finishLog = logger.time();

  try {
    // Check system initialization state flags from PostgreSQL
    const warInitState = await db.systemState.findUnique({
      where: { id: "war_ledger_init_state" },
    });
    const stateInitState = await db.systemState.findUnique({
      where: { id: "tt_init_state" },
    });

    const isWarsInit = Boolean(warInitState?.init);
    const isStatesInit = Boolean(stateInitState?.init);

    if (!isWarsInit) {
      logger.info(
        "War Ledger not initialized. Clearing table for fresh sync...",
      );
      await db.warLedger.deleteMany({});
    }

    if (!isStatesInit) {
      logger.info(
        "Territory States not initialized. Clearing table for fresh sync...",
      );
      await db.territoryState.deleteMany({});
    }

    const offsets = Array.from({ length: 9 }, (_, i) => i * 500);
    const [key1, key2, ...pageKeys] = await getSystemKeys(2 + offsets.length);

    // Execute parallel fetches across endpoints using key pool
    const [racketsRes, warfareRes, ...ownershipResPages] = await Promise.all([
      tornApiManager.get("/faction/rackets", {
        apiKey: key1.apiKey,
        userId: key1.userId,
      }) as Promise<TornSchema<"FactionRacketsResponse">>,
      tornApiManager.client.getRaw("/torn", {
        apiKey: key2.apiKey,
        queryParams: { selections: "territorywars" },
      }) as Promise<ApiTerritoryWarV1>,
      ...offsets.map(
        (offset, idx) =>
          tornApiManager.get("/faction/territoryownership", {
            apiKey: pageKeys[idx].apiKey,
            userId: pageKeys[idx].userId,
            queryParams: { limit: 500, offset },
          }) as Promise<TornSchema<"FactionTerritoriesOwnershipResponse">>,
      ),
    ]);

    const apiRackets = racketsRes.rackets || [];
    const apiOwnership = ownershipResPages.flatMap(
      (page) => page.territoryOwnership || [],
    );
    const apiWarsMap = warfareRes.territorywars || {};

    // Non-blocking trigger to populate & refresh active faction records in background
    const factionIdsToTrack: (number | null | undefined)[] = [
      ...apiOwnership.map((o) => o.owned_by),
      ...Object.values(apiWarsMap).flatMap((w) => [
        w.assaulting_faction,
        w.defending_faction,
      ]),
    ];
    ensureFactionsTracked(factionIdsToTrack).catch((err) => {
      logger.error("Background faction tracking error:", err);
    });

    // Build O(1) lookup maps
    const apiRacketsMap = new Map<string, ApiRacket>(
      apiRackets.map((r: ApiRacket & { territory?: string }) => [
        r.territory || r.name,
        r,
      ]),
    );
    const apiOwnershipMap = new Map<string, ApiOwnership>(
      apiOwnership.map((o) => [o.id, o]),
    );

    // Query active database records
    const dbStatesList = await db.territoryState.findMany();
    const dbStates = new Map(dbStatesList.map((s) => [s.id, s]));

    const dbActiveWarsList = await db.warLedger.findMany({
      where: { endTime: null },
    });
    const dbActiveWars = new Map(dbActiveWarsList.map((w) => [w.tt, w]));

    const warUpserts: IpcWarPayload[] = [];
    const stateUpserts: IpcTerritoryPayload[] = [];

    // ==========================================
    // PHASE 1: WAR RESOLUTION
    // ==========================================
    const activeApiWarIds = new Set(Object.keys(apiWarsMap));
    const now = Date.now();

    // Resolve ENDED Wars
    for (const [tt, dbWar] of dbActiveWars) {
      if (!activeApiWarIds.has(tt)) {
        const currentOwner = apiOwnershipMap.get(tt)?.owned_by;

        const updatedWar: IpcWarPayload = {
          id: dbWar.id,
          tt: dbWar.tt,
          assaultingFaction: dbWar.assaultingFaction,
          defendingFaction: dbWar.defendingFaction,
          victorFaction: currentOwner ?? null,
          startTime: dbWar.startTime,
          endTime: new Date(now),
        };

        warUpserts.push(updatedWar);

        const isTruce =
          now - dbWar.startTime.getTime() < 72 * 3600000 &&
          currentOwner === dbWar.defendingFaction;

        if (isTruce) {
          dispatchToBot({ action: "peace_treaty", data: updatedWar });
        } else if (currentOwner === dbWar.assaultingFaction) {
          if (isWarsInit)
            dispatchToBot({ action: "assault_succeed", data: updatedWar });
        } else {
          if (isWarsInit)
            dispatchToBot({ action: "assault_fail", data: updatedWar });
        }
      }
    }

    // Register NEW Wars
    for (const [tt, war] of Object.entries(apiWarsMap)) {
      if (!dbActiveWars.has(tt)) {
        const data: IpcWarPayload = {
          id: war.territory_war_id.toString(),
          tt,
          assaultingFaction: war.assaulting_faction,
          defendingFaction: war.defending_faction,
          victorFaction: null,
          startTime: new Date(war.started * 1000),
          endTime: null,
        };

        warUpserts.push(data);
        if (isWarsInit) dispatchToBot({ action: "assault_start", data });
      }
    }

    // ==========================================
    // PHASE 2: OWNERSHIP & RACKETS
    // ==========================================
    const activeWarTerritories = new Set(Object.keys(apiWarsMap));

    for (const tt of apiOwnership) {
      const ttId = tt.id;
      const oldState = dbStates.get(ttId);
      const newFaction = tt.owned_by ?? null;
      const racket = apiRacketsMap.get(ttId) ?? null;
      const isWarring = activeWarTerritories.has(ttId);

      const newState: IpcTerritoryPayload = {
        id: ttId,
        factionId: newFaction,
        racket: racket as unknown as Prisma.InputJsonValue | null,
        isWarring,
      };

      let hasChanged = !oldState;

      if (oldState) {
        if (oldState.factionId !== newState.factionId) {
          hasChanged = true;
          if (!isWarring) {
            if (oldState.factionId && isStatesInit) {
              dispatchToBot({
                action: "tt_drop",
                data: {
                  id: oldState.id,
                  factionId: oldState.factionId,
                  racket: oldState.racket,
                  isWarring: oldState.isWarring,
                },
              });
            }
            if (newState.factionId && isStatesInit) {
              dispatchToBot({ action: "tt_claim", data: newState });
            }
          }
        }

        const oldRacket = oldState.racket as unknown as ApiRacket | null;
        if (oldRacket?.changed_at !== racket?.changed_at) {
          hasChanged = true;

          if (!oldRacket && racket && isStatesInit) {
            dispatchToBot({ action: "racket_spawn", data: newState });
          } else if (oldRacket && !racket && isStatesInit) {
            dispatchToBot({
              action: "racket_despawn",
              data: {
                id: oldState.id,
                factionId: oldState.factionId,
                racket: oldState.racket,
                isWarring: oldState.isWarring,
              },
            });
          } else if (oldRacket && racket) {
            if (oldRacket.level > racket.level && isStatesInit) {
              dispatchToBot({ action: "racket_level_down", data: newState });
            } else if (oldRacket.level < racket.level && isStatesInit) {
              dispatchToBot({ action: "racket_level_up", data: newState });
            }
          }
        }

        if (oldState.isWarring !== newState.isWarring) {
          hasChanged = true;
        }
      }

      if (hasChanged) {
        stateUpserts.push(newState);
      }
    }

    // Persist changes to PostgreSQL using Prisma transactions
    if (stateUpserts.length > 0) {
      const chunkSize = 200;
      for (let i = 0; i < stateUpserts.length; i += chunkSize) {
        const chunk = stateUpserts.slice(i, i + chunkSize);
        await db.$transaction(
          chunk.map((item) =>
            db.territoryState.upsert({
              where: { id: item.id },
              update: {
                factionId: item.factionId,
                racket: item.racket as unknown as Prisma.InputJsonValue,
                isWarring: item.isWarring,
                updatedAt: new Date(),
              },
              create: {
                id: item.id,
                factionId: item.factionId,
                racket: item.racket as unknown as Prisma.InputJsonValue,
                isWarring: item.isWarring,
                createdAt: new Date(),
                updatedAt: new Date(),
              },
            }),
          ),
        );
      }
    }

    if (warUpserts.length > 0) {
      const chunkSize = 200;
      for (let i = 0; i < warUpserts.length; i += chunkSize) {
        const chunk = warUpserts.slice(i, i + chunkSize);
        await db.$transaction(
          chunk.map((item) => {
            const startTimeDate =
              item.startTime instanceof Date
                ? item.startTime
                : new Date(item.startTime);
            const endTimeDate = item.endTime
              ? item.endTime instanceof Date
                ? item.endTime
                : new Date(item.endTime)
              : null;

            return db.warLedger.upsert({
              where: { id: item.id },
              update: {
                tt: item.tt,
                assaultingFaction: item.assaultingFaction,
                defendingFaction: item.defendingFaction,
                victorFaction: item.victorFaction,
                startTime: startTimeDate,
                endTime: endTimeDate,
                updatedAt: new Date(),
              },
              create: {
                id: item.id,
                tt: item.tt,
                assaultingFaction: item.assaultingFaction,
                defendingFaction: item.defendingFaction,
                victorFaction: item.victorFaction,
                startTime: startTimeDate,
                endTime: endTimeDate,
                createdAt: new Date(),
                updatedAt: new Date(),
              },
            });
          }),
        );
      }
    }

    // Update system initialization flags
    if (!isWarsInit) {
      await db.systemState.upsert({
        where: { id: "war_ledger_init_state" },
        update: { init: true, updatedAt: new Date() },
        create: {
          id: "war_ledger_init_state",
          init: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });
    }

    if (!isStatesInit) {
      await db.systemState.upsert({
        where: { id: "tt_init_state" },
        update: { init: true, updatedAt: new Date() },
        create: {
          id: "tt_init_state",
          init: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });
    }

    finishLog();

    const totalRequestsPerLoop = 11;
    const availableKeys = (await getSystemKeyPool()).length;
    const nextCadence = calculateOptimalCadence(
      availableKeys,
      totalRequestsPerLoop,
    );
    return Date.now() + nextCadence * 1000;
  } catch (error) {
    logger.error("Failed to execute territory activity engine:", error);
    throw error;
  }
}

/**
 * Initializes and boots the territory activity sync worker.
 */
export function startTerritoryActivitySync(options?: WorkerStartOptions): void {
  startEventDrivenRunner({
    worker: WORKER_NAME,
    defaultCadenceSeconds: 15,
    initialDelayMs: options?.initialDelayMs,
    handler: executeActivityEngine,
  });
}
