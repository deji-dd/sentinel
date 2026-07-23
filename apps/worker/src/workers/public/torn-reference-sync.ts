import {
  Logger,
  tornApi,
  getWorkerApiKey,
  TornItems,
  TornCrimes,
  TornStocks,
  TornProperties,
  TornSchema,
  TornItemDocument,
  TornCrimeDocument,
  TornPropertyDocument,
  TornStockDocument,
  SystemState,
  TornGyms,
} from "@sentinel/shared";
import { startEventDrivenRunner } from "../../lib/scheduler.js";

const WORKER_NAME = "torn_reference_sync";
// Run every day to update public Torn reference data
const CADENCE_SEC = 60 * 60 * 24;

export async function runTornReferenceSync() {
  const logger = new Logger(WORKER_NAME);

  try {
    const apiKey = getWorkerApiKey("system");
    if (!apiKey) {
      logger.warn(
        "No API key available for public Torn reference sync. Skipping.",
      );
      return getNext0015UTC();
    }

    const finishSync = logger.time();

    const res = await tornApi.get<
      TornSchema<"TornItemsResponse"> &
        TornSchema<"TornCrimesResponse"> &
        TornSchema<"TornStocksResponse"> &
        TornSchema<"TornProperties"> & {
          gyms: Record<
            string,
            {
              name: string;
              stage: number;
              cost: number;
              energy: number;
              strength: number;
              speed: number;
              defense: number;
              dexterity: number;
              note: string;
            }
          >;
        }
    >("/torn", {
      apiKey,
      queryParams: { selections: "items,crimes,stocks,properties,gyms" },
    });

    const marketRes = await tornApi.get<{
      pointsmarket: Record<string, { cost: number; quantity: number }>;
    }>("/market", {
      apiKey,
      queryParams: { selections: "pointsmarket" },
    });

    if (marketRes.pointsmarket) {
      let totalCost = 0;
      let totalQty = 0;
      for (const listing of Object.values(marketRes.pointsmarket)) {
        totalQty += listing.quantity;
        totalCost += listing.cost * listing.quantity;
        if (totalQty >= 5000) break; // Average over first 5000 points
      }
      const avgPrice = totalQty > 0 ? Math.floor(totalCost / totalQty) : 0;
      if (avgPrice > 0) {
        SystemState.insertOne({
          id: "points_price",
          price: avgPrice,
          last_updated: Date.now(),
        });
      }
    }

    const itemsToInsert: TornItemDocument[] = [];
    const crimesToInsert: TornCrimeDocument[] = [];
    const stocksToInsert: TornStockDocument[] = [];
    const propertiesToInsert: TornPropertyDocument[] = [];

    if (res.items) {
      TornItems.deleteManyBy({});
      const itemsArray = res.items;
      for (const item of itemsArray) {
        itemsToInsert.push({ id: String(item.id), data: item });
      }
      TornItems.insertMany(itemsToInsert);
      logger.info(`Synced ${itemsToInsert.length} Torn Items`);
    }

    if (res.crimes) {
      TornCrimes.deleteManyBy({});
      const crimesArray = res.crimes;
      for (const crime of crimesArray) {
        crimesToInsert.push({ id: String(crime.id), data: crime });
      }
      TornCrimes.insertMany(crimesToInsert);
      logger.info(`Synced ${crimesToInsert.length} Torn Crimes`);
    }

    if (res.stocks) {
      TornStocks.deleteManyBy({});
      const stocksArray = res.stocks;
      for (const stock of stocksArray) {
        stocksToInsert.push({
          id: String(stock.id),
          name: stock.name,
          acronym: stock.acronym,
          images: stock.images,
          market: stock.market,
          bonus: stock.bonus,
        });
      }
      TornStocks.insertMany(stocksToInsert);
      logger.info(`Synced ${stocksToInsert.length} Torn Stocks`);
    }

    if (res.properties) {
      TornProperties.deleteManyBy({});
      const propertiesArray = res.properties;
      for (const property of propertiesArray) {
        propertiesToInsert.push({
          id: String(property.id),
          data: property,
        });
      }
      TornProperties.insertMany(propertiesToInsert);
      logger.info(`Synced ${propertiesToInsert.length} Torn Properties`);
    }

    if (res.gyms) {
      TornGyms.deleteManyBy({});
      const gymsToInsert = [];
      for (const [id, gym] of Object.entries(res.gyms)) {
        gymsToInsert.push({
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
        });
      }
      if (gymsToInsert.length > 0) {
        TornGyms.insertMany(gymsToInsert);
        logger.info(`Synced ${gymsToInsert.length} Torn Gyms`);
      }
    }

    finishSync();

    return getNext0015UTC();
  } catch (error) {
    logger.error("Failed to execute Torn reference sync", error);
    return Date.now() + 60 * 60 * 1000;
  }
}

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

import type { WorkerStartOptions } from "../registry.js";

export function startTornReferenceSync(options?: WorkerStartOptions) {
  startEventDrivenRunner({
    worker: WORKER_NAME,
    handler: runTornReferenceSync,
    defaultCadenceSeconds: CADENCE_SEC,
    initialDelayMs: options?.initialDelayMs,
  });
}
