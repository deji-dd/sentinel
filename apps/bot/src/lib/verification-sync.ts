import { type Client } from "discord.js";
import { type SupabaseClient } from "@supabase/supabase-js";
import {
  TABLE_NAMES,
  DatabaseRateLimiter,
  TornApiClient,
} from "@sentinel/shared";
import { getNextApiKey, resolveApiKeysForGuild } from "./api-keys.js";

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
  role_ids: string[];
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
  created_at: string;
  updated_at: string;
}

/**
 * Database-driven guild sync scheduler
 * - Polls database every 60s for guilds needing sync
 * - Syncs each guild independently with its own API key
 * - Respects per-guild rate limits via DatabaseRateLimiter
 * - Allows guilds to customize sync interval
 */
export class GuildSyncScheduler {
  private client: Client;
  private supabase: SupabaseClient;
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private rateLimiter: DatabaseRateLimiter;
  private readonly POLL_INTERVAL_MS = 60 * 1000; // Poll every 60s

  constructor(client: Client, supabase: SupabaseClient) {
    this.client = client;
    this.supabase = supabase;
    this.rateLimiter = new DatabaseRateLimiter({
      supabase,
      tableName: TABLE_NAMES.RATE_LIMIT_REQUESTS_PER_USER,
      hashPepper: process.env.API_KEY_HASH_PEPPER!,
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

      console.log(`[Guild Sync] Found ${jobs.length} guild(s) needing sync`);

      // Process each guild sequentially (one at a time)
      for (const job of jobs as GuildSyncJob[]) {
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
        return;
      }

      const { keys: apiKeys, error: apiKeyError } = resolveApiKeysForGuild(
        job.guild_id,
        guildConfig as GuildConfigRecord,
      );

      if (apiKeyError) {
        console.error(`[Guild Sync] ${apiKeyError} (guild ${job.guild_id})`);
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
        return;
      }

      // Get faction role mappings for this guild
      const { data: factionMappings } = await this.supabase
        .from(TABLE_NAMES.FACTION_ROLES)
        .select("*")
        .eq("guild_id", job.guild_id);

      const discord = this.client.guilds.cache.get(job.guild_id);
      if (!discord) {
        console.log(`[Guild Sync] Guild ${job.guild_id} not in cache`);
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
          const response = await tornApi.get(`/user/${user.discord_id}`, {
            apiKey: getNextApiKey(job.guild_id, apiKeys),
            queryParams: { selections: "discord,faction,profile" },
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
          const name = data.name as string | undefined;
          const playerId = data.player_id as number | undefined;
          const factionData = data.faction as
            | {
                faction_id?: number;
                faction_name?: string;
                faction_tag?: string;
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
            factionData?.faction_id !== user.faction_id ||
            factionData?.faction_name !== user.faction_name;

          if (nameChanged || factionChanged) {
            // Update database
            await this.supabase
              .from(TABLE_NAMES.VERIFIED_USERS)
              .update({
                torn_player_name: name,
                faction_id: factionData?.faction_id || null,
                faction_name: factionData?.faction_name || null,
                verified_at: new Date().toISOString(),
              })
              .eq("discord_id", user.discord_id);

            // Update Discord member if in guild
            const member = await discord.members
              .fetch(user.discord_id)
              .catch(() => null);
            if (member) {
              // Update nickname
              const nickname = this.applyNicknameTemplate(
                (guildConfig as GuildConfigRecord).nickname_template,
                name,
                playerId,
                factionData?.faction_tag,
              );
              await member.setNickname(nickname).catch(() => {});

              // Ensure verification role is assigned if configured
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
                ).find((m) => m.faction_id === factionData?.faction_id);

                // Remove old faction roles
                if (oldFactionMapping) {
                  await member.roles
                    .remove(oldFactionMapping.role_ids)
                    .catch(() => {});
                }

                // Add new faction roles
                if (newFactionMapping) {
                  await member.roles
                    .add(newFactionMapping.role_ids)
                    .catch(() => {});
                }
              }
            }

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
