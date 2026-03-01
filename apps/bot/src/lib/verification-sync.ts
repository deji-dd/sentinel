import { type Client } from "discord.js";
import {
  TABLE_NAMES,
  TornApiClient,
  getNextApiKey,
  type TornApiComponents,
} from "@sentinel/shared";
import { getGuildApiKeys } from "./guild-api-keys.js";
import { logGuildError, logGuildSuccess } from "./guild-logger.js";
import { tornApi } from "../services/torn-client.js";
import { supabase } from "./supabase.js";

type UserGenericResponse = TornApiComponents["schemas"]["UserDiscordResponse"] &
  TornApiComponents["schemas"]["UserFactionResponse"] &
  TornApiComponents["schemas"]["UserProfileResponse"];

interface FactionRoleMapping {
  guild_id: string;
  faction_id: number;
  member_role_ids: string[];
  leader_role_ids: string[];
  enabled: boolean;
}

interface GuildSyncJob {
  guild_id: string;
  last_sync_at: string | null;
  next_sync_at: string;
  in_progress: boolean;
}

interface GuildConfigRecord {
  guild_id: string;
  nickname_template: string;
  sync_interval_seconds: number;
  enabled_modules: string[];
  admin_role_ids: string[];
  verified_role_ids: string[];
  auto_verify?: boolean;
  created_at: string;
  updated_at: string;
}

/**
 * Database-driven guild sync scheduler
 * - Polls database every 60s for guilds needing sync
 * - Syncs each guild independently with its own API key
 * - Respects per-user rate limits via PerUserRateLimiter
 * - Allows guilds to customize sync interval
 */
export class GuildSyncScheduler {
  private client: Client;
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private tornApi: TornApiClient;
  private readonly POLL_INTERVAL_MS = 60 * 1000; // Poll every 60s

  constructor(client: Client) {
    this.client = client;
    // Create single tornApi instance with per-user rate limiting
    this.tornApi = tornApi;
  }

  /**
   * Start the periodic scheduler
   */
  start(): void {
    if (this.intervalId) {
      console.log("[Guild Sync] Scheduler already running");
      return;
    }

    console.log("[Guild Sync] Scheduler starting (polling every 60s)");
    this.intervalId = setInterval(() => {
      this.pollAndSync().catch((error) => {
        const msg = error instanceof Error ? error.message : String(error);
        console.error(`[Guild Sync] Scheduler error: ${msg}`);
      });
    }, this.POLL_INTERVAL_MS);

    // Run immediately on start
    this.pollAndSync().catch((error) => {
      const msg = error instanceof Error ? error.message : String(error);
      console.error(`[Guild Sync] Initial sync error: ${msg}`);
    });
  }

