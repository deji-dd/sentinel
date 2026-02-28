import { type Client } from "discord.js";
import { type SupabaseClient } from "@supabase/supabase-js";
import {
  TABLE_NAMES,
  PerUserRateLimiter,
  TornApiClient,
} from "@sentinel/shared";
import { getGuildApiKeys } from "./guild-api-keys.js";
import { logGuildError, logGuildSuccess } from "./guild-logger.js";

// Local round-robin tracker per guild
const guildKeyIndices = new Map<string, number>();
function getNextApiKey(guildId: string, keys: string[]): string {
  const currentIndex = guildKeyIndices.get(guildId) || 0;
  const apiKey = keys[currentIndex];
  guildKeyIndices.set(guildId, (currentIndex + 1) % keys.length);
  return apiKey;
}

interface VerifiedUser {
  discord_id: string;
  torn_player_id: number;
  torn_player_name: string;
  faction_id: number | null;
  faction_name: string | null;
}

interface FactionRoleMapping {
  guild_id: string;
  faction_id: number;
  member_role_ids: string[];
  leader_role_ids: string[];
  enabled: boolean;
}

interface FactionMember {
  player_id: number;
  name: string;
  position: string;
}

interface GuildSyncJob {
  guild_id: string;
  last_sync_at: string | null;
  next_sync_at: string;
  in_progress: boolean;
}

interface GuildConfigRecord {
  guild_id: string;
  api_key?: string | null;
  api_keys?: { key?: string; isActive?: boolean }[] | null;
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
  private supabase: SupabaseClient;
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private rateLimiter: PerUserRateLimiter;
  private readonly POLL_INTERVAL_MS = 60 * 1000; // Poll every 60s

