import { Logger, TravelDestinations } from "@sentinel/shared";
import { startEventDrivenRunner } from "../../lib/scheduler.js";

const WORKER_NAME = "travel_sync";
// Run every 15 minutes to track YATA depletion
const CADENCE_SEC = 60 * 15;

export async function runTravelSync() {
  const logger = new Logger(WORKER_NAME);

  try {
    const finishSync = logger.time();
    let res: Response | null = null;
    let retries = 3;
    let delay = 2000;

    while (retries > 0) {
      try {
        res = await fetch("https://yata.yt/api/v1/travel/export/", {
          // 15 second timeout to prevent indefinite hangs
          signal: AbortSignal.timeout(15000),
        });
        if (res.ok) break;
        logger.warn(`YATA fetch returned status ${res.status}. Retrying...`);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } catch (err: any) {
        logger.warn(
          `YATA fetch failed: ${err.message}. Retrying in ${delay}ms...`,
        );
      }
      retries--;
      if (retries > 0) {
        await new Promise((r) => setTimeout(r, delay));
        delay *= 2; // Exponential backoff
      }
    }

    if (!res || !res.ok) {
      logger.error(
        `Exhausted retries fetching YATA travel data. Final status: ${res?.status || "Network Error"}`,
      );
      return;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = (await res.json()) as any;
    if (!data.stocks) {
      logger.error("Invalid YATA travel payload: missing stocks");
      return;
    }

    const currentTimestamp = Math.floor(Date.now() / 1000);

    const destinations = Object.entries(data.stocks);
    for (const [countryCode, info] of destinations) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const parsedInfo = info as any;
      const updateTimestamp = parsedInfo.update || currentTimestamp;
      const stocks = parsedInfo.stocks || [];

      // Load existing destination document
      const existingDoc = TravelDestinations.findOne(countryCode);
      const newStocksArray = [];

      for (const stock of stocks) {
        let history =
          existingDoc?.stocks.find((s) => s.id === stock.id)?.history || [];

        const lastEntry =
          history.length > 0 ? history[history.length - 1] : null;

        // If the quantity increased, it's a restock. We should clear the history.
        if (lastEntry && stock.quantity > lastEntry.quantity) {
          history = [];
        } else if (lastEntry && stock.quantity === lastEntry.quantity) {
          // If the quantity is exactly the same, do we add it?
          // Adding it helps flatten the depletion rate when nobody buys.
        }

        // Add current datapoint
        history.push({ timestamp: updateTimestamp, quantity: stock.quantity });

        // Retain only the last 10 datapoints
        if (history.length > 10) {
          history = history.slice(history.length - 10);
        }

        newStocksArray.push({
          id: stock.id,
          name: stock.name,
          quantity: stock.quantity,
          cost: stock.cost,
          history,
        });
      }

      TravelDestinations.deleteManyBy({ id: countryCode });
      TravelDestinations.insertOne({
        id: countryCode,
        updatedAt: updateTimestamp,
        stocks: newStocksArray,
      });
    }

    finishSync();
  } catch (e) {
    logger.error("Travel sync failed", e);
  }
}

import type { WorkerStartOptions } from "../registry.js";

export function startTravelSync(options?: WorkerStartOptions): void {
  startEventDrivenRunner({
    worker: WORKER_NAME,
    handler: runTravelSync,
    defaultCadenceSeconds: CADENCE_SEC,
    initialDelayMs: options?.initialDelayMs,
  });
}
