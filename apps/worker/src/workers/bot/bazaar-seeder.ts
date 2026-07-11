import {
  Logger,
  BazaarMugConfigs,
  BazaarMugTargets,
  GuildApiKeys,
  tornApi,
  decryptApiKey,
  GuildApiKeyDocument,
} from "@sentinel/shared";
import { startEventDrivenRunner } from "../../lib/scheduler.js";
import { randomUUID } from "crypto";

const WORKER_NAME = "bazaar_seeder";
const logger = new Logger(WORKER_NAME);
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY!;

async function runBazaarSeeder(): Promise<void> {
  const activeConfigs = BazaarMugConfigs.find({ is_enabled: 1 });
  if (activeConfigs.length === 0) return;

  logger.info(
    `Running Bazaar target seeder for ${activeConfigs.length} active guilds.`,
  );

  for (const config of activeConfigs) {
    const guildId = config.guild_id;

    // 1. Get a valid guild API key
    const encryptedKeys = GuildApiKeys.find(
      (k: GuildApiKeyDocument) => k.guild_id === guildId,
    );
    if (encryptedKeys.length === 0) {
      logger.warn(`No API keys found for Guild ${guildId}. Skipping seeder.`);
      continue;
    }
    const apiKey = decryptApiKey(
      encryptedKeys[0].api_key_encrypted,
      ENCRYPTION_KEY,
    );

    try {
      // 2. Fetch the market/bazaar directory
      const response = await tornApi.get("/market/bazaar", {
        apiKey,
      });
      const bazaar = response.bazaar;

      if (!bazaar || !("busiest" in bazaar)) {
        logger.warn(`Invalid Torn API response for guild ${guildId} seeder.`);
        continue;
      }

      const categories = [
        { key: "busiest", source: "busiest" },
        { key: "most_popular", source: "most_popular" },
        { key: "trending", source: "trending" },
        { key: "top_grossing", source: "top_grossing" },
        { key: "bulk", source: "bulk" },
        { key: "advanced_item", source: "advanced_item" },
      ] as const;

      const targetMap = new Map<
        string,
        { player_name: string | null; source: string }
      >();

      // 3. Extract targets and deduplicate categories
      for (const cat of categories) {
        const list = bazaar[cat.key];
        if (Array.isArray(list)) {
          for (const item of list) {
            if (item && item.id) {
              const playerId = String(item.id);
              const playerName = item.name || null;
              const existing = targetMap.get(playerId);

              if (existing) {
                if (!existing.source.includes(cat.source)) {
                  existing.source = `${existing.source}, ${cat.source}`;
                }
              } else {
                targetMap.set(playerId, {
                  player_name: playerName,
                  source: cat.source,
                });
              }
            }
          }
        }
      }

      if (targetMap.size === 0) continue;

      // 4. Wipe old DB targets and insert new ones
      // Find and delete all old seeded targets for this guild natively in C++
      BazaarMugTargets.deleteManyBy({ guild_id: guildId });

      // Prepare new documents
      const now = new Date().toISOString();
      const docsToInsert = Array.from(targetMap.entries()).map(
        ([playerId, data]) => ({
          id: randomUUID(),
          guild_id: guildId,
          player_id: playerId,
          player_name: data.player_name,
          source: data.source,
          created_at: now,
          updated_at: now,
        }),
      );

      BazaarMugTargets.insertMany(docsToInsert);
      logger.info(
        `Successfully seeded ${docsToInsert.length} targets for guild ${guildId}`,
      );
    } catch (error) {
      logger.error(`Error seeding bazaar targets for guild ${guildId}:`, error);
    }
  }
}

/**
 * Initializes the automated target seeder
 */
export function startBazaarSeeder(): void {
  // Run once every 6 hours
  const SIX_HOURS_SECONDS = 21600;

  startEventDrivenRunner({
    worker: WORKER_NAME,
    defaultCadenceSeconds: SIX_HOURS_SECONDS,
    handler: async () => {
      await runBazaarSeeder();
    },
  });
}
