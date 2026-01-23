import { executeSync } from "../lib/sync.js";
import { insertStockCache, type StockCacheRow } from "../lib/supabase.js";
import { COUNTRY_CODE_MAP } from "../lib/country-codes.js";
import { log, logError, logSuccess, logWarn } from "../lib/logger.js";
import { startDbScheduledRunner } from "../lib/scheduler.js";

const WORKER_NAME = "travel-stock-cache-worker";
const YATA_API_URL = "https://yata.yt/api/v1/travel/export/";
const REQUEST_TIMEOUT = 15000; // 15 seconds

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
  log(WORKER_NAME, "Starting abroad stock sync...");

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
    throw new Error(
      `YATA API returned status ${response.status}: ${response.statusText}`,
    );
  }

  const data = (await response.json()) as YataApiResponse;

  if (!data.stocks || Object.keys(data.stocks).length === 0) {
    log(WORKER_NAME, "No stock data received from API");
    return;
  }

  log(
    WORKER_NAME,
    `Received data for ${Object.keys(data.stocks).length} countries`,
  );

  const rows: StockCacheRow[] = [];
  const unmappedCodes: Set<string> = new Set();

  for (const [countryCode, countryData] of Object.entries(data.stocks)) {
    const destination = COUNTRY_CODE_MAP[countryCode];

    if (!destination) {
      unmappedCodes.add(countryCode);
      logWarn(WORKER_NAME, `Unknown country code: "${countryCode}" - skipping`);
      continue;
    }

    const lastUpdated = new Date(countryData.update * 1000).toISOString();

    for (const item of countryData.stocks) {
      rows.push({
        destination,
        item_id: item.id,
        item_name: item.name,
        quantity: item.quantity,
        cost: item.cost,
        last_updated: lastUpdated,
      });
    }
  }

  if (unmappedCodes.size > 0) {
    logWarn(
      WORKER_NAME,
      `Unmapped country codes: ${Array.from(unmappedCodes).join(", ")}`,
    );
    logWarn(
      WORKER_NAME,
      "Add these to COUNTRY_CODE_MAP in country-codes.ts if they are valid Torn destinations",
    );
  }

  if (rows.length > 0) {
    await insertStockCache(rows);
    logSuccess(
      WORKER_NAME,
      `Inserted ${rows.length} stock records (${Object.keys(data.stocks).length - unmappedCodes.size} countries)`,
    );
  } else {
    logWarn(WORKER_NAME, "No valid stock records to insert");
  }
}

export function startTravelStockCacheWorker(): void {
  log(WORKER_NAME, "Starting worker (DB-scheduled)...");

  startDbScheduledRunner({
    worker: "travel_stock_cache_worker",
    pollIntervalMs: 5000,
    handler: async () => {
      await executeSync({
        name: WORKER_NAME,
        timeout: 30000,
        handler: syncAbroadStocks,
      });
    },
  });

  // Run immediately on startup
  executeSync({
    name: WORKER_NAME,
    timeout: 30000,
    handler: syncAbroadStocks,
  }).catch((error) => {
    logError(WORKER_NAME, `Initial sync failed: ${error}`);
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  startTravelStockCacheWorker();
  log(WORKER_NAME, "Worker running. Press Ctrl+C to exit.");
}
