import { type Client, type GuildMember } from "discord.js";
import { type SupabaseClient } from "@supabase/supabase-js";
import { TABLE_NAMES } from "@sentinel/shared";
import { decrypt } from "./encryption.js";
import { botTornApi } from "./torn-api.js";

interface VerifiedUser {
  discord_id: string;
  torn_player_id: number;
  torn_player_name: string;
  faction_id: number | null;
  faction_name: string | null;
}

interface GuildConfig {
  guild_id: string;
  api_key: string;
  nickname_template: string;
}

interface FactionRoleMapping {
  guild_id: string;
  faction_id: number;
  role_ids: string[];
}

/**
 * Periodic verification sync service
 * - Checks if users have changed their Torn name or faction
 * - Updates Discord nicknames based on current template
 * - Assigns/removes faction roles based on current mappings
 * - Handles users who have disconnected their Discord account
 */
export class VerificationSyncService {
  private client: Client;
  private supabase: SupabaseClient;
  private intervalId: ReturnType<typeof setTimeout> | null = null;
  private readonly SYNC_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

  constructor(client: Client, supabase: SupabaseClient) {
    this.client = client;
    this.supabase = supabase;
  }

  /**
   * Start the periodic sync
   */
  start(): void {
    if (this.intervalId) {
      console.log("[Verification Sync] Already running");
      return;
    }

    console.log(
      `[Verification Sync] Starting (interval: ${this.SYNC_INTERVAL_MS / 1000}s)`,
    );

    // Run immediately on start
    this.sync().catch((error) =>
      console.error("[Verification Sync] Initial sync failed:", error),
    );

    // Then run periodically
    this.intervalId = setInterval(() => {
      this.sync().catch((error) =>
        console.error("[Verification Sync] Sync failed:", error),
      );
    }, this.SYNC_INTERVAL_MS);
  }

