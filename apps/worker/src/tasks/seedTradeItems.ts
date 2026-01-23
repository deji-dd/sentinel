import {
  upsertTradeItems,
  getValidApiKeys,
  type TradeItemRow,
} from "../lib/supabase.js";
import {
  fetchTornItems,
  ApiKeyRotator,
  type TornItem,
  type TornItemsResponse,
} from "../services/torn.js";
import { log, logSuccess, logError, logWarn } from "../lib/logger.js";

const WORKER_NAME = "seed-trade-items";

function normalizeItems(response: TornItemsResponse): TornItem[] {
  const itemsField = (response as any)?.items;

  if (Array.isArray(itemsField)) {
    return itemsField as TornItem[];
  }

  if (itemsField && typeof itemsField === "object") {
    return Object.values(itemsField as Record<string, TornItem>);
  }

  return [];
}

export async function seedTradeItems(): Promise<void> {
  log(WORKER_NAME, "Seeding trade items from Torn API...");
  try {
    // Get available API keys from users table
    const apiKeys = await getValidApiKeys();

    if (!apiKeys.length) {
      throw new Error(
        "No valid API keys found in users table. Ensure at least one user has an api_key.",
      );
    }

    const rotator = new ApiKeyRotator(apiKeys);
    const apiKey = rotator.getNextKey();

    const data = await fetchTornItems(apiKey);
    const items = normalizeItems(data);

    if (!items.length) {
      logWarn(WORKER_NAME, "No items returned from Torn API");
      return;
    }

    const allowedTypes = new Set(["Flower", "Plushie"]);
    const filtered: TradeItemRow[] = [];

    for (const item of items) {
      const isFlowerOrPlushie = item.type && allowedTypes.has(item.type);
      const isXanax = item.name === "Xanax";

      if (!isFlowerOrPlushie && !isXanax) continue;

      const category = item.type;

      filtered.push({
        item_id: item.id,
        name: item.name,
        category,
        is_active: true,
      });
    }

    if (filtered.length === 0) {
      log(WORKER_NAME, "No matching items to upsert");
      return;
    }

    const counts = filtered.reduce<Record<string, number>>((acc, item) => {
      acc[item.category] = (acc[item.category] || 0) + 1;
      return acc;
    }, {});

    await upsertTradeItems(filtered);

    const summary = Object.entries(counts)
      .map(
        ([category, count]) => `${count} ${category}${count === 1 ? "" : "s"}`,
      )
      .join(", ");

    logSuccess(
      WORKER_NAME,
      `Upserted ${filtered.length} trade items (${summary})`,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logError(WORKER_NAME, `Seeding failed: ${message}`);
    throw error;
  }
}

// Run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  seedTradeItems()
    .then(() => {
      logSuccess(WORKER_NAME, "Completed successfully");
      process.exit(0);
    })
    .catch((error) => {
      logError(WORKER_NAME, `Failed: ${error}`);
      process.exit(1);
    });
}
