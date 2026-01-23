import { insertStockCache, type StockCacheRow } from "../lib/supabase.js";
import { COUNTRY_CODE_MAP } from "../lib/country-codes.js";
import { log, logSuccess, logError, logWarn } from "../lib/logger.js";

const WORKER_NAME = "sync-abroad-stocks";
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
 * Fetch foreign stock data from YATA API and sync to database.
 * Transforms nested country/stock structure into flat rows for historical tracking.
 */
export async function syncAbroadStocks(): Promise<void> {
  log(WORKER_NAME, "Starting abroad stock sync...");

  try {
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

    // Transform and flatten the data
    const rows: StockCacheRow[] = [];
    const unmappedCodes: Set<string> = new Set();

    for (const [countryCode, countryData] of Object.entries(data.stocks)) {
      // Map country code to destination name
      const destination = COUNTRY_CODE_MAP[countryCode];

      if (!destination) {
        unmappedCodes.add(countryCode);
        logWarn(
          WORKER_NAME,
          `Unknown country code: "${countryCode}" - skipping`,
        );
        continue;
      }

      // Convert update timestamp to ISO string
      const lastUpdated = new Date(countryData.update * 1000).toISOString();

      // Transform each item into a row
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

    // Log unmapped codes for debugging
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

    // Insert into database
    if (rows.length > 0) {
      await insertStockCache(rows);
      logSuccess(
        WORKER_NAME,
        `Inserted ${rows.length} stock records (${Object.keys(data.stocks).length - unmappedCodes.size} countries)`,
      );
    } else {
      logWarn(WORKER_NAME, "No valid stock records to insert");
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logError(WORKER_NAME, `Sync failed: ${message}`);
    throw error;
  }
}

// Export for manual task execution
if (import.meta.url === `file://${process.argv[1]}`) {
  syncAbroadStocks()
    .then(() => {
      logSuccess(WORKER_NAME, "Task completed successfully");
      process.exit(0);
    })
    .catch((error) => {
      logError(WORKER_NAME, `Task failed: ${error}`);
      process.exit(1);
    });
}
