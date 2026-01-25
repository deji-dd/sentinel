import { executeSync } from "../lib/sync.js";
import {
  insertStockCache,
  cleanupOldStockCache,
  type StockCacheRow,
  getDestinations,
} from "../lib/supabase.js";
import { logWarn } from "../lib/logger.js";
import { startDbScheduledRunner } from "../lib/scheduler.js";

const WORKER_NAME = "travel_stock_cache_worker";
const YATA_API_URL = "https://yata.yt/api/v1/travel/export/";
const REQUEST_TIMEOUT = 15000; // 15 seconds
const RETENTION_DAYS = 3; // Keep 3 days of history (~522k rows, ~94 points per item for drain calc)

interface YataStockItem {
  id: number;
  name: string;
  quantity: number;
  cost: number;
}

interface YataCountryData {
  update: number;
  stocks: YataStockItem[];
}

interface YataApiResponse {
  stocks: Record<string, YataCountryData>;
  timestamp: number;
}

/**
 * Travel stock cache worker - syncs foreign stock data from YATA API.
 * Updates sentinel_travel_stock_cache table every 5 minutes.
 */
async function syncAbroadStocks(): Promise<void> {
  // Fetch from YATA API
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

  let response: Response;
  try {
    response = await fetch(YATA_API_URL, {
      signal: controller.signal,
      headers: {
        Accept: "application/json",
      },
    });
  } finally {
    clearTimeout(timeoutId);
  }

  if (!response.ok) {
    const responseText = await response.text();
    let errorMsg = `YATA API returned status ${response.status}`;
    let errorCode = 0;

    try {
      const errorData = JSON.parse(responseText) as {
        error?: { error?: string; code?: number };
      };
      if (errorData.error?.code) {
        errorCode = errorData.error.code;
      }
      if (errorData.error?.error) {
        errorMsg = errorData.error.error;
      }
    } catch {
      // Fallback to generic parsing
    }

    // Map error codes
    let fullError = errorMsg;
    if (response.status === 500 && errorCode === 1) {
      fullError = `Server Error: ${errorMsg}`;
    } else if (response.status === 400 && errorCode === 2) {
      fullError = `User Error: ${errorMsg}`;
    } else if (response.status === 429 && errorCode === 3) {
      fullError = `Rate Limited: ${errorMsg}`;
      logWarn(WORKER_NAME, fullError);
    } else if (response.status === 400 && errorCode === 4) {
      fullError = `Torn API Error: ${errorMsg}`;
      logWarn(WORKER_NAME, fullError);
    }

    throw new Error(fullError);
  }

  let data: YataApiResponse;
  try {
    data = (await response.json()) as YataApiResponse;
  } catch (parseError) {
    throw new Error(
      `Failed to parse YATA response: ${parseError instanceof Error ? parseError.message : String(parseError)}`,
    );
  }

  if (!data.stocks || Object.keys(data.stocks).length === 0) {
    logWarn(WORKER_NAME, "YATA API returned no stock data");
    return;
  }

  const destinationMap = new Map<string, number>();
  const destinations = await getDestinations();
  destinations.forEach((dest) => {
    destinationMap.set(dest.country_code.toLowerCase(), dest.id);
  });

  const rows: StockCacheRow[] = [];
  const unmappedCodes: Set<string> = new Set();

  for (const [countryCode, countryData] of Object.entries(data.stocks)) {
    const destinationId = destinationMap.get(countryCode.toLowerCase());

    if (!destinationId) {
      unmappedCodes.add(countryCode);
      continue;
    }

    const lastUpdated = new Date(countryData.update * 1000).toISOString();

    for (const item of countryData.stocks) {
      rows.push({
        destination_id: destinationId,
        item_id: item.id,
        quantity: item.quantity,
        cost: item.cost,
        last_updated: lastUpdated,
      });
    }
  }

  if (rows.length > 0) {
    await insertStockCache(rows);
  }

  // Cleanup old records
  try {
    await cleanupOldStockCache(RETENTION_DAYS);
  } catch (cleanupError) {
    logWarn(
      WORKER_NAME,
      `Cleanup failed: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`,
    );
  }
}

export function startTravelStockCacheWorker(): void {
  startDbScheduledRunner({
    worker: "travel_stock_cache_worker",
    defaultCadenceSeconds: 300,
    pollIntervalMs: 5000,
    handler: async () => {
      return await executeSync({
        name: WORKER_NAME,
        timeout: 30000,
        handler: syncAbroadStocks,
      });
    },
  });
}
