/**
 * Mercenary Population Worker
 * Detects war state changes and makes target eligibility data available
 * Discord posting is handled by bot's mercenary population task
 */

import { TABLE_NAMES, decryptApiKey } from "@sentinel/shared";
import { getKysely } from "@sentinel/shared/db/sqlite.js";
import { startDbScheduledRunner } from "../lib/scheduler.js";
import { Logger } from "../lib/logger.js";
import { tornApi } from "../services/torn-client.js";

const db = getKysely();
const logger = new Logger("mercenary_population");

if (!process.env.ENCRYPTION_KEY) {
  throw new Error("ENCRYPTION_KEY environment variable is required");
}

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY;

interface FactionMember {
  id: number;
  name: string;
  level: number;
  status: {
    state: string;
    until?: number;
  };
  last_action?: {
    status: string;
  };
}

export function startMercenaryPopulationWorker() {
  return startDbScheduledRunner({
    worker: "mercenary_population",
    defaultCadenceSeconds: 300, // Check every 5 minutes
    handler: async () => {
      try {
        await checkAndUpdateWarStates();
        return true;
      } catch (error) {
        logger.error("Population error", error);
        return false;
      }
    },
  });
}

async function checkAndUpdateWarStates() {
  // Get all active contracts across all guilds
  const activeContracts = await getActiveMercenaryContracts();

  if (activeContracts.length === 0) {
    return;
  }

  // Group by guild and process each
  const contractsByGuild = new Map<string, typeof activeContracts>();
  for (const contract of activeContracts) {
    if (!contract.guild_id) continue;
    if (!contractsByGuild.has(contract.guild_id)) {
      contractsByGuild.set(contract.guild_id, []);
    }
    contractsByGuild.get(contract.guild_id)!.push(contract);
  }

  for (const [guildId, contracts] of contractsByGuild.entries()) {
    await processGuildContracts(guildId, contracts);
  }
}

async function processGuildContracts(
  guildId: string,
  contracts: Awaited<ReturnType<typeof getActiveMercenaryContracts>>,
) {
  const apiKey = await getPrimaryGuildApiKey(guildId);
  if (!apiKey) {
    logger.warn(`No API key for guild ${guildId}`);
    return;
  }

  for (const contract of contracts) {
    if (!contract.id) continue;
    if (!contract.faction_id) continue;

    try {
      // Check if faction is in war
      const factionInfo = await tornApi.get("/faction/{id}", {
        apiKey,
        pathParams: { id: contract.faction_id },
      });

      const inWar = factionInfo.war && factionInfo.war.war_id > 0;
      const wasInWar = contract.in_war === 1;

      // Update contract war state if changed
      if (inWar !== wasInWar) {
        const now = new Date().toISOString();
        await db
          .updateTable(TABLE_NAMES.MERCENARY_CONTRACTS)
          .set({
            in_war: inWar ? 1 : 0,
            war_start_at: inWar ? now : null,
            war_end_at: !inWar && wasInWar ? now : contract.war_end_at,
            updated_at: now,
          })
          .where("id", "=", contract.id)
          .execute()
          .catch((err: unknown) => {
            logger.error(`Failed to update contract war state`, err);
          });
      }

      // Mark that we checked this contract
      await db
        .updateTable(TABLE_NAMES.MERCENARY_CONTRACTS)
        .set({
          last_population_at: new Date().toISOString(),
        })
        .where("id", "=", contract.id)
        .execute()
        .catch((err: unknown) => {
          logger.error(`Failed to update last_population_at`, err);
        });
    } catch (error) {
      logger.error(`Failed to check faction ${contract.faction_id} war state`, error);
    }
  }
}

async function getActiveMercenaryContracts() {
  return db
    .selectFrom(TABLE_NAMES.MERCENARY_CONTRACTS)
    .selectAll()
    .where("status", "=", "active")
    .execute();
}

async function getPrimaryGuildApiKey(guildId: string): Promise<string | null> {
  const row = await db
    .selectFrom(TABLE_NAMES.GUILD_API_KEYS)
    .select(["api_key_encrypted"])
    .where("guild_id", "=", guildId)
    .where("is_primary", "=", 1)
    .where("deleted_at", "is", null)
    .limit(1)
    .executeTakeFirst();

  if (!row) {
    return null;
  }

  try {
    return decryptApiKey(row.api_key_encrypted, ENCRYPTION_KEY);
  } catch (error) {
    logger.error(`Failed to decrypt primary guild API key for ${guildId}`, error);
    return null;
  }
}