  /**
   * Stop the scheduler
   */
  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      console.log("[Guild Sync] Scheduler stopped");
    }
  }

  /**
   * Poll database for guilds needing sync and process them
   */
  private async pollAndSync(): Promise<void> {
    try {
      // Get all sync jobs that need to run
      const { data: jobs, error } = await supabase
        .from(TABLE_NAMES.GUILD_SYNC_JOBS)
        .select("*")
        .eq("in_progress", false)
        .lte("next_sync_at", new Date().toISOString())
        .order("next_sync_at", { ascending: true });

      if (error) {
        console.error(`[Guild Sync] Failed to fetch jobs: ${error.message}`);
        return;
      }

      if (!jobs || jobs.length === 0) {
        return;
      }

      const jobGuildIds = jobs.map((job: GuildSyncJob) => job.guild_id);
      const { data: guildConfigs, error: guildConfigError } = await supabase
        .from(TABLE_NAMES.GUILD_CONFIG)
        .select("guild_id, auto_verify")
        .in("guild_id", jobGuildIds);

      if (guildConfigError) {
        console.error(
          `[Guild Sync] Failed to fetch guild configs: ${guildConfigError.message}`,
        );
        return;
      }

      const autoVerifyGuilds = new Set(
        (guildConfigs || [])
          .filter((config) => config.auto_verify)
          .map((config) => config.guild_id),
      );

      const jobsToRun = jobs.filter((job: GuildSyncJob) =>
        autoVerifyGuilds.has(job.guild_id),
      );

      if (jobsToRun.length === 0) {
        return;
      }

      console.log(
        `[Guild Sync] Found ${jobsToRun.length} guild(s) needing sync`,
      );

      // Process each guild sequentially (one at a time)
      for (const job of jobsToRun as GuildSyncJob[]) {
        await this.syncGuild(job);
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error(`[Guild Sync] Poll error: ${msg}`);
    }
  }

  /**
   * Sync a single guild
   */
  private async syncGuild(job: GuildSyncJob): Promise<void> {
    // Lock the job
    const { error: lockError } = await supabase
      .from(TABLE_NAMES.GUILD_SYNC_JOBS)
      .update({ in_progress: true })
      .eq("guild_id", job.guild_id);

    if (lockError) {
      console.error(
        `[Guild Sync] Failed to lock job for guild ${job.guild_id}: ${lockError.message}`,
      );
      await logGuildError(
        job.guild_id,
        this.client,
        "Guild Sync Lock Failed",
        lockError.message,
        `Unable to lock sync job for guild ${job.guild_id}.`,
      );
      return;
    }

    try {
      const { data: guildConfig, error: configError } = await supabase
        .from(TABLE_NAMES.GUILD_CONFIG)
        .select("*")
        .eq("guild_id", job.guild_id)
        .single();

      if (configError || !guildConfig) {
        console.error(`[Guild Sync] Guild ${job.guild_id} config not found`);
        await logGuildError(
          job.guild_id,
          this.client,
          "Guild Auto Verification Failed",
          configError?.message || "Missing guild config",
          `Guild config not found for ${job.guild_id}.`,
        );
        return;
      }

      if (!guildConfig.auto_verify) {
        console.log(
          `[Guild Sync] Auto verification disabled for guild ${job.guild_id}. Skipping sync.`,
        );
        return;
      }

      // Get API keys from new guild-api-keys table
      const apiKeys = await getGuildApiKeys(job.guild_id);

      if (apiKeys.length === 0) {
        console.error(
          `[Guild Sync] No API keys configured (guild ${job.guild_id})`,
        );
        await logGuildError(
          job.guild_id,
          this.client,
          "Guild Auto Verification Failed",
          "No API keys configured",
          `Missing API key for guild ${job.guild_id}.`,
        );
        return;
      }

      // Get Discord guild
      const discord = this.client.guilds.cache.get(job.guild_id);
      if (!discord) {
        console.log(`[Guild Sync] Guild ${job.guild_id} not in cache`);
        await logGuildError(
          job.guild_id,
          this.client,
          "Guild Auto Verification Failed",
          "Guild not available in cache",
          `Bot is not in guild ${job.guild_id} or cache missing.`,
        );
        return;
      }

      // Fetch all guild members
      await discord.members.fetch();
      const allMembers = discord.members.cache;

      // Get faction role mappings for this guild
      const { data: factionMappings } = await supabase
        .from(TABLE_NAMES.FACTION_ROLES)
        .select("*")
        .eq("guild_id", job.guild_id);

      // Cache faction members for leader detection
      // Map: factionId -> Set of leader player IDs
      const factionLeadersCache = new Map<number, Set<number>>();

      // Fetch faction members for all mapped factions that are enabled
      if (factionMappings && factionMappings.length > 0) {
        const enabledMappings = (
          factionMappings as FactionRoleMapping[]
        ).filter((m) => m.enabled !== false && m.leader_role_ids.length > 0);

        for (const mapping of enabledMappings) {
          try {
            const membersResponse = await this.tornApi.get(
              "/faction/{id}/members",
              {
                apiKey: getNextApiKey(job.guild_id, apiKeys),
                pathParams: { id: mapping.faction_id },
              },
            );

            const leaders = new Set<number>();
            const members = membersResponse.members;

            // members is already an array, iterate directly
            for (const member of members) {
              if (
                member.position === "Leader" ||
                member.position === "Co-leader"
              ) {
                leaders.add(member.id);
              }
            }

            factionLeadersCache.set(mapping.faction_id, leaders);

            // Rate limiting delay
            await new Promise((resolve) => setTimeout(resolve, 100));
          } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            console.error(
              `[Guild Sync] Error fetching faction ${mapping.faction_id} members: ${msg}`,
            );
          }
        }
      }

      let verifiedCount = 0;
      let updatedCount = 0;
      let unchangedCount = 0;
      let removedCount = 0;
      let errorCount = 0;

      // Sync each guild member
      for (const [, member] of allMembers) {
        // Skip bots
        if (member.user.bot) {
          continue;
        }

        try {
          // Try to fetch Torn data via Discord ID
          const response = await this.tornApi.get<UserGenericResponse>(
            `/user`,
            {
              apiKey: getNextApiKey(job.guild_id, apiKeys),
              queryParams: {
                selections: ["discord", "faction", "profile"],
                id: member.id,
              },
            },
          );

          const name = response.profile.name;
          const playerId = response.profile.id;
          const factionData = response.faction;

          if (!name || !playerId) {
            console.warn(
              `[Guild Sync] Missing required fields for user ${member.id}`,
            );
            errorCount++;
            continue;
          }

          // Check if user exists in database
          const { data: existingUser } = await supabase
            .from(TABLE_NAMES.VERIFIED_USERS)
            .select("*")
            .eq("discord_id", member.id)
            .maybeSingle();

          const isNewUser = !existingUser;
          const nameChanged = existingUser && name !== existingUser.torn_name;
          const factionChanged =
            existingUser &&
            (factionData?.id !== existingUser.faction_id ||
              factionData?.tag !== existingUser.faction_tag);

          // Upsert to database
          await supabase.from(TABLE_NAMES.VERIFIED_USERS).upsert({
            discord_id: member.id,
            torn_id: playerId,
            torn_name: name,
            faction_id: factionData?.id || null,
            faction_tag: factionData?.tag || null,
            updated_at: new Date().toISOString(),
          });

          const rolesAdded: string[] = [];
          const rolesRemoved: string[] = [];

          // Always update nickname to apply current template
          const nickname = this.applyNicknameTemplate(
            (guildConfig as GuildConfigRecord).nickname_template,
            name,
            playerId,
            factionData?.tag,
          );
          await member.setNickname(nickname).catch(() => {});

          // Ensure verification role is assigned if configured
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const config = guildConfig as any;
          const verifiedRoleId = config.verified_role_id;
          if (verifiedRoleId && !member.roles.cache.has(verifiedRoleId)) {
            const addVerifiedRoleResult = await member.roles
              .add(verifiedRoleId)
              .then(() => true)
              .catch(() => false);
            if (addVerifiedRoleResult) {
              rolesAdded.push(verifiedRoleId);
            }
          }

          // Handle faction roles
          if (factionMappings && factionMappings.length > 0) {
            // If faction changed, remove old faction roles
            if (
              factionChanged &&
              existingUser &&
              existingUser.faction_id !== null
            ) {
              const oldFactionMapping = (
                factionMappings as FactionRoleMapping[]
              ).find((m) => m.faction_id === existingUser.faction_id);

              if (oldFactionMapping && oldFactionMapping.enabled !== false) {
                const oldRolesToRemove = [
                  ...oldFactionMapping.member_role_ids,
                  ...oldFactionMapping.leader_role_ids,
                ];
                if (oldRolesToRemove.length > 0) {
                  const removableRoles = oldRolesToRemove.filter((roleId) =>
                    member.roles.cache.has(roleId),
                  );

                  if (removableRoles.length > 0) {
                    const removeRolesResult = await member.roles
                      .remove(removableRoles)
                      .then(() => true)
                      .catch(() => false);
                    if (removeRolesResult) {
                      rolesRemoved.push(...removableRoles);
                    }
                  }
                }
              }
            }

            // Add current faction roles
            if (factionData?.id) {
              const factionMapping = (
                factionMappings as FactionRoleMapping[]
              ).find((m) => m.faction_id === factionData.id);

              if (factionMapping && factionMapping.enabled !== false) {
                // Determine which roles should be added
                const rolesToAdd = [...factionMapping.member_role_ids];
                const isLeader =
                  factionMapping.leader_role_ids.length > 0 &&
                  factionLeadersCache.get(factionData.id)?.has(playerId);

                if (isLeader) {
                  rolesToAdd.push(...factionMapping.leader_role_ids);
                }

                // Remove roles that user shouldn't have
                // This includes: leader roles if user is no longer a leader
                const rolesToRemoveFromCurrent = [
                  ...factionMapping.leader_role_ids,
                ].filter((roleId) => !rolesToAdd.includes(roleId));

                if (rolesToRemoveFromCurrent.length > 0) {
                  const removableRoles = rolesToRemoveFromCurrent.filter(
                    (roleId) => member.roles.cache.has(roleId),
                  );

                  if (removableRoles.length > 0) {
                    const removeResult = await member.roles
                      .remove(removableRoles)
                      .then(() => true)
                      .catch(() => false);
                    if (removeResult) {
                      rolesRemoved.push(...removableRoles);
                    }
                  }
                }

                // Add roles that user should have but doesn't
                if (rolesToAdd.length > 0) {
                  const missingRolesToAdd = rolesToAdd.filter(
                    (roleId) => !member.roles.cache.has(roleId),
                  );

                  if (missingRolesToAdd.length > 0) {
                    const addRolesResult = await member.roles
                      .add(missingRolesToAdd)
                      .then(() => true)
                      .catch(() => false);

                    if (addRolesResult) {
                      rolesAdded.push(...missingRolesToAdd);
                    }
                  }
                }
              }
            }
          }

          // Log individual verification/update for this user
          if (
            isNewUser ||
            nameChanged ||
            factionChanged ||
            rolesAdded.length > 0 ||
            rolesRemoved.length > 0
          ) {
            const logFields: Array<{
              name: string;
              value: string;
              inline: boolean;
            }> = [
              {
                name: "Torn ID",
                value: String(playerId),
                inline: true,
              },
            ];

            if (factionData) {
              logFields.push({
                name: "Faction",
                value: factionData.name || "Unknown",
                inline: true,
              });
            }

            if (rolesAdded.length > 0) {
              const rolesMention = rolesAdded
                .map((roleId) => `<@&${roleId}>`)
                .join(", ");
              logFields.push({
                name: "✅ Roles Added",
                value: rolesMention,
                inline: false,
              });
            }

            if (rolesRemoved.length > 0) {
              const rolesMention = rolesRemoved
                .map((roleId) => `<@&${roleId}>`)
                .join(", ");
              logFields.push({
                name: "❌ Roles Removed",
                value: rolesMention,
                inline: false,
              });
            }

            const actionText = isNewUser
              ? "Auto-Verified"
              : "Auto-Verification Updated";

            await logGuildSuccess(
              job.guild_id,
              this.client,
              actionText,
              `${member.user} verified as **${name}**.`,
              logFields,
            );
          }

          if (isNewUser) {
            verifiedCount++;
          } else if (nameChanged || factionChanged) {
            updatedCount++;
          } else {
            unchangedCount++;
          }

          // Rate limiting delay
          await new Promise((resolve) => setTimeout(resolve, 100));
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);

          // Check if user has no linked Torn account or disconnected
          if (/Incorrect ID/i.test(msg) || /User not found/i.test(msg)) {
            // Remove from verified_users if they were previously verified
            await supabase
              .from(TABLE_NAMES.VERIFIED_USERS)
              .delete()
              .eq("discord_id", member.id);
            continue;
          }

          console.error(`[Guild Sync] Error syncing user ${member.id}: ${msg}`);
          errorCount++;
        }
      }

      console.log(
        `[Guild Sync] Guild ${job.guild_id} sync complete: ${verifiedCount} verified, ${updatedCount} updated, ${unchangedCount} unchanged, ${removedCount} removed, ${errorCount} errors`,
      );

      if (errorCount > 0) {
        await logGuildError(
          job.guild_id,
          this.client,
          "Guild Sync Completed with Errors",
          `${errorCount} error(s) occurred during sync.`,
          `Verified: ${verifiedCount}, Updated: ${updatedCount}, Unchanged: ${unchangedCount}, Removed: ${removedCount}.`,
        );
      }
    } finally {
      // Unlock job and update next sync time
      const config = (await supabase
        .from(TABLE_NAMES.GUILD_CONFIG)
        .select("sync_interval_seconds")
        .eq("guild_id", job.guild_id)
        .single()) as { data: { sync_interval_seconds: number } | null };

      const interval = config.data?.sync_interval_seconds || 3600;
      const nextSync = new Date(Date.now() + interval * 1000);

      await supabase
        .from(TABLE_NAMES.GUILD_SYNC_JOBS)
        .update({
          in_progress: false,
          last_sync_at: new Date().toISOString(),
          next_sync_at: nextSync.toISOString(),
        })
        .eq("guild_id", job.guild_id);
    }
  }

  /**
   * Apply nickname template with variables
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
