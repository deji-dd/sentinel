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
        TornSchema<"TornProperties">
    >("/torn", {
      apiKey,
      queryParams: { selections: "items,crimes,stocks,properties" },
    });

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
      // @ts-ignore
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
      // @ts-ignore
      TornProperties.insertMany(propertiesToInsert);
      logger.info(`Synced ${propertiesToInsert.length} Torn Properties`);
    }

    finishSync();

    return getNext0015UTC();
  } catch (error) {
    logger.error("Failed to execute Torn reference sync", error);
    // On error, try again in 1 hour
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

export function startTornReferenceSync() {
  startEventDrivenRunner({
    worker: WORKER_NAME,
    handler: runTornReferenceSync,
    defaultCadenceSeconds: CADENCE_SEC,
  });
}
