import { executeSync } from "../lib/sync.js";
import {
  getActiveTradeItemIds,
  getValidApiKeys,
  getTradeItemNames,
  upsertMarketTrends,
  type MarketTrendRow,
} from "../lib/supabase.js";
import { fetchTornItemMarket, ApiKeyRotator } from "../services/torn.js";
import { log, logError, logSuccess, logWarn } from "../lib/logger.js";
import { startDbScheduledRunner } from "../lib/scheduler.js";

const WORKER_NAME = "market-trends-worker";

/**
 * Market trends worker - syncs cheapest market prices from Torn API.
 * Updates sentinel_market_trends table every 5 minutes.
 */
async function syncMarketPrices(): Promise<void> {
  // Get available API keys from users table
  const apiKeys = await getValidApiKeys();
  if (!apiKeys.length) {
    throw new Error(
      "No valid API keys found in users table. Ensure at least one user has an api_key.",
    );
  }

  const itemIds = await getActiveTradeItemIds();
  if (!itemIds.length) {
    logWarn(WORKER_NAME, "No active trade items found");
    return;
  }

  const itemNames = await getTradeItemNames();
  logSuccess(WORKER_NAME, `Syncing prices for ${itemIds.length} trade items`);

  const rotator = new ApiKeyRotator(apiKeys);
  const trends: MarketTrendRow[] = [];
  const errors: Array<{ itemId: number; error: string }> = [];

  await rotator.processSequential(
    itemIds,
    async (itemId, apiKey) => {
      try {
        const marketData = await fetchTornItemMarket(apiKey, itemId, 1);
        const listing = marketData.itemmarket?.listings?.[0];
        const price = listing?.cost || listing?.price;

        if (price !== undefined && price > 0) {
          const itemName = itemNames.get(itemId);
          if (!itemName) {
            logWarn(WORKER_NAME, `Missing item name for item ${itemId}`);
            return;
          }
          trends.push({
            item_id: itemId,
            item_name: itemName,
            lowest_market_price: price,
            last_updated: new Date().toISOString(),
          });
        } else {
          logWarn(WORKER_NAME, `No valid price found for item ${itemId}`);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logError(WORKER_NAME, `Failed to fetch item ${itemId}: ${message}`);
        errors.push({ itemId, error: message });
      }
    },
    700,
  );

  if (trends.length > 0) {
    await upsertMarketTrends(trends);
    logSuccess(WORKER_NAME, `Upserted ${trends.length} prices`);
  }

  if (errors.length > 0) {
    logWarn(WORKER_NAME, `${errors.length} items failed to sync`);
  }
}

export function startMarketTrendsWorker(): void {
  log(WORKER_NAME, "Starting worker (DB-scheduled)...");

  startDbScheduledRunner({
    worker: "market_trends_worker",
    pollIntervalMs: 5000,
    handler: async () => {
      await executeSync({
        name: WORKER_NAME,
        timeout: 120000,
        handler: syncMarketPrices,
      });
    },
  });

  // Run immediately on startup
  executeSync({
    name: WORKER_NAME,
    timeout: 120000,
    handler: syncMarketPrices,
  }).catch((error) => {
    logError(WORKER_NAME, `Initial sync failed: ${error}`);
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  startMarketTrendsWorker();
  log(WORKER_NAME, "Worker running. Press Ctrl+C to exit.");
}
