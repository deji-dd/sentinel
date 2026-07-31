import { Logger } from "@sentinel/utils";
import { db, type Prisma } from "@sentinel/database";
import { tornApi, type TornSchema } from "@sentinel/torn-api";
import { getNextSystemKey } from "@sentinel/torn-api-manager";
import { startEventDrivenRunner } from "../../lib/scheduler.js";
import type { WorkerStartOptions } from "../registry.js";

const WORKER_NAME = "torn_reference_sync";
const logger = new Logger(WORKER_NAME);

type ApiGym = {
  name: string;
  stage: number;
  cost: number;
  energy: number;
  strength: number;
  speed: number;
  defense: number;
  dexterity: number;
  note: string;
};

type ApiProperty = {
  id: number | string;
  name?: string;
  cost?: number;
  happy?: number;
  upkeep?: number;
  modifications?: string[];
  staff?: string[];
};

type TornFullReferenceResponse = {
  items?: TornSchema<"TornItem">[];
  crimes?: TornSchema<"TornCrime">[];
  stocks?: TornSchema<"TornStock">[];
  properties?: ApiProperty[];
  gyms?: Record<string, ApiGym>;
};

type PointsMarketResponse = {
  pointsmarket?: Record<string, { cost: number; quantity: number }>;
};

function getNext0015UTC(): number {
  const now = new Date();
  const next = new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
      0,
      15,
      0,
      0,
    ),
  );
  if (next.getTime() <= now.getTime()) {
    next.setUTCDate(next.getUTCDate() + 1);
  }
  return next.getTime();
}

/**
 * Syncs static public reference data from Torn (Items, Crimes, Stocks, Properties, Gyms, Points Market Price).
 */
