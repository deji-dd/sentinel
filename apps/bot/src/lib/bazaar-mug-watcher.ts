import { TABLE_NAMES } from "@sentinel/shared";
import { db } from "./db-client.js";
import { getGuildApiKeys } from "./guild-api-keys.js";
import { Logger } from "./logger.js";
import { type Client, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";
import { tornApi } from "../services/torn-client.js";
import { ApiKeyRotator } from "@sentinel/shared";

const logger = new Logger("BazaarMugWatcher");

// Sleep helper function
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Helper to validate if an ID is a valid Discord Snowflake (17-20 digit numeric string)
function isValidSnowflake(id: string | null | undefined): boolean {
  return Boolean(id && /^\d{17,20}$/.test(id));
}

// Helper to parse relative last action time into minutes
function parseRelativeTimeToMinutes(relativeStr: string | null | undefined): number {
  if (!relativeStr) return 0;
  const str = relativeStr.toLowerCase();
  
  const match = str.match(/(\d+)/);
  if (!match) return 0;
  const num = parseInt(match[1], 10);
  
  if (str.includes("minute")) {
    return num;
  } else if (str.includes("hour")) {
    return num * 60;
  } else if (str.includes("day")) {
    return num * 1440;
  }
  return 0;
}

export class BazaarMugWatcher {
  private guildId: string;
  private client: Client;
  private isStopped = false;
  private muggableTargetIds: string[] = [];
  private targetBazaarValues = new Map<string, number>();
  private targetBazaarQuantities = new Map<string, number>();
  private playerMetadata = new Map<string, { name: string; level: number; state: string; lastActionStatus: string; lastAction: string; lastUpdated?: number }>();
  private currentPage = 0;

  public getBazaarScore(playerId: string): number {
    const totalValue = this.targetBazaarValues.get(playerId) ?? 0;
    const totalQuantity = this.targetBazaarQuantities.get(playerId) ?? 0;
    if (totalValue <= 0 || totalQuantity <= 0) return 0;

    // 1. Value Score (max 40)
    // log10 scale: $1M is 0, $10M is 20, $100M is 40 (clamped to 40)
    const valueScore = Math.min(40, Math.log10(Math.max(1, totalValue / 1000000)) * 20);

    // 2. Quantity Score (max 30)
    // 1 item: 30 pts, 21+ items: 0 pts
    const quantityScore = Math.max(0, 30 - (totalQuantity - 1) * 1.5);

    // 3. Status Score (max 30)
    // Base: Offline = 15 pts, Idle = 3 pts
    // Time Offline Bonus: 15 mins offline = +1 pt, max 15 pts at 225 mins offline
    const meta = this.playerMetadata.get(playerId);
    let statusScore = 0;
    if (meta) {
      const status = meta.lastActionStatus;
      const minutesOffline = parseRelativeTimeToMinutes(meta.lastAction);
      
      let basePoints = 0;
      if (status === "Offline") {
        basePoints = 15;
      } else if (status === "Idle") {
        basePoints = 3;
      }
      
      const timeBonus = Math.min(15, Math.floor(minutesOffline / 15));
      statusScore = basePoints + timeBonus;
    }

    return Math.round(Math.min(100, Math.max(0, valueScore + quantityScore + statusScore)));
  }

  constructor(guildId: string, client: Client) {
    this.guildId = guildId;
    this.client = client;
  }

  public start(): void {
    logger.info(`Starting bazaar mug watcher loops for guild ${this.guildId}`);
    void this.runFilterLoop();
    void this.runMonitorLoop();
  }

  public stop(): void {
    logger.info(`Stopping bazaar mug watcher loops for guild ${this.guildId}`);
    this.isStopped = true;
  }

  /**
   * Filter Loop (runs every 30 seconds):
   * 1. Query target list (seeded + watchlist).
   * 2. Query target profiles (status, last_action).
   * 3. Filter targets: status must be Okay, last action must not be Online.
   * 4. Keep in-memory list of muggable targets.
   * 5. Fallback channel validation, auto-disabling if none exist.
   * 6. Update the live Discord dashboard embed.
   */
  private async runFilterLoop(): Promise<void> {
    while (!this.isStopped) {
      try {
        // Fetch config from DB
        const config = await db
          .selectFrom(TABLE_NAMES.BAZAAR_MUG_CONFIG)
          .selectAll()
          .where("guild_id", "=", this.guildId)
          .executeTakeFirst();

        if (!config || config.is_enabled !== 1) {
          logger.warn(`Bazaar Mug module is disabled for guild ${this.guildId}. Stopping watcher.`);
          this.stop();
          break;
        }

        // Check channel and apply fallback logic
        let targetChannelId = config.notification_channel_id;
        let finalChannel: any = null;

        if (isValidSnowflake(targetChannelId)) {
          try {
            const guild = await this.client.guilds.fetch(this.guildId);
            const channel = await guild.channels.fetch(targetChannelId!);
            if (channel && channel.isTextBased()) {
              finalChannel = channel;
            }
          } catch (err: any) {
            const isUnknownChannel = err?.code === 10003 || err?.message?.includes("Unknown Channel");
            if (isUnknownChannel) {
              logger.warn(`Notification channel ${targetChannelId} is unknown/deleted for guild ${this.guildId}. Falling back to log channel...`);
            } else {
              throw err;
            }
          }
        }

        if (!finalChannel) {
          const guildConfig = await db
            .selectFrom(TABLE_NAMES.GUILD_CONFIG)
            .select(["log_channel_id"])
            .where("guild_id", "=", this.guildId)
            .executeTakeFirst();
          const logChannelId = guildConfig?.log_channel_id || null;

          if (isValidSnowflake(logChannelId)) {
            try {
              const guild = await this.client.guilds.fetch(this.guildId);
              const channel = await guild.channels.fetch(logChannelId!);
              if (channel && channel.isTextBased()) {
                finalChannel = channel;
                targetChannelId = logChannelId;
              }
            } catch (err: any) {
              const isUnknownChannel = err?.code === 10003 || err?.message?.includes("Unknown Channel");
              if (isUnknownChannel) {
                logger.warn(`Fallback log channel ${logChannelId} is also unknown/deleted.`);
              } else {
                throw err;
              }
            }
          }
        }

        if (!finalChannel) {
          logger.warn(`Bazaar Mug disabled: no valid notification or log channel configured (or channels were deleted/unknown) for guild ${this.guildId}`);
          await db
            .updateTable(TABLE_NAMES.BAZAAR_MUG_CONFIG)
            .set({ is_enabled: 0 })
            .where("guild_id", "=", this.guildId)
            .execute();
          this.stop();
          break;
        }

        // Fetch manual target watchlist
        let watchlist: string[] = [];
        if (config.target_player_ids_json) {
          try {
            watchlist = JSON.parse(config.target_player_ids_json);
          } catch {
            watchlist = [];
          }
        }

        // Fetch automated seeded targets
        const seededRows = await db
          .selectFrom(TABLE_NAMES.BAZAAR_MUG_TARGETS)
          .select(["player_id"])
          .where("guild_id", "=", this.guildId)
          .execute();

        const seededIds = seededRows.map((r) => r.player_id);

        // Merge targets uniquely
        const targetIds = Array.from(new Set([...watchlist, ...seededIds]));

        if (targetIds.length === 0) {
          this.muggableTargetIds = [];
          this.playerMetadata.clear();
          logger.debug(`No targets configured for guild ${this.guildId}. Filter list is empty.`);
          await this.updateLiveDashboard([], config, targetChannelId);
        } else {
          // Fetch API keys
          const apiKeys = await getGuildApiKeys(this.guildId);
          if (apiKeys.length === 0) {
            logger.warn(`No API keys configured for guild ${this.guildId}. Clearing muggable targets list.`);
            this.muggableTargetIds = [];
            this.playerMetadata.clear();
            await this.updateLiveDashboard([], config, targetChannelId);
          } else {
            // Check profiles and icons using ApiKeyRotator concurrently
            const rotator = new ApiKeyRotator(apiKeys);
            const profiles = await rotator.processConcurrent(
              targetIds,
              async (playerId, key) => {
                try {
                  const res = await tornApi.getRaw<any>(
                    `/user/${playerId}`,
                    key,
                    { selections: "profile,icons" }
                  );
                  return {
                    playerId,
                    name: res.name || "Unknown",
                    level: res.level || 0,
                    state: res.status?.state || "Unknown",
                    lastActionStatus: res.last_action?.status || "Unknown",
                    lastActionRelative: res.last_action?.relative || "Unknown",
                    icons: res.icons || {},
                    error: null
                  };
                } catch (err) {
                  return {
                    playerId,
                    name: "Unknown",
                    level: 0,
                    state: "Unknown",
                    lastActionStatus: "Unknown",
                    lastActionRelative: "Unknown",
                    icons: {},
                    error: err
                  };
                }
              },
              50
            );

            // Filter targets and update metadata map
            const validIds: string[] = [];
            const oldMetadata = new Map(this.playerMetadata);
            this.playerMetadata.clear();

            for (const item of profiles) {
              if (!item.error) {
                let hasBazaar = false;
                if (item.icons) {
                  if (Array.isArray(item.icons)) {
                    hasBazaar = item.icons.some((icon: any) => icon.id === 35 || icon.title === "Bazaar");
                  } else if (typeof item.icons === "object") {
                    hasBazaar = Object.prototype.hasOwnProperty.call(item.icons, "icon35") ||
                                Object.values(item.icons).includes("Items in bazaar") ||
                                Object.keys(item.icons).some(k => k === "35" || k === "icon35");
                  }
                }

                const existingMeta = oldMetadata.get(item.playerId);
                this.playerMetadata.set(item.playerId, {
                  name: item.name,
                  level: item.level,
                  state: item.state,
                  lastActionStatus: item.lastActionStatus,
                  lastAction: item.lastActionRelative,
                  lastUpdated: existingMeta?.lastUpdated ?? Date.now()
                });

                // State must be Okay, status must NOT be Online, must have open/active bazaar, and must meet minimum offline/idle time threshold
                const minutesOffline = parseRelativeTimeToMinutes(item.lastActionRelative);
                const minOfflineThreshold = config.min_offline_time_minutes ?? 0;

                let isOfflineLongEnough = true;
                if (item.lastActionStatus === "Offline" || item.lastActionStatus === "Idle") {
                  if (minutesOffline < minOfflineThreshold) {
                    isOfflineLongEnough = false;
                  }
                }

                if (
                  item.state === "Okay" &&
                  item.lastActionStatus !== "Online" &&
                  isOfflineLongEnough &&
                  hasBazaar
                ) {
                  validIds.push(item.playerId);
                }
              }
            }

            this.muggableTargetIds = validIds;
            logger.debug(`Refreshed targets list for guild ${this.guildId}. Total: ${targetIds.length}, Muggable: ${validIds.length}`);

            // Clean up cache for targets no longer monitored
            const targetSet = new Set(targetIds);
            for (const key of this.targetBazaarValues.keys()) {
              if (!targetSet.has(key)) {
                this.targetBazaarValues.delete(key);
                this.targetBazaarQuantities.delete(key);
              }
            }

            // Update persistent live dashboard
            await this.updateLiveDashboard(validIds, config, targetChannelId);
          }
        }
      } catch (error) {
        logger.error(`Error in target filter loop for guild ${this.guildId}:`, error);
      }

      // Wait 30 seconds before next sync
      for (let i = 0; i < 30 && !this.isStopped; i++) {
        await sleep(1000);
      }
    }
  }

  /**
   * Monitor Loop:
   * 1. Check valid target bazaars.
   * 2. Sum bazaar value.
   * 3. Track value drops and alert if drop >= threshold.
   */
  private async runMonitorLoop(): Promise<void> {
    while (!this.isStopped) {
      try {
        const apiKeys = await getGuildApiKeys(this.guildId);

        if (apiKeys.length === 0 || this.muggableTargetIds.length === 0) {
          await sleep(5000);
          continue;
        }

        const config = await db
          .selectFrom(TABLE_NAMES.BAZAAR_MUG_CONFIG)
          .selectAll()
          .where("guild_id", "=", this.guildId)
          .executeTakeFirst();

        let targetChannelId = config?.notification_channel_id;
        if (config && !isValidSnowflake(targetChannelId)) {
          const guildConfig = await db
            .selectFrom(TABLE_NAMES.GUILD_CONFIG)
            .select(["log_channel_id"])
            .where("guild_id", "=", this.guildId)
            .executeTakeFirst();
          targetChannelId = guildConfig?.log_channel_id || null;
        }

        if (!config || !isValidSnowflake(targetChannelId)) {
          await sleep(5000);
          continue;
        }

        const threshold = config.min_bazaar_drop_threshold;
        const rotator = new ApiKeyRotator(apiKeys);

        // Rate limit calculation: maximum of 50 requests/min per key
        const delayMs = Math.max(100, Math.floor(60000 / (50 * apiKeys.length)));

        const targetsToCheck = [...this.muggableTargetIds];

        for (const playerId of targetsToCheck) {
          if (this.isStopped) break;

          const key = rotator.getNextKey();
          try {
            const res = await tornApi.getRaw<any>(`/user/${playerId}`, key, { selections: "bazaar" });

            if (res && res.bazaar) {
              const items = res.bazaar || [];
              const currentVal = Array.isArray(items)
                ? items.reduce((sum: number, item: any) => sum + (Number(item.price || 0) * Number(item.quantity || 0)), 0)
                : 0;

              const totalQty = Array.isArray(items)
                ? items.reduce((sum: number, item: any) => sum + Number(item.quantity || 0), 0)
                : 0;

              const pastVal = this.targetBazaarValues.get(playerId);
              const pastQty = this.targetBazaarQuantities.get(playerId);
              let valueChanged = false;

              if (pastVal !== undefined) {
                if (pastVal !== currentVal || pastQty !== totalQty) {
                  valueChanged = true;
                }
                const delta = pastVal - currentVal;
                if (delta >= threshold) {
                  // Perform final check to see if target has come online
                  let isOnline = false;
                  try {
                    const profileRes = await tornApi.getRaw<any>(
                      `/user/${playerId}`,
                      key,
                      { selections: "profile" }
                    );
                    if (profileRes?.last_action?.status === "Online") {
                      isOnline = true;
                    }
                  } catch (profileErr) {
                    logger.debug(`Failed to fetch final profile for player ${playerId} during alert check: ${profileErr}`);
                  }

                  if (!isOnline) {
                    await this.sendAlert(playerId, delta, pastVal, currentVal, targetChannelId, config);
                  } else {
                    logger.info(`Player ${playerId} came ONLINE during alert check. Suppressing bazaar drop alert.`);
                  }
                }
              } else {
                valueChanged = true;
              }

              // Update last checked timestamp
              const meta = this.playerMetadata.get(playerId);
              if (meta) {
                meta.lastUpdated = Date.now();
              }

              this.targetBazaarValues.set(playerId, currentVal);
              this.targetBazaarQuantities.set(playerId, totalQty);

              if (valueChanged) {
                await this.updateLiveDashboard(this.muggableTargetIds, config, targetChannelId);
              }
            }
          } catch (err) {
            logger.debug(`Failed to fetch bazaar value for player ${playerId}: ${err instanceof Error ? err.message : err}`);
          }

          await sleep(delayMs);
        }
      } catch (error) {
        logger.error(`Error in bazaar monitor loop for guild ${this.guildId}:`, error);
        await sleep(5000);
      }
    }
  }

  private async updateLiveDashboard(
    validIds: string[],
    config: any,
    channelId: string
  ): Promise<void> {
    if (!isValidSnowflake(channelId)) return;

    try {
      const filteredIds = validIds.filter((id) => {
        const val = this.targetBazaarValues.get(id);
        return val === undefined || val >= config.min_bazaar_drop_threshold;
      });

      // Sort by score descending (undefined/Scanning at the bottom)
      filteredIds.sort((a, b) => {
        const isScanningA = this.targetBazaarValues.get(a) === undefined;
        const isScanningB = this.targetBazaarValues.get(b) === undefined;
        if (isScanningA && !isScanningB) return 1;
        if (!isScanningA && isScanningB) return -1;
        if (isScanningA && isScanningB) return 0;

        const scoreA = this.getBazaarScore(a);
        const scoreB = this.getBazaarScore(b);
        return scoreB - scoreA;
      });

      const itemsPerPage = 4;
      const totalPages = Math.max(1, Math.ceil(filteredIds.length / itemsPerPage));
      if (this.currentPage >= totalPages) {
        this.currentPage = totalPages - 1;
      }
      if (this.currentPage < 0) {
        this.currentPage = 0;
      }

      const startIndex = this.currentPage * itemsPerPage;
      const pageIds = filteredIds.slice(startIndex, startIndex + itemsPerPage);

      let targetListStr = "";
      if (filteredIds.length === 0) {
        targetListStr = "No muggable targets found. All monitored players are currently online, traveling, hospitalized, jailed, or have bazaar values below the threshold.";
      } else {
        targetListStr = pageIds
          .map((id) => {
            const meta = this.playerMetadata.get(id);
            const currentVal = this.targetBazaarValues.get(id);
            const isScanning = currentVal === undefined;
            const scoreVal = isScanning ? undefined : this.getBazaarScore(id);
            const valueStr = !isScanning
              ? (currentVal > 0 ? `$${currentVal.toLocaleString()}` : "$0")
              : "Scanning...";
            const scoreStr = scoreVal !== undefined ? ` \u2022 Score: **${scoreVal}**` : "";
            const nameStr = meta ? meta.name : "Unknown";
            const statusStr = meta ? `${meta.lastActionStatus} (${meta.lastAction})` : "Unknown";
            const checkedStr = meta?.lastUpdated ? `<t:${Math.floor(meta.lastUpdated / 1000)}:R>` : "Pending";
            return `[${nameStr} [${id}]](https://www.torn.com/profiles.php?XID=${id}) \u2022 [Attack](https://www.torn.com/loader.php?sid=attack&user2ID=${id})\n${statusStr} \u2022 ${valueStr}${scoreStr} \u2022 Checked ${checkedStr}`;
          })
          .join("\n\n");
      }

      const embed = new EmbedBuilder()
        .setColor(0x3b82f6)
        .setTitle(`Bazaar Mug Live Dashboard`)
        .setDescription(`Monitoring **${this.playerMetadata.size}** players \u2022 **${filteredIds.length}** muggable (offline/idle)\nPage **${this.currentPage + 1}**/${totalPages}`)
        .addFields(
          { name: "Targets", value: targetListStr.slice(0, 1023) }
        )
        .setFooter({ text: "Sentinel" })
        .setTimestamp();

      const components: any[] = [];
      if (totalPages > 1) {
        const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder()
            .setCustomId(`bazaar_mug_page_prev|${this.guildId}`)
            .setLabel("Previous Page")
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(this.currentPage === 0),
          new ButtonBuilder()
            .setCustomId(`bazaar_mug_page_next|${this.guildId}`)
            .setLabel("Next Page")
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(this.currentPage === totalPages - 1)
        );
        components.push(row);
      }

      let dashboardMsgId = config.dashboard_message_id;
      let messageSent = false;
      let shouldRepost = false;

      if (dashboardMsgId) {
        try {
          const guild = await this.client.guilds.fetch(this.guildId);
          const channel = await guild.channels.fetch(channelId);
          if (channel && channel.isTextBased()) {
            // Check if there is a newer message in the channel
            try {
              const messages = await channel.messages.fetch({ limit: 1 });
              const lastMessage = messages.first();
              if (lastMessage && lastMessage.id !== dashboardMsgId) {
                shouldRepost = true;
              }
            } catch (err) {
              logger.debug(`Failed to fetch last message to check for reposting: ${err}`);
            }

            if (!shouldRepost) {
              const existingMsg = await channel.messages.fetch(dashboardMsgId);
              await existingMsg.edit({ embeds: [embed], components });
              messageSent = true;
            } else {
              // Delete the old dashboard message so we can post a new one at the bottom
              try {
                const existingMsg = await channel.messages.fetch(dashboardMsgId);
                await existingMsg.delete();
              } catch (delErr) {
                logger.debug(`Failed to delete old dashboard message: ${delErr}`);
              }
            }
          }
        } catch (err: any) {
          if (err?.code === 10003 || err?.message?.includes("Unknown Channel")) {
            logger.warn(`Bazaar Mug disabled: channel ${channelId} is unknown/deleted for guild ${this.guildId}`);
            await db
              .updateTable(TABLE_NAMES.BAZAAR_MUG_CONFIG)
              .set({ is_enabled: 0 })
              .where("guild_id", "=", this.guildId)
              .execute();
            this.stop();
            return;
          }
          // Retry editing once on network socket error (if not reposting)
          if (!shouldRepost) {
            const isNetworkError = err instanceof Error && (err.message.includes("closed") || err.message.includes("socket") || err.message.includes("fetch"));
            if (isNetworkError) {
              logger.warn(`Network error editing dashboard message, retrying in 1s...`);
              await sleep(1000);
              try {
                const guild = await this.client.guilds.fetch(this.guildId);
                const channel = await guild.channels.fetch(channelId);
                if (channel && channel.isTextBased()) {
                  const existingMsg = await channel.messages.fetch(dashboardMsgId);
                  await existingMsg.edit({ embeds: [embed], components });
                  messageSent = true;
                }
              } catch (retryErr: any) {
                if (retryErr?.code === 10003 || retryErr?.message?.includes("Unknown Channel")) {
                  logger.warn(`Bazaar Mug disabled: channel ${channelId} is unknown/deleted for guild ${this.guildId}`);
                  await db
                    .updateTable(TABLE_NAMES.BAZAAR_MUG_CONFIG)
                    .set({ is_enabled: 0 })
                    .where("guild_id", "=", this.guildId)
                    .execute();
                  this.stop();
                  return;
                }
                logger.debug(`Failed to edit dashboard message on retry: ${retryErr}`);
              }
            } else {
              logger.debug(`Failed to edit existing dashboard message ${dashboardMsgId}, sending a new one: ${err}`);
            }
          }
        }
      }

      if (!messageSent) {
        try {
          const guild = await this.client.guilds.fetch(this.guildId);
          const channel = await guild.channels.fetch(channelId);
          if (channel && channel.isTextBased()) {
            const newMsg = await channel.send({ embeds: [embed], components });
            await db
              .updateTable(TABLE_NAMES.BAZAAR_MUG_CONFIG)
              .set({ dashboard_message_id: newMsg.id })
              .where("guild_id", "=", this.guildId)
              .execute();
            config.dashboard_message_id = newMsg.id;
            messageSent = true;
          }
        } catch (err: any) {
          if (err?.code === 10003 || err?.message?.includes("Unknown Channel")) {
            logger.warn(`Bazaar Mug disabled: channel ${channelId} is unknown/deleted for guild ${this.guildId}`);
            await db
              .updateTable(TABLE_NAMES.BAZAAR_MUG_CONFIG)
              .set({ is_enabled: 0 })
              .where("guild_id", "=", this.guildId)
              .execute();
            this.stop();
            return;
          }
          // Retry sending once on network socket error
          const isNetworkError = err instanceof Error && (err.message.includes("closed") || err.message.includes("socket") || err.message.includes("fetch"));
          if (isNetworkError) {
            logger.warn(`Network error sending new dashboard message, retrying in 1s...`);
            await sleep(1000);
            try {
              const guild = await this.client.guilds.fetch(this.guildId);
              const channel = await guild.channels.fetch(channelId);
              if (channel && channel.isTextBased()) {
                const newMsg = await channel.send({ embeds: [embed], components });
                await db
                  .updateTable(TABLE_NAMES.BAZAAR_MUG_CONFIG)
                  .set({ dashboard_message_id: newMsg.id })
                  .where("guild_id", "=", this.guildId)
                  .execute();
                config.dashboard_message_id = newMsg.id;
              }
            } catch (retryErr: any) {
              if (retryErr?.code === 10003 || retryErr?.message?.includes("Unknown Channel")) {
                logger.warn(`Bazaar Mug disabled: channel ${channelId} is unknown/deleted for guild ${this.guildId}`);
                await db
                  .updateTable(TABLE_NAMES.BAZAAR_MUG_CONFIG)
                  .set({ is_enabled: 0 })
                  .where("guild_id", "=", this.guildId)
                  .execute();
                this.stop();
                return;
              }
              logger.error(`Failed to send new live dashboard message for guild ${this.guildId} on retry:`, retryErr);
            }
          } else {
            logger.error(`Failed to send new live dashboard message for guild ${this.guildId}:`, err);
          }
        }
      }
    } catch (error) {
      logger.error(`Error updating live dashboard for guild ${this.guildId}:`, error);
    }
  }

  private async sendAlert(
    playerId: string,
    delta: number,
    pastVal: number,
    currentVal: number,
    channelId: string,
    config: { ping_role_id: string | null }
  ): Promise<void> {
    if (!isValidSnowflake(channelId)) return;

    logger.info(`Triggering alert: Player ${playerId} bazaar dropped by $${delta.toLocaleString()} ($${pastVal.toLocaleString()} -> $${currentVal.toLocaleString()})`);

    const roleId = config.ping_role_id;

    let content = "";
    if (roleId) {
      content = `<@&${roleId}>`;
    }

    const embed = new EmbedBuilder()
      .setColor(0xef4444)
      .setTitle("Bazaar Value Drop Alert")
      .setDescription("A target player's bazaar value has decreased significantly.")
      .addFields(
        { name: "Target ID", value: playerId, inline: true },
        { name: "Bazaar Value Drop", value: `$${delta.toLocaleString()}`, inline: true },
        { name: "Current Value", value: `$${currentVal.toLocaleString()}`, inline: true },
        { name: "Previous Value", value: `$${pastVal.toLocaleString()}`, inline: true },
        { name: "Links", value: `[Attack Target](https://www.torn.com/loader.php?sid=attack&user2ID=${playerId}) | [Torn Profile](https://www.torn.com/profiles.php?XID=${playerId})`, inline: false }
      )
      .setFooter({ text: "Sentinel" })
      .setTimestamp();

    try {
      const guild = await this.client.guilds.fetch(this.guildId);
      const channel = await guild.channels.fetch(channelId);
      if (channel && channel.isTextBased()) {
        const sentMsg = await channel.send({
          content: content || undefined,
          embeds: [embed]
        });

        // Auto-delete alert after 3 minutes to avoid channel flooding
        setTimeout(() => {
          sentMsg.delete().catch((err) => {
            logger.debug(`Failed to auto-delete alert message ${sentMsg.id}: ${err instanceof Error ? err.message : err}`);
          });
        }, 180000); // 3 minutes
      }
    } catch (err: any) {
      const isUnknownChannel = err?.code === 10003 || err?.message?.includes("Unknown Channel");
      if (isUnknownChannel) {
        logger.warn(`Unknown Channel in sendAlert for guild ${this.guildId}. Disabling module...`);
        await db
          .updateTable(TABLE_NAMES.BAZAAR_MUG_CONFIG)
          .set({ is_enabled: 0 })
          .where("guild_id", "=", this.guildId)
          .execute();
        this.stop();
      } else {
        logger.error(`Failed to dispatch alert message to channel ${channelId} for guild ${this.guildId}:`, err);
      }
    }
  }

  public async changePage(interaction: any, direction: number): Promise<void> {
    try {
      const config = await db
        .selectFrom(TABLE_NAMES.BAZAAR_MUG_CONFIG)
        .selectAll()
        .where("guild_id", "=", this.guildId)
        .executeTakeFirst();

      if (!config || config.is_enabled !== 1) {
        await interaction.reply({ content: "This module is disabled.", ephemeral: true });
        return;
      }

      let targetChannelId = config.notification_channel_id;
      if (!isValidSnowflake(targetChannelId)) {
        const guildConfig = await db
          .selectFrom(TABLE_NAMES.GUILD_CONFIG)
          .select(["log_channel_id"])
          .where("guild_id", "=", this.guildId)
          .executeTakeFirst();
        targetChannelId = guildConfig?.log_channel_id || null;
      }

      if (!isValidSnowflake(targetChannelId)) {
        await interaction.reply({ content: "No valid channel configured.", ephemeral: true });
        return;
      }

      const filteredIds = this.muggableTargetIds.filter((id) => {
        const val = this.targetBazaarValues.get(id);
        return val === undefined || val >= config.min_bazaar_drop_threshold;
      });

      // Sort by score descending (undefined/Scanning at the bottom)
      filteredIds.sort((a, b) => {
        const isScanningA = this.targetBazaarValues.get(a) === undefined;
        const isScanningB = this.targetBazaarValues.get(b) === undefined;
        if (isScanningA && !isScanningB) return 1;
        if (!isScanningA && isScanningB) return -1;
        if (isScanningA && isScanningB) return 0;

        const scoreA = this.getBazaarScore(a);
        const scoreB = this.getBazaarScore(b);
        return scoreB - scoreA;
      });

      const itemsPerPage = 4;
      const totalPages = Math.max(1, Math.ceil(filteredIds.length / itemsPerPage));
      
      this.currentPage += direction;
      if (this.currentPage >= totalPages) {
        this.currentPage = totalPages - 1;
      }
      if (this.currentPage < 0) {
        this.currentPage = 0;
      }

      const startIndex = this.currentPage * itemsPerPage;
      const pageIds = filteredIds.slice(startIndex, startIndex + itemsPerPage);

      let targetListStr = "";
      if (filteredIds.length === 0) {
        targetListStr = "No muggable targets found. All monitored players are currently online, traveling, hospitalized, jailed, or have bazaar values below the threshold.";
      } else {
        targetListStr = pageIds
          .map((id) => {
            const meta = this.playerMetadata.get(id);
            const currentVal = this.targetBazaarValues.get(id);
            const isScanning = currentVal === undefined;
            const scoreVal = isScanning ? undefined : this.getBazaarScore(id);
            const valueStr = !isScanning
              ? (currentVal > 0 ? `$${currentVal.toLocaleString()}` : "$0")
              : "Scanning...";
            const scoreStr = scoreVal !== undefined ? ` \u2022 Score: **${scoreVal}**` : "";
            const nameStr = meta ? meta.name : "Unknown";
            const statusStr = meta ? `${meta.lastActionStatus} (${meta.lastAction})` : "Unknown";
            const checkedStr = meta?.lastUpdated ? `<t:${Math.floor(meta.lastUpdated / 1000)}:R>` : "Pending";
            return `[${nameStr} [${id}]](https://www.torn.com/profiles.php?XID=${id}) \u2022 [Attack](https://www.torn.com/loader.php?sid=attack&user2ID=${id})\n${statusStr} \u2022 ${valueStr}${scoreStr} \u2022 Checked ${checkedStr}`;
          })
          .join("\n\n");
      }

      const embed = new EmbedBuilder()
        .setColor(0x3b82f6)
        .setTitle(`Bazaar Mug Live Dashboard`)
        .setDescription(`Monitoring **${this.playerMetadata.size}** players \u2022 **${filteredIds.length}** muggable (offline/idle)\nPage **${this.currentPage + 1}**/${totalPages}`)
        .addFields(
          { name: "Targets", value: targetListStr.slice(0, 1023) }
        )
        .setFooter({ text: "Sentinel" })
        .setTimestamp();

      const components: any[] = [];
      if (totalPages > 1) {
        const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder()
            .setCustomId(`bazaar_mug_page_prev|${this.guildId}`)
            .setLabel("Previous Page")
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(this.currentPage === 0),
          new ButtonBuilder()
            .setCustomId(`bazaar_mug_page_next|${this.guildId}`)
            .setLabel("Next Page")
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(this.currentPage === totalPages - 1)
        );
        components.push(row);
      }

      await interaction.update({ embeds: [embed], components });
    } catch (err) {
      logger.error(`Error handling page change button interaction:`, err);
    }
  }
}

export const activeWatchers = new Map<string, BazaarMugWatcher>();

export async function startBazaarMugWatcher(guildId: string, client: Client): Promise<void> {
  const existing = activeWatchers.get(guildId);
  if (existing) {
    existing.stop();
  }

  const watcher = new BazaarMugWatcher(guildId, client);
  activeWatchers.set(guildId, watcher);
  watcher.start();
}

export async function stopBazaarMugWatcher(guildId: string): Promise<void> {
  const existing = activeWatchers.get(guildId);
  if (existing) {
    existing.stop();
    activeWatchers.delete(guildId);
  }
}
