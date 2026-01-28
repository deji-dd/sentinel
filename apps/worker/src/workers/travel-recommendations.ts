import { executeSync } from "../lib/sync.js";
import { decrypt } from "../lib/encryption.js";
import {
  getAllUsers,
  getTravelDataByUserIds,
  getTravelStockCache,
  getUserBarsByUserIds,
  getUserCooldownsByUserIds,
  getDestinationTravelTimes,
  getDestinations,
  upsertTravelRecommendations,
  getTravelSettingsByUserIds,
  getTornItemsWithCategories,
  type TravelRecommendation,
  type StockCacheRow,
} from "../lib/supabase.js";
import { startDbScheduledRunner } from "../lib/scheduler.js";
import { tornApi } from "../services/torn-client.js";

const WORKER_NAME = "travel_recommendations_worker";
const STOCK_STALENESS_MINUTES = 30;
const RESTOCK_INTERVAL_MINUTES = 15;

interface ItemROI {
  itemId: number;
  roi: number;
  profitPerItem: number;
  stockCost: number;
  marketPrice: number;
  currentQuantity: number;
  lastUpdated: Date;
}

async function syncTravelRecommendations(): Promise<void> {
  const users = await getAllUsers();
  if (!users.length) {
    return;
  }

  const usersWithKeys = users.filter((user) => user.api_key);
  if (!usersWithKeys.length) {
    return;
  }

  const userIds = usersWithKeys.map((user) => user.user_id);
  const travelByUser = await getTravelDataByUserIds(userIds);

  const eligibleUsers = usersWithKeys.filter((user) => {
    const travel = travelByUser.get(user.user_id);
    const isEligible =
      !travel || !travel.travel_time_left || travel.travel_time_left <= 0;
    return isEligible;
  });

  if (!eligibleUsers.length) {
    return;
  }

  // Fetch all required data
  const [
    travelStockCache,
    barsByUser,
    cooldownsByUser,
    travelTimes,
    destinations,
    settingsByUser,
    tornItems,
  ] = await Promise.all([
    getTravelStockCache(),
    getUserBarsByUserIds(eligibleUsers.map((u) => u.user_id)),
    getUserCooldownsByUserIds(eligibleUsers.map((u) => u.user_id)),
    getDestinationTravelTimes(),
    getDestinations(),
    getTravelSettingsByUserIds(eligibleUsers.map((u) => u.user_id)),
    getTornItemsWithCategories(),
  ]);

  // Index destinations and travel times by ID
  const travelTimesByDestId = new Map(
    travelTimes.map((t) => [t.destination_id, t]),
  );

  // Decrypt API keys and set up rotation for market fetching
  const apiKeysByUser = new Map<string, string>();
  for (const user of eligibleUsers) {
    try {
      apiKeysByUser.set(user.user_id, decrypt(user.api_key));
    } catch {
      // Ignore decryption errors for individual users
    }
  }

  if (apiKeysByUser.size === 0) {
    return;
  }

  // Set up key rotation: cycle through available keys
  const apiKeys = Array.from(apiKeysByUser.values());
  let keyIndex = 0;

  const getNextApiKey = () => {
    const key = apiKeys[keyIndex];
    keyIndex = (keyIndex + 1) % apiKeys.length;
    return key;
  };

  const now = new Date();
  const allRecommendations: TravelRecommendation[] = [];

  // Process each user
  for (const user of eligibleUsers) {
    const userId = user.user_id;
    const travel = travelByUser.get(userId);
    const bars = barsByUser.get(userId);
    const cooldowns = cooldownsByUser.get(userId);
    const apiKey = apiKeysByUser.get(userId);
    const settings = settingsByUser.get(userId);

    if (!travel || !bars || !cooldowns || !apiKey) {
      continue;
    }

    const capacity = travel.capacity || 5;
    const hasAirstrip = travel.has_airstrip || false;
    const hasWlt = travel.has_wlt_benefit || false;
    const hasBook = travel.active_travel_book || false;

    // Process each destination
    for (const dest of destinations) {
      const travelTime = travelTimesByDestId.get(dest.id);
      if (!travelTime) {
        continue;
      }

      // Calculate user's one-way flight time in minutes
      let oneWayMinutes: number;
      if (hasAirstrip) {
        oneWayMinutes = hasBook
          ? travelTime.airstrip_w_book
          : travelTime.airstrip;
      } else if (hasWlt) {
        oneWayMinutes = hasBook ? travelTime.wlt_w_book : travelTime.wlt;
      } else {
        oneWayMinutes = hasBook
          ? travelTime.standard_w_book
          : travelTime.standard;
      }

      const roundTripMinutes = oneWayMinutes * 2;
      const roundTripSeconds = roundTripMinutes * 60;

      // Filter: flight time vs bars/cooldowns
      if (roundTripSeconds > (bars.energy_flat_time_to_full || Infinity)) {
        continue;
      }
      if (roundTripSeconds > (bars.nerve_flat_time_to_full || Infinity)) {
        continue;
      }
      if (roundTripSeconds > (cooldowns.drug || 0)) {
        continue;
      }

      // Get stock items for this destination
      const destStockCache = travelStockCache.filter(
        (row) => row.destination_id === dest.id,
      );

      if (!destStockCache.length) {
        continue;
      }

      // Calculate ROI for each item
      const itemRois: ItemROI[] = [];

      // Group stock by item_id to get latest and history
      // Data arrives pre-sorted by destination_id, item_id, last_updated DESC from getTravelStockCache
      const stockByItemId = new Map<number, StockCacheRow[]>();
      for (const row of destStockCache) {
        if (!stockByItemId.has(row.item_id)) {
          stockByItemId.set(row.item_id, []);
        }
        stockByItemId.get(row.item_id)!.push(row);
      }

      for (const [itemId, stockRecords] of stockByItemId.entries()) {
        // stockRecords are already sorted by last_updated DESC from getTravelStockCache
        // The first record is the latest state for this item
        if (stockRecords.length === 0) continue;

        // Apply user's blacklisted items filter
        if (settings?.blacklisted_items?.includes(itemId)) {
          continue;
        }

        // Apply user's blacklisted categories filter
        const itemData = tornItems.get(itemId);
        if (
          itemData?.category_id &&
          settings?.blacklisted_categories?.includes(itemData.category_id)
        ) {
          continue;
        }

        const latest = stockRecords[0];
        const lastUpdated = new Date(latest.last_updated);

        // Check staleness on the LATEST record
        const ageMinutes =
          (now.getTime() - lastUpdated.getTime()) / (1000 * 60);

        if (ageMinutes > STOCK_STALENESS_MINUTES) {
          continue;
        }

        // Fetch market price using rotated API key
        let marketPrice: number;
        try {
          const marketResp = await tornApi.get("/market/{id}/itemmarket", {
            apiKey: getNextApiKey(),
            pathParams: { id: itemId },
            queryParams: { limit: 1 },
          });
          const listings = marketResp.itemmarket?.listings || [];
          if (!listings.length || !listings[0].price) {
            continue;
          }
          marketPrice = listings[0].price;
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
        } catch (err) {
          continue;
        }

        const stockCost = latest.cost;
        const profitPerItem = marketPrice - stockCost;

        // Drop items with negative ROI
        if (profitPerItem <= 0) {
          continue;
        }

        // Calculate ROI: profit * capacity / time
        const roi = (profitPerItem * capacity) / roundTripMinutes;

        // Calculate depletion projection using full history
        const projected = calculateProjectedQuantity(
          stockRecords,
          roundTripMinutes,
          now,
        );

        // Drop if projected quantity < capacity
        if (projected < capacity) {
          continue;
        }

        itemRois.push({
          itemId,
          roi,
          profitPerItem,
          stockCost,
          marketPrice,
          currentQuantity: latest.quantity,
          lastUpdated,
        });
      }

      // Sort by ROI descending
      itemRois.sort((a, b) => b.roi - a.roi);

      if (!itemRois.length) {
        continue;
      }

      // Pick best item
      const bestItem = itemRois[0];

      const profitPerTrip = bestItem.profitPerItem * capacity;
      const profitPerMinute = profitPerTrip / roundTripMinutes;

      // Apply user's profit threshold filters
      if (
        settings?.min_profit_per_trip &&
        profitPerTrip < settings.min_profit_per_trip
      ) {
        continue;
      }
      if (
        settings?.min_profit_per_minute &&
        profitPerMinute < settings.min_profit_per_minute
      ) {
        continue;
      }

      // Build message
      const messages: string[] = [];
      if (roundTripSeconds > (bars.energy_time_to_full || Infinity)) {
        messages.push("Train your E");
      }
      if (roundTripSeconds > (bars.nerve_time_to_full || Infinity)) {
        messages.push("Do some crimes");
      }
      if (roundTripSeconds > (cooldowns.medical || 0)) {
        messages.push("Fill some blood bags");
      }
      if (roundTripSeconds > (cooldowns.booster || 0)) {
        messages.push("Use some boosters");
      }

      const message = messages.length > 0 ? messages.join(" | ") : null;

      const cashToCarry = bestItem.stockCost * capacity;

      allRecommendations.push({
        user_id: userId,
        destination_id: dest.id,
        best_item_id: bestItem.itemId,
        profit_per_trip: profitPerTrip,
        profit_per_minute: profitPerMinute,
        round_trip_minutes: roundTripMinutes,
        cash_to_carry: cashToCarry,
        message,
      });
    }
  }

  // Assign recommendation_rank per user (1 = best profit_per_minute)
  const byUser = new Map<string, TravelRecommendation[]>();
  for (const rec of allRecommendations) {
    if (!byUser.has(rec.user_id)) {
      byUser.set(rec.user_id, []);
    }
    byUser.get(rec.user_id)!.push(rec);
  }

  for (const [_userId, recs] of byUser.entries()) {
    recs.sort(
      (a, b) => (b.profit_per_minute || 0) - (a.profit_per_minute || 0),
    );
    recs.forEach((rec, idx) => {
      rec.recommendation_rank = idx + 1;
    });
  }

  if (allRecommendations.length > 0) {
    await upsertTravelRecommendations(allRecommendations);
  }
}

