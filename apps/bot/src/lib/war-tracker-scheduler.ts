/**
 * Territory war tracker scheduler
 * Updates tracked war displays at a high cadence per guild
 */

import { EmbedBuilder, type Client } from "discord.js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { TABLE_NAMES, getFactionNameCached } from "@sentinel/shared";
import { decrypt } from "./encryption.js";
import { botTornApi } from "./torn-api.js";
import {
  buildWarTrackerEmbed,
  fetchActiveTerritoryWars,
  type TerritoryWarWithTerritory,
} from "./war-tracker.js";

const POLL_INTERVAL_MS = 5000;

interface ApiKeyEntry {
  key: string; // encrypted
  isActive: boolean;
}

interface WarTrackerRow {
  guild_id: string;
  war_id: number;
  territory_id: string;
  channel_id: string | null;
  message_id: string | null;
  enemy_side: "assaulting" | "defending";
  min_away_minutes: number;
}

interface FactionMember {
  id: number;
  name: string;
  is_on_wall: boolean;
  last_action: { timestamp: number };
}

async function getActiveApiKey(
  supabase: SupabaseClient,
  guildId: string,
): Promise<string | null> {
  const { data: guildConfig } = await supabase
    .from(TABLE_NAMES.GUILD_CONFIG)
    .select("api_keys")
    .eq("guild_id", guildId)
    .single();

  const apiKeys: ApiKeyEntry[] = guildConfig?.api_keys || [];
  const activeKey = apiKeys.find((key) => key.isActive);
  if (!activeKey) {
    return null;
  }

  try {
    return decrypt(activeKey.key);
  } catch (error) {
    console.warn("Failed to decrypt API key for war tracker:", error);
    return null;
  }
}

async function fetchFactionMembers(
  apiKey: string,
  factionId: number,
): Promise<FactionMember[]> {
  const response = await botTornApi.get("/faction/{id}/members", {
    apiKey,
    pathParams: { id: String(factionId) },
  });

  if ("error" in response) {
    return [];
  }

  return (response.members || []) as FactionMember[];
}

function buildEnemyUsers(
  members: FactionMember[],
  enemyIds: number[],
  minAwayMinutes: number,
): string[] {
  const enemyIdSet = new Set(enemyIds);
  const filtered = members.filter((member) => {
    if (!member.is_on_wall) {
      return false;
    }

    if (!enemyIdSet.has(member.id)) {
      return false;
    }

    if (minAwayMinutes <= 0) {
      return true;
    }

    const awayMinutes = Math.floor(
      (Date.now() - member.last_action.timestamp * 1000) / 60000,
    );
    return awayMinutes >= minAwayMinutes;
  });

  return filtered.map((member) => {
    const awayMinutes = Math.max(
      0,
      Math.floor((Date.now() - member.last_action.timestamp * 1000) / 60000),
    );
    return `${member.name} (${awayMinutes}m)`;
  });
}

function buildEndedEmbed(territoryId: string): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(0xf59e0b)
    .setTitle(`⚔️ ${territoryId} War Ended`)
    .setDescription("This war is no longer active. Tracking disabled.");
}

export class WarTrackerScheduler {
  private client: Client;
  private supabase: SupabaseClient;
  private intervalId: ReturnType<typeof setInterval> | null = null;

  constructor(client: Client, supabase: SupabaseClient) {
    this.client = client;
    this.supabase = supabase;
  }

