import {
  getActiveTradeItemIds,
  upsertMarketTrends,
  getValidApiKeys,
  getTradeItemNames,
  type MarketTrendRow,
} from "../lib/supabase.js";
import { fetchTornItemMarket, ApiKeyRotator } from "../services/torn.js";
import { logSuccess, logError, logWarn } from "../lib/logger.js";

const WORKER_NAME = "sync-market-prices";

/**
 * Sync current market prices for all active trade items.
 * Fetches the cheapest listing for each item and stores in sentinel_market_trends.
 * Uses API key rotation to distribute requests across available keys.
 */
export async function syncMarketPrices(): Promise<void> {
  try {
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

    // Fetch item names for enrichment
    const itemNames = await getTradeItemNames();

    logSuccess(WORKER_NAME, `Syncing prices for ${itemIds.length} trade items`);

    // Create rotator and process items
    const rotator = new ApiKeyRotator(apiKeys);
    const trends: MarketTrendRow[] = [];
    const errors: Array<{ itemId: number; error: string }> = [];

    // Use sequential processing with per-key rate limiting
    // With N keys, we could go concurrent, but sequential with delay is safer for API
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
          const message =
            error instanceof Error ? error.message : String(error);
          logError(WORKER_NAME, `Failed to fetch item ${itemId}: ${message}`);
          errors.push({ itemId, error: message });
        }
      },
      700, // 700ms delay between requests
    );

    if (trends.length > 0) {
      await upsertMarketTrends(trends);
      logSuccess(WORKER_NAME, `Upserted ${trends.length} prices`);
    }

    if (errors.length > 0) {
      logWarn(WORKER_NAME, `${errors.length} items failed to sync`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logError(WORKER_NAME, `Sync failed: ${message}`);
    throw error;
  }
}