/**
 * Calculate projected quantity after depletion and restocks during flight time.
 * Drain = avg loss per minute from history
 * Restocks = count of 15-min intervals (:00, :15, :30, :45) during flight
 * Projected = current - (drain * flightTime) + (restocks * avgRestock)
 */
function calculateProjectedQuantity(
  stockRecords: StockCacheRow[],
  flightTimeMinutes: number,
  _now: Date,
): number {
  if (stockRecords.length < 2) {
    return stockRecords[0]?.quantity || 0;
  }

  // Sort ascending by time
  const sorted = stockRecords
    .slice()
    .sort(
      (a, b) =>
        new Date(a.last_updated).getTime() - new Date(b.last_updated).getTime(),
    );

  const current = sorted[sorted.length - 1].quantity;

  // Calculate drain (avg loss per minute)
  let totalLoss = 0;
  let totalMinutes = 0;

  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const curr = sorted[i];
    const qtyDiff = curr.quantity - prev.quantity;
    const timeDiffMs =
      new Date(curr.last_updated).getTime() -
      new Date(prev.last_updated).getTime();
    const timeDiffMin = timeDiffMs / (1000 * 60);

    // If quantity increased, it's a restock; skip for drain calculation
    if (qtyDiff >= 0) continue;

    totalLoss += Math.abs(qtyDiff);
    totalMinutes += timeDiffMin;
  }

  const drainPerMinute = totalMinutes > 0 ? totalLoss / totalMinutes : 0;

  // Calculate restocks during flight
  const restockCount = Math.floor(flightTimeMinutes / RESTOCK_INTERVAL_MINUTES);

  // Calculate average restock amount from history
  let totalRestock = 0;
  let restockEvents = 0;

  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const curr = sorted[i];
    const qtyDiff = curr.quantity - prev.quantity;

    if (qtyDiff > 0) {
      totalRestock += qtyDiff;
      restockEvents++;
    }
  }

  const avgRestockAmount = restockEvents > 0 ? totalRestock / restockEvents : 0;

  // Projected = current - (drain * flightTime) + (restocks * avgAmount)
  const projected =
    current -
    drainPerMinute * flightTimeMinutes +
    restockCount * avgRestockAmount;

  return Math.max(0, Math.floor(projected));
}

export function startTravelRecommendationsWorker(): void {
  startDbScheduledRunner({
    worker: WORKER_NAME,
    defaultCadenceSeconds: 300,
    pollIntervalMs: 5000,
    handler: async () => {
      return await executeSync({
        name: WORKER_NAME,
        timeout: 300000,
        handler: syncTravelRecommendations,
      });
    },
  });
}
