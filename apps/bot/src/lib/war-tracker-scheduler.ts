/**
 * Territory war tracker scheduler
 * Updates tracked war displays at a high cadence per guild
 */

import { EmbedBuilder, type Client } from "discord.js";
import { supabase } from "./supabase.js";
import { TABLE_NAMES, getFactionNameCached } from "@sentinel/shared";
import { getGuildApiKeys } from "./guild-api-keys.js";
import {
  buildWarTrackerEmbed,
  fetchActiveTerritoryWars,
  resolveEnemyUsers,
  type TerritoryWarWithTerritory,
} from "./war-tracker.js";
import { tornApi } from "../services/torn-client.js";

const POLL_INTERVAL_MS = 5000;

interface WarTrackerRow {
  guild_id: string;
  war_id: number;
  territory_id: string;
  channel_id: string | null;
  message_id: string | null;
  enemy_side: "assaulting" | "defending";
  min_away_minutes: number;
}

async function getActiveApiKey(guildId: string): Promise<string | null> {
  const apiKeys = await getGuildApiKeys(guildId);
  return apiKeys.length > 0 ? apiKeys[0] : null;
}

function buildEndedEmbed(territoryId: string): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(0xf59e0b)
    .setTitle(`⚔️ ${territoryId} War Ended`)
    .setDescription("This war is no longer active. Tracking disabled.");
}

export class WarTrackerScheduler {
  private client: Client;
  private intervalId: ReturnType<typeof setInterval> | null = null;

  constructor(client: Client) {
    this.client = client;
  }

  start(): void {
    if (this.intervalId) {
      return;
    }

    this.intervalId = setInterval(() => {
      this.pollAndUpdate().catch((error) => {
        console.error(`[War Tracker] Scheduler error:`, error);
      });
    }, POLL_INTERVAL_MS);

    this.pollAndUpdate().catch((error) => {
      console.error(`[War Tracker] Initial sync error:`, error);
    });
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  private async pollAndUpdate(): Promise<void> {
    const { data: trackers, error } = await supabase
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
      const apiKey = await getActiveApiKey(guildId);
      if (!apiKey) {
        continue;
      }

      const warMap = await fetchActiveTerritoryWars(apiKey);

      for (const tracker of guildTrackers) {
        const war = warMap.get(tracker.war_id);
        if (!war) {
          await this.handleWarEnded(tracker);
          continue;
        }

        const assaultingName =
          (await getFactionNameCached(
            supabase,
            war.assaulting_faction,
            tornApi,
            apiKey,
          )) || `Faction ${war.assaulting_faction}`;
        const defendingName =
          (await getFactionNameCached(
            supabase,
            war.defending_faction,
            tornApi,
            apiKey,
          )) || `Faction ${war.defending_faction}`;

        const enemyFactionId =
          tracker.enemy_side === "assaulting"
            ? war.assaulting_faction
            : war.defending_faction;
        const enemyIds =
          tracker.enemy_side === "assaulting" ? war.assaulters : war.defenders;

        const enemyUsers = await resolveEnemyUsers(
          apiKey,
          enemyFactionId,
          enemyIds,
          tracker.min_away_minutes,
        );

        await this.updateTrackerMessage(
          tracker,
          war,
          assaultingName,
          defendingName,
          war.assaulting_faction,
          war.defending_faction,
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
    assaultingFactionId: number,
    defendingFactionId: number,
    enemyUsers: string[],
  ): Promise<void> {
    if (!tracker.channel_id) {
      return;
    }

    const channel = await this.client.channels
      .fetch(tracker.channel_id)
      .catch(() => null);
    if (!channel || !channel.isTextBased() || !("send" in channel)) {
      return;
    }

    const embed = buildWarTrackerEmbed(war, {
      assaultingName,
      defendingName,
      assaultingFactionId,
      defendingFactionId,
      enemySide: tracker.enemy_side,
      enemyUsers,
      minAwayMinutes: tracker.min_away_minutes,
      territoryId: tracker.territory_id,
      lastUpdated: new Date(),
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
      await supabase
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
      await supabase
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

    await supabase
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
