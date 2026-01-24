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

const WORKER_NAME = "market_trends_worker";

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
    return;
  }

  const itemNames = await getTradeItemNames();

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
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        errors.push({ itemId, error: message });
      }
    },
    700,
  );

  if (trends.length > 0) {
    await upsertMarketTrends(trends);
  }

  if (errors.length > 0) {
    logWarn(WORKER_NAME, `${errors.length}/${itemIds.length} items failed`);
  }
}

export function startMarketTrendsWorker(): void {
  startDbScheduledRunner({
    worker: "market_trends_worker",
    defaultCadenceSeconds: 300,
    pollIntervalMs: 5000,
    handler: async () => {
      return await executeSync({
        name: WORKER_NAME,
        timeout: 120000,
        handler: syncMarketPrices,
      });
    },
  });
}
