/* eslint-disable @typescript-eslint/no-explicit-any */
import { TABLE_NAMES } from "@sentinel/shared";
import { db } from "./db-client.js";
import { getPrimaryGuildApiKey } from "./guild-api-keys.js";
import { Logger } from "./logger.js";
import { type Client } from "discord.js";
import { tornApi } from "../services/torn-client.js";

const logger = new Logger("BazaarMugSeed");

export async function runBazaarMugSeedSync(client: Client, guildId: string): Promise<void> {
  logger.info(`Running Bazaar Mug Seeding Sync for guild ${guildId}`);

  // 1. Check if the module is enabled in configuration
  const config = await db
    .selectFrom(TABLE_NAMES.BAZAAR_MUG_CONFIG)
    .select(["is_enabled"])
    .where("guild_id", "=", guildId)
    .executeTakeFirst();

  if (!config || config.is_enabled !== 1) {
    logger.warn(`Bazaar Mug module is not enabled for guild ${guildId}, skipping target seeding`);
    return;
  }

  // 2. Fetch the primary API key for the guild
  const apiKey = await getPrimaryGuildApiKey(guildId);
  if (!apiKey) {
    logger.warn(`No primary API key found for guild ${guildId}, skipping target seeding`);
    return;
  }

  try {
    // 3. Query Torn API /market/bazaar (Public selection)
    logger.info(`Fetching bazaar directory from Torn API for guild ${guildId}`);
    const response = await tornApi.get("/market/bazaar", { apiKey });

    if (!response || !response.bazaar) {
      throw new Error("Invalid Torn API response: missing 'bazaar' field in bazaar response");
    }

    const bazaar = response.bazaar;

    // Check if the response is of type BazaarWeekly (which has the busiest, most_popular, etc keys)
    if (!("busiest" in bazaar)) {
      throw new Error("Invalid Torn API response: response is not of type BazaarWeekly");
    }

    const categories = [
      { key: "busiest", source: "busiest" },
      { key: "most_popular", source: "most_popular" },
      { key: "trending", source: "trending" },
      { key: "top_grossing", source: "top_grossing" },
      { key: "bulk", source: "bulk" },
      { key: "advanced_item", source: "advanced_item" },
    ] as const;

    const targetMap = new Map<string, { player_name: string | null; source: string }>();

    for (const cat of categories) {
      const list = (bazaar as any)[cat.key];
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
              targetMap.set(playerId, { player_name: playerName, source: cat.source });
            }
          }
        }
      }
    }

    const now = new Date().toISOString();

    // 4. Update the database in a transaction
    logger.info(`Found ${targetMap.size} unique bazaar targets. Saving to database...`);

    await db.transaction().execute(async (trx) => {
      // Delete old targets for this guild
      await trx
        .deleteFrom(TABLE_NAMES.BAZAAR_MUG_TARGETS)
        .where("guild_id", "=", guildId)
        .execute();

      // Insert new targets in batches
      if (targetMap.size > 0) {
        const rows = Array.from(targetMap.entries()).map(([playerId, data]) => ({
          guild_id: guildId,
          player_id: playerId,
          player_name: data.player_name,
          source: data.source,
          created_at: now,
          updated_at: now,
        }));

        const batchSize = 100;
        for (let i = 0; i < rows.length; i += batchSize) {
          const batch = rows.slice(i, i + batchSize);
          await trx
            .insertInto(TABLE_NAMES.BAZAAR_MUG_TARGETS)
            .values(batch)
            .execute();
        }
      }
    });

    logger.info(`Successfully seeded ${targetMap.size} bazaar targets for guild ${guildId}`);
  } catch (error) {
    logger.error(`Error during bazaar target seeding for guild ${guildId}:`, error);
    throw error;
  }
}