async function runTornReferenceSync(): Promise<number> {
  const finishSync = logger.time();

  try {
    const keyEntry = await getNextSystemKey();
    const apiKey = keyEntry?.apiKey;

    if (!apiKey) {
      logger.warn("No API key available for public Torn reference sync. Skipping.");
      return getNext0015UTC();
    }

    const res = (await tornApi.get("/torn", {
      apiKey,
      queryParams: { selections: "items,crimes,stocks,properties,gyms" },
    })) as TornFullReferenceResponse;

    const marketRes = (await tornApi.get("/market", {
      apiKey,
      queryParams: { selections: "pointsmarket" },
    })) as PointsMarketResponse;

    // Calculate average points market price across top 5,000 points
    if (marketRes.pointsmarket) {
      let totalCost = 0;
      let totalQty = 0;
      for (const listing of Object.values(marketRes.pointsmarket)) {
        totalQty += listing.quantity;
        totalCost += listing.cost * listing.quantity;
        if (totalQty >= 5000) break;
      }
      const avgPrice = totalQty > 0 ? Math.floor(totalCost / totalQty) : 0;
      if (avgPrice > 0) {
        await db.systemState.upsert({
          where: { id: "points_price" },
          update: {
            data: { price: avgPrice, lastUpdated: Date.now() },
            updatedAt: new Date(),
          },
          create: {
            id: "points_price",
            data: { price: avgPrice, lastUpdated: Date.now() },
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        });
      }
    }

    // 1. Sync Torn Items
    if (res.items && res.items.length > 0) {
      const items = res.items;
      logger.info(`Syncing ${items.length} Torn items into PostgreSQL...`);

      const chunkSize = 500;
      for (let i = 0; i < items.length; i += chunkSize) {
        const chunk = items.slice(i, i + chunkSize);
        await db.$transaction(
          chunk.map((item) =>
            db.tornItem.upsert({
              where: { id: String(item.id) },
              update: {
                name: item.name,
                data: item as unknown as Prisma.InputJsonValue,
                updatedAt: new Date(),
              },
              create: {
                id: String(item.id),
                name: item.name,
                data: item as unknown as Prisma.InputJsonValue,
                createdAt: new Date(),
                updatedAt: new Date(),
              },
            }),
          ),
        );
      }
    }

    // 2. Sync Torn Crimes
    if (res.crimes && res.crimes.length > 0) {
      const crimes = res.crimes;
      logger.info(`Syncing ${crimes.length} Torn crimes into PostgreSQL...`);

      const chunkSize = 500;
      for (let i = 0; i < crimes.length; i += chunkSize) {
        const chunk = crimes.slice(i, i + chunkSize);
        await db.$transaction(
          chunk.map((crime) =>
            db.tornCrime.upsert({
              where: { id: String(crime.id) },
              update: {
                name: crime.name,
                data: crime as unknown as Prisma.InputJsonValue,
                updatedAt: new Date(),
              },
              create: {
                id: String(crime.id),
                name: crime.name,
                data: crime as unknown as Prisma.InputJsonValue,
                createdAt: new Date(),
                updatedAt: new Date(),
              },
            }),
          ),
        );
      }
    }

    // 3. Sync Torn Stocks
    if (res.stocks && res.stocks.length > 0) {
      const stocks = res.stocks;
      logger.info(`Syncing ${stocks.length} Torn stocks into PostgreSQL...`);

      const chunkSize = 500;
      for (let i = 0; i < stocks.length; i += chunkSize) {
        const chunk = stocks.slice(i, i + chunkSize);
        await db.$transaction(
          chunk.map((stock) =>
            db.tornStock.upsert({
              where: { id: String(stock.id) },
              update: {
                name: stock.name,
                acronym: stock.acronym,
                market: stock.market as unknown as Prisma.InputJsonValue,
                bonus: stock.bonus as unknown as Prisma.InputJsonValue,
                images: stock.images as unknown as Prisma.InputJsonValue,
                updatedAt: new Date(),
              },
              create: {
                id: String(stock.id),
                name: stock.name,
                acronym: stock.acronym,
                market: stock.market as unknown as Prisma.InputJsonValue,
                bonus: stock.bonus as unknown as Prisma.InputJsonValue,
                images: stock.images as unknown as Prisma.InputJsonValue,
                createdAt: new Date(),
                updatedAt: new Date(),
              },
            }),
          ),
        );
      }
    }

    // 4. Sync Torn Properties
    if (res.properties && res.properties.length > 0) {
      const properties = res.properties;
      logger.info(`Syncing ${properties.length} Torn properties into PostgreSQL...`);

      const chunkSize = 500;
      for (let i = 0; i < properties.length; i += chunkSize) {
        const chunk = properties.slice(i, i + chunkSize);
        await db.$transaction(
          chunk.map((property) =>
            db.tornProperty.upsert({
              where: { id: String(property.id) },
              update: {
                name: property.name,
                data: property as unknown as Prisma.InputJsonValue,
                updatedAt: new Date(),
              },
              create: {
                id: String(property.id),
                name: property.name,
                data: property as unknown as Prisma.InputJsonValue,
                createdAt: new Date(),
                updatedAt: new Date(),
              },
            }),
          ),
        );
      }
    }

    // 5. Sync Torn Gyms
    if (res.gyms) {
      const gymEntries = Object.entries(res.gyms);
      logger.info(`Syncing ${gymEntries.length} Torn gyms into PostgreSQL...`);

      await db.$transaction(
        gymEntries.map(([id, gym]) =>
          db.tornGym.upsert({
            where: { id },
            update: {
              name: gym.name,
              stage: gym.stage,
              cost: gym.cost,
              energy: gym.energy,
              strength: gym.strength,
              speed: gym.speed,
              defense: gym.defense,
              dexterity: gym.dexterity,
              note: gym.note,
              updatedAt: new Date(),
            },
            create: {
              id,
              name: gym.name,
              stage: gym.stage,
              cost: gym.cost,
              energy: gym.energy,
              strength: gym.strength,
              speed: gym.speed,
              defense: gym.defense,
              dexterity: gym.dexterity,
              note: gym.note,
              createdAt: new Date(),
              updatedAt: new Date(),
            },
          }),
        ),
      );
    }

    finishSync();
    return getNext0015UTC();
  } catch (error) {
    logger.error("Failed to execute Torn reference sync:", error);
    return Date.now() + 60 * 60 * 1000;
  }
}

/**
 * Initializes and starts the Torn reference sync background worker.
 */
export function startTornReferenceSync(options?: WorkerStartOptions): void {
  startEventDrivenRunner({
    worker: WORKER_NAME,
    defaultCadenceSeconds: 86400,
    initialDelayMs: options?.initialDelayMs,
    handler: runTornReferenceSync,
  });
}
