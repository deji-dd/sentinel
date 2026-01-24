import { executeSync } from "../lib/sync.js";
import { decrypt } from "../lib/encryption.js";
import {
  getAllUsers,
  getTravelDataByUserIds,
  getMarketTrends,
  getTravelStockCache,
  getUserBarsByUserIds,
  getUserCooldownsByUserIds,
} from "../lib/supabase.js";
import { startDbScheduledRunner } from "../lib/scheduler.js";
import { log, logWarn } from "../lib/logger.js";

const WORKER_NAME = "travel_recommendations_worker";

async function syncTravelRecommendations(): Promise<void> {
  const users = await getAllUsers();
  if (!users.length) {
    return;
  }

  // Require users with an API key so we can fetch personalized data later
  const usersWithKeys = users.filter((user) => user.api_key);
  if (!usersWithKeys.length) {
    logWarn(WORKER_NAME, "No users have an API key; skipping run");
    return;
  }

  const userIds = usersWithKeys.map((user) => user.user_id);
  const travelByUser = await getTravelDataByUserIds(userIds);

  const eligibleUsers = usersWithKeys.filter((user) => {
    const travel = travelByUser.get(user.user_id);
    return !travel || !travel.travel_time_left || travel.travel_time_left <= 0;
  });

  if (!eligibleUsers.length) {
    log(WORKER_NAME, "No eligible users (all are traveling)");
    return;
  }

  // Gather general data needed for recommendations
  const [marketTrends, travelStockCache] = await Promise.all([
    getMarketTrends(),
    getTravelStockCache(),
  ]);

  const [barsByUser, cooldownsByUser] = await Promise.all([
    getUserBarsByUserIds(eligibleUsers.map((u) => u.user_id)),
    getUserCooldownsByUserIds(eligibleUsers.map((u) => u.user_id)),
  ]);

  // Decrypt API keys for eligible users (not yet used, but ready for per-user calls)
  const apiKeysByUser = new Map<string, string>();
  for (const user of eligibleUsers) {
    try {
      apiKeysByUser.set(user.user_id, decrypt(user.api_key));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logWarn(
        WORKER_NAME,
        `${user.user_id}: failed to decrypt api key (${message})`,
      );
    }
  }

  log(
    WORKER_NAME,
    `Prepared ${eligibleUsers.length} users for recommendations | market trends: ${marketTrends.length} | stock cache: ${travelStockCache.length} | bars: ${barsByUser.size} | cooldowns: ${cooldownsByUser.size}`,
  );
}

export function startTravelRecommendationsWorker(): void {
  startDbScheduledRunner({
    worker: WORKER_NAME,
    defaultCadenceSeconds: 300,
    pollIntervalMs: 5000,
    handler: async () => {
      return await executeSync({
        name: WORKER_NAME,
        timeout: 60000,
        handler: syncTravelRecommendations,
      });
    },
  });
}