  start(): void {
    if (this.intervalId) {
      return;
    }

    this.intervalId = setInterval(() => {
      this.pollAndUpdate().catch((error) => {
        const msg = error instanceof Error ? error.message : String(error);
        console.error(`[War Tracker] Scheduler error: ${msg}`);
      });
    }, POLL_INTERVAL_MS);

    this.pollAndUpdate().catch((error) => {
      const msg = error instanceof Error ? error.message : String(error);
      console.error(`[War Tracker] Initial sync error: ${msg}`);
    });
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  private async pollAndUpdate(): Promise<void> {
    const { data: trackers, error } = await this.supabase
      .from(TABLE_NAMES.WAR_TRACKERS)
      .select(
        "guild_id, war_id, territory_id, channel_id, message_id, enemy_side, min_away_minutes",
      )
      .not("channel_id", "is", null);

    if (error || !trackers || trackers.length === 0) {
      return;
    }

    const trackersByGuild = new Map<string, WarTrackerRow[]>();
    for (const tracker of trackers as WarTrackerRow[]) {
      if (!trackersByGuild.has(tracker.guild_id)) {
        trackersByGuild.set(tracker.guild_id, []);
      }
      trackersByGuild.get(tracker.guild_id)!.push(tracker);
    }

    for (const [guildId, guildTrackers] of trackersByGuild.entries()) {
      const apiKey = await getActiveApiKey(this.supabase, guildId);
      if (!apiKey) {
        continue;
      }

      const warMap = await fetchActiveTerritoryWars(apiKey, botTornApi);
      const membersCache = new Map<number, FactionMember[]>();

      for (const tracker of guildTrackers) {
        const war = warMap.get(tracker.war_id);
        if (!war) {
          await this.handleWarEnded(tracker);
          continue;
        }

        const assaultingName =
          (await getFactionNameCached(
            this.supabase,
            war.assaulting_faction,
            botTornApi,
            apiKey,
          )) || `Faction ${war.assaulting_faction}`;
        const defendingName =
          (await getFactionNameCached(
            this.supabase,
            war.defending_faction,
            botTornApi,
            apiKey,
          )) || `Faction ${war.defending_faction}`;

        const enemyFactionId =
          tracker.enemy_side === "assaulting"
            ? war.assaulting_faction
            : war.defending_faction;
        const enemyIds =
          tracker.enemy_side === "assaulting" ? war.assaulters : war.defenders;

        let members = membersCache.get(enemyFactionId);
        if (!members) {
          members = await fetchFactionMembers(apiKey, enemyFactionId);
          membersCache.set(enemyFactionId, members);
        }

        const enemyUsers = buildEnemyUsers(
          members,
          enemyIds,
          tracker.min_away_minutes,
        );

        await this.updateTrackerMessage(
          tracker,
          war,
          assaultingName,
          defendingName,
          enemyUsers,
        );
      }
    }
  }

  private async updateTrackerMessage(
    tracker: WarTrackerRow,
    war: TerritoryWarWithTerritory,
    assaultingName: string,
    defendingName: string,
    enemyUsers: string[],
  ): Promise<void> {
    if (!tracker.channel_id) {
      return;
    }

    const channel = await this.client.channels
      .fetch(tracker.channel_id)
      .catch(() => null);
    if (!channel || !channel.isTextBased()) {
      return;
    }

    const embed = buildWarTrackerEmbed(war, {
      assaultingName,
      defendingName,
      enemySide: tracker.enemy_side,
      enemyUsers,
      minAwayMinutes: tracker.min_away_minutes,
      territoryId: tracker.territory_id,
    });

    if (tracker.message_id) {
      const message = await channel.messages
        .fetch(tracker.message_id)
        .catch(() => null);
      if (message) {
        await message.edit({ embeds: [embed] }).catch(() => {});
        return;
      }
    }

    const newMessage = await channel
      .send({ embeds: [embed] })
      .catch(() => null);
    if (newMessage) {
      await this.supabase
        .from(TABLE_NAMES.WAR_TRACKERS)
        .update({
          message_id: newMessage.id,
          updated_at: new Date().toISOString(),
        })
        .eq("guild_id", tracker.guild_id)
        .eq("war_id", tracker.war_id);
    }
  }

  private async handleWarEnded(tracker: WarTrackerRow): Promise<void> {
    if (!tracker.channel_id || !tracker.message_id) {
      await this.supabase
        .from(TABLE_NAMES.WAR_TRACKERS)
        .update({
          channel_id: null,
          message_id: null,
          updated_at: new Date().toISOString(),
        })
        .eq("guild_id", tracker.guild_id)
        .eq("war_id", tracker.war_id);
      return;
    }

    const channel = await this.client.channels
      .fetch(tracker.channel_id)
      .catch(() => null);
    if (channel && channel.isTextBased()) {
      const message = await channel.messages
        .fetch(tracker.message_id)
        .catch(() => null);
      if (message) {
        await message.edit({
          embeds: [buildEndedEmbed(tracker.territory_id)],
        });
      }
    }

    await this.supabase
      .from(TABLE_NAMES.WAR_TRACKERS)
      .update({
        channel_id: null,
        message_id: null,
        updated_at: new Date().toISOString(),
      })
      .eq("guild_id", tracker.guild_id)
      .eq("war_id", tracker.war_id);
  }
}