  constructor(client: Client, supabase: SupabaseClient) {
    this.client = client;
    this.supabase = supabase;
    this.rateLimiter = new PerUserRateLimiter({
      supabase,
      tableName: TABLE_NAMES.RATE_LIMIT_REQUESTS_PER_USER,
      apiKeyMappingTableName: TABLE_NAMES.API_KEY_USER_MAPPING,
      hashPepper: process.env.API_KEY_HASH_PEPPER!,
      // Uses RATE_LIMITING.MAX_REQUESTS_PER_MINUTE from constants (50 req/min per user)
    });
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
      const { data: jobs, error } = await this.supabase
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
      const { data: guildConfigs, error: guildConfigError } =
        await this.supabase
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
    const { error: lockError } = await this.supabase
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
        this.supabase,
        "Guild Sync Lock Failed",
        lockError.message,
        `Unable to lock sync job for guild ${job.guild_id}.`,
      );
      return;
    }

    try {
      const { data: guildConfig, error: configError } = await this.supabase
        .from(TABLE_NAMES.GUILD_CONFIG)
        .select("*")
        .eq("guild_id", job.guild_id)
        .single();

      if (configError || !guildConfig) {
        console.error(`[Guild Sync] Guild ${job.guild_id} config not found`);
        await logGuildError(
          job.guild_id,
          this.client,
          this.supabase,
          "Guild Sync Failed",
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

      await logGuildSuccess(
        job.guild_id,
        this.client,
        this.supabase,
        "Guild Sync Started",
        "Scheduled verification sync started.",
      );

      // Get API keys from new guild-api-keys table
      const apiKeys = await getGuildApiKeys(this.supabase, job.guild_id);

      if (apiKeys.length === 0) {
        console.error(
          `[Guild Sync] No API keys configured (guild ${job.guild_id})`,
        );
        await logGuildError(
          job.guild_id,
          this.client,
          this.supabase,
          "Guild Sync Failed",
          "No API keys configured",
          `Missing API key for guild ${job.guild_id}.`,
        );
        return;
      }

      // Get all verified users
      const { data: verifiedUsers, error: usersError } = await this.supabase
        .from(TABLE_NAMES.VERIFIED_USERS)
        .select("*");

      if (usersError || !verifiedUsers) {
        console.error(
          `[Guild Sync] Failed to fetch verified users: ${usersError?.message}`,
        );
        await logGuildError(
          job.guild_id,
          this.client,
          this.supabase,
          "Guild Sync Failed",
          usersError?.message || "Failed to fetch verified users",
          `Unable to fetch verified users for guild ${job.guild_id}.`,
        );
        return;
      }

      // Get faction role mappings for this guild
      const { data: factionMappings } = await this.supabase
        .from(TABLE_NAMES.FACTION_ROLES)
        .select("*")
        .eq("guild_id", job.guild_id);

      // Cache faction members for leader detection
      // Map: factionId -> Set of leader player IDs
      const factionLeadersCache = new Map<number, Set<number>>();
      
      // Fetch faction members for all mapped factions that are enabled
      if (factionMappings && factionMappings.length > 0) {
        const enabledMappings = (factionMappings as FactionRoleMapping[]).filter(
          (m) => m.enabled !== false && m.leader_role_ids.length > 0
        );
        
        for (const mapping of enabledMappings) {
          try {
            const membersResponse = await tornApi.get("/faction/{id}/members", {
              apiKey: getNextApiKey(job.guild_id, apiKeys),
              pathParams: { id: String(mapping.faction_id) },
            });
            
            if ("members" in membersResponse && membersResponse.members) {
              const leaders = new Set<number>();
              const members = membersResponse.members as Record<string, FactionMember>;
              
              for (const member of Object.values(members)) {
                if (member.position === "Leader" || member.position === "Co-leader") {
                  leaders.add(member.player_id);
                }
              }
              
              factionLeadersCache.set(mapping.faction_id, leaders);
            }
            
            // Rate limiting delay
            await new Promise((resolve) => setTimeout(resolve, 100));
          } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            console.error(
              `[Guild Sync] Error fetching faction ${mapping.faction_id} members: ${msg}`
            );
          }
        }
      }

      const discord = this.client.guilds.cache.get(job.guild_id);
      if (!discord) {
        console.log(`[Guild Sync] Guild ${job.guild_id} not in cache`);
        await logGuildError(
          job.guild_id,
          this.client,
          this.supabase,
          "Guild Sync Failed",
          "Guild not available in cache",
          `Bot is not in guild ${job.guild_id} or cache missing.`,
        );
        return;
      }

      // Create Torn API client with per-guild rate limiting
      const tornApi = new TornApiClient({
        rateLimitTracker: this.rateLimiter,
      });

      let updatedCount = 0;
      let unchangedCount = 0;
      let removedCount = 0;
      let errorCount = 0;

      // Sync each verified user
      for (const user of verifiedUsers as VerifiedUser[]) {
        try {
          // Use generic any type since response shape is dynamic based on selections parameter
          const response = await tornApi.get(`/user`, {
            apiKey: getNextApiKey(job.guild_id, apiKeys),
            queryParams: {
              selections: ["discord", "faction", "profile"],
              id: user.discord_id,
            },
          });

          // Handle API error - check if response has error property
          if ("error" in response) {
            const error = response as unknown as {
              error: { code: number; error: string };
            };
            if (error.error.code === 6) {
              console.log(
                `[Guild Sync] User ${user.discord_id} disconnected Discord`,
              );
              await this.supabase
                .from(TABLE_NAMES.VERIFIED_USERS)
                .delete()
                .eq("discord_id", user.discord_id);
              removedCount++;
              continue;
            }

            console.warn(
              `[Guild Sync] API error for ${user.discord_id}: ${error.error.error}`,
            );
            errorCount++;
            continue;
          }

          // Response shape is dynamic based on selections, so use property access without type assertion
          const data = response as Record<string, unknown>;
          const profile =
            (data.profile as Record<string, unknown> | undefined) || {};
          const name = profile.name as string | undefined;
          const playerId = profile.id as number | undefined;
          const factionData = data.faction as
            | {
                id?: number;
                name?: string;
                tag?: string;
              }
            | undefined;

          if (!name || !playerId) {
            console.warn(
              `[Guild Sync] Missing required fields for user ${user.discord_id}`,
            );
            errorCount++;
            continue;
          }

          // Check if anything changed
          const nameChanged = name !== user.torn_player_name;
          const factionChanged =
            factionData?.id !== user.faction_id ||
            factionData?.name !== user.faction_name;

          // Always update database and Discord if name or faction changed
          if (nameChanged || factionChanged) {
            await this.supabase
              .from(TABLE_NAMES.VERIFIED_USERS)
              .update({
                torn_player_name: name,
                faction_id: factionData?.id || null,
                faction_name: factionData?.name || null,
                verified_at: new Date().toISOString(),
              })
              .eq("discord_id", user.discord_id);
          }

          // ALWAYS update Discord member (nickname template might have changed)
          const member = await discord.members
            .fetch(user.discord_id)
            .catch(() => null);
          if (member) {
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
              await member.roles.add(verifiedRoleId).catch(() => {});
            }

            // Update faction roles if faction changed
            if (
              factionChanged &&
              factionMappings &&
              factionMappings.length > 0
            ) {
              const oldFactionMapping = (
                factionMappings as FactionRoleMapping[]
              ).find((m) => m.faction_id === user.faction_id);
              const newFactionMapping = (
                factionMappings as FactionRoleMapping[]
              ).find((m) => m.faction_id === factionData?.id);

              // Remove old faction roles (both member and leader roles)
              if (oldFactionMapping && oldFactionMapping.enabled !== false) {
                const oldRolesToRemove = [
                  ...oldFactionMapping.member_role_ids,
                  ...oldFactionMapping.leader_role_ids,
                ];
                if (oldRolesToRemove.length > 0) {
                  await member.roles
                    .remove(oldRolesToRemove)
                    .catch(() => {});
                }
              }

              // Add new faction roles
              if (newFactionMapping && newFactionMapping.enabled !== false) {
                const rolesToAdd = [...newFactionMapping.member_role_ids];
                
                // Check if user is a leader and add leader roles
                if (
                  newFactionMapping.leader_role_ids.length > 0 &&
                  playerId &&
                  factionData?.id
                ) {
                  const leaders = factionLeadersCache.get(factionData.id);
                  if (leaders && leaders.has(playerId)) {
                    rolesToAdd.push(...newFactionMapping.leader_role_ids);
                  }
                }
                
                if (rolesToAdd.length > 0) {
                  await member.roles
                    .add(rolesToAdd)
                    .catch(() => {});
                }
              }
            }
          }

          if (nameChanged || factionChanged) {
            updatedCount++;
          } else {
            unchangedCount++;
          }

          // Rate limiting delay
          await new Promise((resolve) => setTimeout(resolve, 100));
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          console.error(
            `[Guild Sync] Error syncing user ${user.discord_id}: ${msg}`,
          );
          errorCount++;
        }
      }

      console.log(
        `[Guild Sync] Guild ${job.guild_id} sync complete: ${updatedCount} updated, ${unchangedCount} unchanged, ${removedCount} removed, ${errorCount} errors`,
      );

      if (errorCount > 0) {
        await logGuildError(
          job.guild_id,
          this.client,
          this.supabase,
          "Guild Sync Completed with Errors",
          `${errorCount} error(s) occurred during sync.`,
          `Updated: ${updatedCount}, Unchanged: ${unchangedCount}, Removed: ${removedCount}.`,
        );
      } else {
        await logGuildSuccess(
          job.guild_id,
          this.client,
          this.supabase,
          "Guild Sync Completed",
          `Updated: ${updatedCount}, Unchanged: ${unchangedCount}, Removed: ${removedCount}.`,
        );
      }
    } finally {
      // Unlock job and update next sync time
      const config = (await this.supabase
        .from(TABLE_NAMES.GUILD_CONFIG)
        .select("sync_interval_seconds")
        .eq("guild_id", job.guild_id)
        .single()) as { data: { sync_interval_seconds: number } | null };

      const interval = config.data?.sync_interval_seconds || 3600;
      const nextSync = new Date(Date.now() + interval * 1000);

      await this.supabase
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
