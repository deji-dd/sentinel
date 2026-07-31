import { Logger } from "@sentinel/utils";
import { db, type Prisma } from "@sentinel/database";
import { startEventDrivenRunner } from "../../lib/scheduler.js";
import type { WorkerStartOptions } from "../registry.js";

const WORKER_NAME = "travel_sync";
const logger = new Logger(WORKER_NAME);

// Cadence: Run every 5 minutes (300 seconds) to track YATA item depletion
const CADENCE_SEC = 300;
const TWELVE_HOURS_MS = 12 * 60 * 60 * 1000;
const MAX_DATAPOINTS = 144; // 12 hours * 12 checks per hour

type YataStockItem = {
  id: number;
  name: string;
  quantity: number;
  cost: number;
};

type YataCountryData = {
  update: number;
  country: string;
  stocks: YataStockItem[];
};

type YataExportResponse = {
  stocks?: Record<string, YataCountryData>;
};

export type TravelStockHistoryPoint = {
  timestamp: number;
  quantity: number;
};

export type TravelStockItem = {
  id: number;
  name: string;
  quantity: number;
  cost: number;
  history: TravelStockHistoryPoint[];
};

/**
 * Polls YATA travel export every 5 minutes and updates PostgreSQL `TravelDestination` records.
 * Maintains a rolling 12-hour history window for stock depletion tracking.
 */
export async function runTravelSync(): Promise<void> {
  const finishLog = logger.time();

  try {
    const res = await fetch("https://yata.yt/api/v1/travel/export/");
    if (!res.ok) {
      throw new Error(`YATA API HTTP ${res.status}: ${res.statusText}`);
    }

    const data = (await res.json()) as YataExportResponse;
    const stocksMap = data.stocks;

    if (!stocksMap || Object.keys(stocksMap).length === 0) {
      logger.warn("No travel stocks data received from YATA export API.");
      return;
    }

    const cutoff = Date.now() - TWELVE_HOURS_MS;
    const nowTimestamp = Date.now();

    // Fetch existing destinations from PostgreSQL
    const existingDestinations = await db.travelDestination.findMany();
    const existingMap = new Map(existingDestinations.map((d) => [d.id, d.stocks as unknown as TravelStockItem[]]));

    const upsertOperations = Object.entries(stocksMap).map(([countryCode, countryData]) => {
      const existingStocks = existingMap.get(countryCode) ?? [];
      const existingStockMap = new Map(existingStocks.map((s) => [s.id, s.history || []]));

      const updatedStocks: TravelStockItem[] = countryData.stocks.map((item) => {
        const history = existingStockMap.get(item.id) ?? [];
        // Append new timestamp & filter history to retain last 12 hours (up to 144 points max)
        const updatedHistory = [
          ...history.filter((h) => h.timestamp >= cutoff),
          { timestamp: nowTimestamp, quantity: item.quantity },
        ].slice(-MAX_DATAPOINTS);

        return {
          id: item.id,
          name: item.name,
          quantity: item.quantity,
          cost: item.cost,
          history: updatedHistory,
        };
      });

      const stocksJson = updatedStocks as unknown as Prisma.InputJsonValue;

      return db.travelDestination.upsert({
        where: { id: countryCode },
        update: {
          name: countryData.country ?? countryCode,
          stocks: stocksJson,
          updatedAt: new Date(),
        },
        create: {
          id: countryCode,
          name: countryData.country ?? countryCode,
          stocks: stocksJson,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });
    });

    await db.$transaction(upsertOperations);
    logger.info(`Successfully synced ${upsertOperations.length} travel destinations into PostgreSQL.`);

    finishLog();
  } catch (error) {
    logger.error("Failed to execute travel sync:", error);
  }
}

/**
 * Initializes and starts the travel sync background worker.
 */
export function startTravelSync(options?: WorkerStartOptions): void {
  startEventDrivenRunner({
    worker: WORKER_NAME,
    defaultCadenceSeconds: CADENCE_SEC,
    initialDelayMs: options?.initialDelayMs,
    handler: runTravelSync,
  });
}
