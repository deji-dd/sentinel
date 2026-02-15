import { executeSync } from "../lib/sync.js";
import { startDbScheduledRunner } from "../lib/scheduler.js";
import { logWarn } from "../lib/logger.js";
import {
  getValidApiKeys,
  upsertTornItems,
  syncTornCategories,
  supabase,
  type TornItemRow,
} from "../lib/supabase.js";
import { TABLE_NAMES } from "../lib/constants.js";
import { tornApi } from "../services/torn-client.js";

const WORKER_NAME = "torn_items_worker";
const DAILY_CADENCE_SECONDS = 86400; // 24h

function nextUtcThreeAm(): string {
  const now = new Date();
  const target = new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
      3,
      0,
      0,
      0,
    ),
  );
  if (target <= now) {
    target.setUTCDate(target.getUTCDate() + 1);
  }
  return target.toISOString();
}

function normalizeItems(
  response: any,
  categoryNameToId: Map<string, number>,
): TornItemRow[] {
  const container = response.items;
  if (!container) return [];

  const itemsArray: any[] = Array.isArray(container)
    ? container
    : Object.values(container as Record<string, any>);

  return itemsArray
    .map((item) => {
      const id = typeof item.id === "number" ? item.id : Number(item.id);
      const name = typeof item.name === "string" ? item.name : null;
      if (!id || !name) return null;

      const image = typeof item.image === "string" ? item.image : null;
      const type = typeof item.type === "string" ? item.type : null;
      const category_id = type ? categoryNameToId.get(type) || null : null;

      return {
        item_id: id,
        name,
        image,
        type,
        category_id,
      } as TornItemRow;
    })
    .filter((row): row is TornItemRow => Boolean(row));
}

async function syncTornItems(): Promise<void> {
  const apiKeys = await getValidApiKeys();
  if (!apiKeys.length) {
    throw new Error("No valid API keys available for Torn items sync");
  }

  // Use the first available key; API returns full list in one call
  const response = await tornApi.get("/torn/items", { apiKey: apiKeys[0] });

  // Extract unique categories from items
  const categories = new Set<string>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const itemsArray: any[] = Array.isArray(response.items)
    ? response.items
    : // eslint-disable-next-line @typescript-eslint/no-explicit-any
      Object.values(response.items as Record<string, any>);

  for (const item of itemsArray) {
    if (item.type && typeof item.type === "string") {
      categories.add(item.type);
    }
  }

  // Sync categories first (insert new ones only)
  if (categories.size > 0) {
    await syncTornCategories(Array.from(categories));
  }

  // Fetch all categories to map names to IDs
  const { data: categoryData } = await supabase
    .from(TABLE_NAMES.TORN_CATEGORIES)
    .select("id, name");

  const categoryNameToId = new Map<string, number>();
  categoryData?.forEach((cat) => {
    categoryNameToId.set(cat.name, cat.id);
  });

  // Normalize items with category IDs
  const items = normalizeItems(response, categoryNameToId);

  if (!items.length) {
    logWarn(WORKER_NAME, "No items received from Torn API");
    return;
  }

  await upsertTornItems(items);
}

export function startTornItemsWorker(): void {
  startDbScheduledRunner({
    worker: WORKER_NAME,
    defaultCadenceSeconds: DAILY_CADENCE_SECONDS,
    pollIntervalMs: 5000,
    initialNextRunAt: nextUtcThreeAm(),
    handler: async () => {
      return await executeSync({
        name: WORKER_NAME,
        timeout: 300000, // 5 minutes
        handler: syncTornItems,
      });
    },
  });
}
