import { executeSync } from "../lib/sync.js";
import { startDbScheduledRunner } from "../lib/scheduler.js";
import { logWarn } from "../lib/logger.js";
import {
  getValidApiKeys,
  upsertTornItems,
  type TornItemRow,
} from "../lib/supabase.js";
import { fetchTornItems, type TornItemsResponse } from "../services/torn.js";

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

function normalizeItems(response: TornItemsResponse): TornItemRow[] {
  const container = (response as any).items;
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

      return {
        item_id: id,
        name,
        image,
        type,
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
  const response = await fetchTornItems(apiKeys[0]);
  const items = normalizeItems(response);

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
