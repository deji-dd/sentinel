import {
  Logger,
  BazaarMugConfigs,
  BazaarMugTargets,
  GuildApiKeys,
  WorkerSchedules,
  tornApi,
  ApiKeyRotator,
  decryptApiKey,
  GuildApiKeyDocument,
  TornSchema,
  BazaarMugConfigDocument,
  BazaarMugTargetDocument,
} from "@sentinel/shared";
import { startEventDrivenRunner } from "../../lib/scheduler.js";
import { dispatchToBot } from "../../lib/ipc.js";

const logger = new Logger("bazaar_manager");
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY!;
type BazaarResponse = {
  bazaar: {
    ID: number;
    name: string;
    type: string;
    quantity: number;
    price: number;
    market_price: number;
  }[];
};
type UserGenericResponse = TornSchema<"UserProfileResponse"> & BazaarResponse;
interface DashboardPayload {
  playerId: string;
  name: string;
  status: string;
  isOnline: boolean;
  value: number;
}

// Track which guilds already have an active runner loop in RAM
const activeGuildRunners = new Set<string>();

// Volatile RAM cache: Map<GuildID, Map<PlayerID, { value, quantity }>>
const guildBazaarStates = new Map<
  string,
  Map<string, { value: number; quantity: number }>
>();

/**
 * MANAGER: Runs every 60s. Looks for active guilds and spawns their isolated runner.
 */
export function startBazaarManager(): void {
  startEventDrivenRunner({
    worker: "bazaar_manager",
    defaultCadenceSeconds: 60,
    handler: async () => {
      const activeConfigs = BazaarMugConfigs.find({ is_enabled: 1 });

      for (const config of activeConfigs) {
        if (!activeGuildRunners.has(config.guild_id)) {
          logger.info(
            `Spawning isolated Bazaar Watcher for Guild ${config.guild_id}`,
          );
          activeGuildRunners.add(config.guild_id);
          spawnGuildWatcher(config.guild_id);
        }
      }
    },
  });
}

/**
 * Spawns an isolated Event-Driven Runner for a specific guild.
 */
function spawnGuildWatcher(guildId: string): void {
  const workerName = `bazaar_watcher_${guildId}`;

  startEventDrivenRunner({
    worker: workerName,
    defaultCadenceSeconds: 15, // Default rest time between full target sweeps
    handler: async () => {
      await processGuild(guildId, workerName);
    },
  });
}

/**
 * The core logic for a single guild's loop.
 */
async function processGuild(
  guildId: string,
  workerName: string,
): Promise<void> {
  const config = BazaarMugConfigs.find({ guild_id: guildId })[0];

  // Self-Destruct: If guild disables module, clean up RAM and stop the schedule
  if (!config || config.is_enabled !== 1) {
    logger.warn(`Guild ${guildId} disabled module. Spinning down worker.`);
    activeGuildRunners.delete(guildId);
    guildBazaarStates.delete(guildId);
    const schedule = WorkerSchedules.findOne(workerName);
    if (schedule) {
      schedule.enabled = false;
      WorkerSchedules.insertOne(schedule);
    }
    return;
  }

  // 1. Fetch API keys
  const encryptedKeys = GuildApiKeys.find(
    (k: GuildApiKeyDocument) => k.guild_id === guildId,
  );
  if (encryptedKeys.length === 0) return;

  const decryptedKeys = encryptedKeys.map((k: GuildApiKeyDocument) =>
    decryptApiKey(k.api_key_encrypted, ENCRYPTION_KEY),
  );
  const rotator = new ApiKeyRotator(decryptedKeys);

  // 2. Fetch targets (Watchlist JSON + Seeded Targets)
  let manualTargets: string[] = [];
  try {
    manualTargets = JSON.parse(config.target_player_ids_json || "[]");
  } catch {
    /* ignore */
  }

  const seededRows = BazaarMugTargets.find({ guild_id: guildId });
  const targetIds = Array.from(
    new Set([...manualTargets, ...seededRows.map((t) => t.player_id)]),
  );

  if (targetIds.length === 0) return;

  // Initialize RAM cache
  if (!guildBazaarStates.has(guildId))
    guildBazaarStates.set(guildId, new Map());
  const stateCache = guildBazaarStates.get(guildId)!;

  // 3. Dynamic Rate Limiting: Exact math for 50 req/min/key
  // Example: 1 key = 1.2s delay. 5 keys = 240ms delay.
  const delayMs = Math.max(
    100,
    Math.floor(60000 / (50 * decryptedKeys.length)),
  );

  const results = await rotator.processConcurrent(
    targetIds,
    async (playerId, key) => {
      try {
        const res = await tornApi.get<UserGenericResponse>("/user", {
          apiKey: key,
          queryParams: {
            selections: ["profile", "bazaar"],
            id: playerId,
          },
        });
        return { playerId, data: res, error: null };
      } catch (err) {
        return { playerId, data: null, error: err };
      }
    },
    delayMs, // ◄ Passes the dynamic delay to the rotator so it perfectly paces the requests
  );

  let requiresDashboardUpdate = false;
  const dashboardPayload: DashboardPayload[] = [];

  for (const { playerId, data, error } of results) {
    if (error || !data) continue;

    const isOnline = data.profile.last_action.status === "Online";
    const status = isOnline
      ? "Online"
      : `${data.profile.last_action.status} (${data.profile.last_action.relative})`;

    const items = data.bazaar;
    const currentVal = Array.isArray(items)
      ? items.reduce(
          (sum: number, item: BazaarResponse["bazaar"][number]) =>
            sum + Number(item.price) * Number(item.quantity),
          0,
        )
      : 0;

    const currentQty = Array.isArray(items)
      ? items.reduce(
          (sum: number, item: BazaarResponse["bazaar"][number]) =>
            sum + Number(item.quantity),
          0,
        )
      : 0;

    const previousState = stateCache.get(playerId);

    if (previousState) {
      const dropAmount = previousState.value - currentVal;

      if (dropAmount >= (config.min_bazaar_drop_threshold || 0) && !isOnline) {
        dispatchAlertToBot(
          guildId,
          playerId,
          data.profile.name,
          dropAmount,
          previousState.value,
          currentVal,
          config,
        );
      }

      if (previousState.value !== currentVal) requiresDashboardUpdate = true;
    } else {
      requiresDashboardUpdate = true;
    }

    dashboardPayload.push({
      playerId,
      name: data.profile.name,
      status,
      isOnline,
      value: currentVal,
    });

    stateCache.set(playerId, { value: currentVal, quantity: currentQty });
  }

  if (
    requiresDashboardUpdate &&
    config.dashboard_message_id &&
    config.notification_channel_id
  ) {
    dispatchDashboardUpdateToBot(guildId, config, dashboardPayload);
  }
}

function dispatchAlertToBot(
  guildId: string,
  playerId: string,
  playerName: string,
  dropAmount: number,
  pastVal: number,
  currentVal: number,
  config: BazaarMugConfigDocument,
): void {
  dispatchToBot("BAZAAR_DROP_DETECTED", {
    guildId,
    playerId,
    playerName,
    dropAmount,
    pastVal,
    currentVal,
    channelId: config.notification_channel_id,
    pingRoleId: config.ping_role_id,
  });
}

function dispatchDashboardUpdateToBot(
  guildId: string,
  config: BazaarMugConfigDocument,
  targets: DashboardPayload[],
): void {
  dispatchToBot("BAZAAR_DASHBOARD_UPDATE", {
    guildId,
    channelId: config.notification_channel_id,
    messageId: config.dashboard_message_id,
    targets,
  });
}