  /**
   * Stop the periodic sync
   */
  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      console.log("[Verification Sync] Stopped");
    }
  }

  /**
   * Run a single sync cycle
   */
  private async sync(): Promise<void> {
    console.log("[Verification Sync] Starting sync cycle");

    try {
      // Get all verified users
      const { data: verifiedUsers, error: usersError } = await this.supabase
        .from(TABLE_NAMES.VERIFIED_USERS)
        .select("*");

      if (usersError) {
        console.error(
          "[Verification Sync] Failed to fetch verified users:",
          usersError.message,
        );
        return;
      }

      if (!verifiedUsers || verifiedUsers.length === 0) {
        console.log("[Verification Sync] No verified users to sync");
        return;
      }

      console.log(
        `[Verification Sync] Syncing ${verifiedUsers.length} verified users`,
      );

      // Get all guild configs with API keys
      const { data: guildConfigs, error: configsError } = await this.supabase
        .from(TABLE_NAMES.GUILD_CONFIG)
        .select("guild_id, api_key, nickname_template")
        .not("api_key", "is", null);

      if (configsError) {
        console.error(
          "[Verification Sync] Failed to fetch guild configs:",
          configsError.message,
        );
        return;
      }

      if (!guildConfigs || guildConfigs.length === 0) {
        console.log("[Verification Sync] No guilds with API keys configured");
        return;
      }

      // Get all faction role mappings
      const { data: factionMappings } = await this.supabase
        .from(TABLE_NAMES.FACTION_ROLES)
        .select("*");

      // Process each guild
      for (const guild of guildConfigs as GuildConfig[]) {
        await this.syncGuild(
          guild,
          verifiedUsers as VerifiedUser[],
          (factionMappings as FactionRoleMapping[]) || [],
        );
      }

      console.log("[Verification Sync] Sync cycle completed");
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error("[Verification Sync] Unexpected error:", errorMsg);
    }
  }

  /**
   * Sync all users in a specific guild
   */
  private async syncGuild(
    guildConfig: GuildConfig,
    verifiedUsers: VerifiedUser[],
    allFactionMappings: FactionRoleMapping[],
  ): Promise<void> {
    try {
      // Decrypt API key
      let apiKey: string;
      try {
        apiKey = decrypt(guildConfig.api_key);
      } catch {
        console.error(
          `[Verification Sync] Failed to decrypt API key for guild ${guildConfig.guild_id}`,
        );
        return;
      }

      // Get Discord guild
      const guild = await this.client.guilds.fetch(guildConfig.guild_id);
      if (!guild) {
        console.error(
          `[Verification Sync] Could not fetch guild ${guildConfig.guild_id}`,
        );
        return;
      }

      // Fetch all guild members
      const members = await guild.members.fetch();

      // Get faction role mappings for this guild
      const guildFactionMappings = allFactionMappings.filter(
        (m) => m.guild_id === guildConfig.guild_id,
      );

      let updatedCount = 0;
      let unchangedCount = 0;
      let removedCount = 0;

      // Process each verified user that's in this guild
      for (const user of verifiedUsers) {
        const member = members.get(user.discord_id);
        if (!member) {
          // User not in this guild
          continue;
        }

        try {
          // Call Torn API to get current user data
          const response = await botTornApi.get(`/user/${user.discord_id}`, {
            apiKey,
            queryParams: { selections: "discord,faction,profile" },
          });

          // Handle user who disconnected Discord
          if (response.error?.code === 6) {
            console.log(
              `[Verification Sync] User ${user.torn_player_name} [${user.torn_player_id}] disconnected Discord`,
            );

            // Remove from verified users
            await this.supabase
              .from(TABLE_NAMES.VERIFIED_USERS)
              .delete()
              .eq("discord_id", user.discord_id);

            removedCount++;
            continue;
          }

          if (response.error) {
            console.error(
              `[Verification Sync] Torn API error for ${user.discord_id}: ${response.error.error}`,
            );
            continue;
          }

          // Check if anything changed
          const nameChanged = response.name !== user.torn_player_name;
          const factionChanged =
            response.faction?.faction_id !== user.faction_id;

          if (nameChanged || factionChanged) {
            console.log(
              `[Verification Sync] Updating ${member.user.username}: ${nameChanged ? "name" : ""}${nameChanged && factionChanged ? " and " : ""}${factionChanged ? "faction" : ""}`,
            );

            // Update database
            await this.supabase
              .from(TABLE_NAMES.VERIFIED_USERS)
              .update({
                torn_player_name: response.name,
                faction_id: response.faction?.faction_id || null,
                faction_name: response.faction?.faction_name || null,
                verified_at: new Date().toISOString(),
              })
              .eq("discord_id", user.discord_id);

            // Update Discord nickname
            await this.updateNickname(
              member,
              guildConfig.nickname_template,
              response.name,
              response.player_id,
              response.faction?.faction_tag,
            );

            // Update faction roles if faction changed
            if (factionChanged) {
              await this.updateFactionRoles(
                member,
                user.faction_id,
                response.faction?.faction_id || null,
                guildFactionMappings,
              );
            }

            updatedCount++;
          } else {
            // Even if data hasn't changed, check if nickname needs updating
            // (in case template changed)
            await this.updateNickname(
              member,
              guildConfig.nickname_template,
              response.name,
              response.player_id,
              response.faction?.faction_tag,
            );

            unchangedCount++;
          }

          // Small delay to avoid rate limiting
          await new Promise((resolve) => setTimeout(resolve, 200));
        } catch (error) {
          const errorMsg =
            error instanceof Error ? error.message : String(error);
          console.error(
            `[Verification Sync] Error syncing user ${user.discord_id}: ${errorMsg}`,
          );
        }
      }

      console.log(
        `[Verification Sync] Guild ${guild.name}: ${updatedCount} updated, ${unchangedCount} unchanged, ${removedCount} removed`,
      );
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(
        `[Verification Sync] Error syncing guild ${guildConfig.guild_id}: ${errorMsg}`,
      );
    }
  }

  /**
   * Update member nickname based on template
   */
  private async updateNickname(
    member: GuildMember,
    template: string,
    name: string,
    tornId: number,
    factionTag?: string,
  ): Promise<void> {
    try {
      const newNickname = this.applyNicknameTemplate(
        template,
        name,
        tornId,
        factionTag,
      );

      // Only update if different
      if (member.nickname !== newNickname) {
        await member.setNickname(newNickname);
        console.log(
          `[Verification Sync] Updated nickname for ${member.user.username}: ${newNickname}`,
        );
      }
    } catch (error) {
      console.error(
        `[Verification Sync] Failed to update nickname for ${member.user.username}:`,
        error,
      );
    }
  }

  /**
   * Update faction roles when user changes faction
   */
  private async updateFactionRoles(
    member: GuildMember,
    oldFactionId: number | null,
    newFactionId: number | null,
    guildFactionMappings: FactionRoleMapping[],
  ): Promise<void> {
    try {
      // Remove old faction roles
      if (oldFactionId) {
        const oldMapping = guildFactionMappings.find(
          (m) => m.faction_id === oldFactionId,
        );
        if (oldMapping && oldMapping.role_ids.length > 0) {
          await member.roles.remove(oldMapping.role_ids);
          console.log(
            `[Verification Sync] Removed old faction roles for ${member.user.username}`,
          );
        }
      }

      // Add new faction roles
      if (newFactionId) {
        const newMapping = guildFactionMappings.find(
          (m) => m.faction_id === newFactionId,
        );
        if (newMapping && newMapping.role_ids.length > 0) {
          await member.roles.add(newMapping.role_ids);
          console.log(
            `[Verification Sync] Added new faction roles for ${member.user.username}`,
          );
        }
      }
    } catch (error) {
      console.error(
        `[Verification Sync] Failed to update faction roles for ${member.user.username}:`,
        error,
      );
    }
  }

  /**
   * Apply nickname template with variable substitution
   */
  private applyNicknameTemplate(
    template: string,
    name: string,
    id: number,
    factionTag?: string,
  ): string {
    return template
      .replace("{name}", name)
      .replace("{id}", id.toString())
      .replace("{tag}", factionTag || "");
  }
}
