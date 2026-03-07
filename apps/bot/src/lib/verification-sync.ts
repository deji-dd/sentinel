import { type Client } from "discord.js";
import {
  TABLE_NAMES,
  TornApiClient,
  getNextApiKey,
  type TornApiComponents,
} from "@sentinel/shared";
import { getDB } from "@sentinel/shared/db/sqlite.js";
import { getGuildApiKeys } from "./guild-api-keys.js";
import { logGuildError, logGuildSuccess } from "./guild-logger.js";
import { upsertVerifiedUser } from "./verified-users.js";
import { tornApi } from "../services/torn-client.js";

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
  enabled_modules: string[];
  admin_role_ids: string[];
  verified_role_ids: string[];
  auto_verify?: boolean;
  created_at: string;
  updated_at: string;
}

function parseTextArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string");
  }

  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) {
        return parsed.filter(
          (item): item is string => typeof item === "string",
        );
      }
    } catch {
      return [];
    }
  }

  return [];
}

function isTruthyBoolean(value: unknown): boolean {
  return value === true || value === 1 || value === "1";
}

/**
 * Database-driven guild sync scheduler
 * - Polls database every 60s for guilds needing sync
 * - Spreads member verification incrementally throughout 60-min cycle
 * - Uses deterministic member ordering for consistent behavior
 * - Syncs each guild independently with its own API key
 * - Respects per-user rate limits via PerUserRateLimiter
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
      const db = getDB();

      // Get all sync jobs that need to run
      const jobs = db
        .prepare(
          `SELECT guild_id, last_sync_at, next_sync_at, in_progress
           FROM "${TABLE_NAMES.GUILD_SYNC_JOBS}"
           WHERE in_progress = 0 AND next_sync_at <= ?
           ORDER BY next_sync_at ASC`,
        )
        .all(new Date().toISOString()) as GuildSyncJob[];

      if (!jobs || jobs.length === 0) {
        return;
      }

      const jobGuildIds = jobs.map((job: GuildSyncJob) => job.guild_id);
      const placeholders = jobGuildIds.map(() => "?").join(", ");
      const guildConfigs = db
        .prepare(
          `SELECT guild_id, auto_verify
           FROM "${TABLE_NAMES.GUILD_CONFIG}"
           WHERE guild_id IN (${placeholders})`,
        )
        .all(...jobGuildIds) as Array<{
        guild_id: string;
        auto_verify: unknown;
      }>;

      const autoVerifyGuilds = new Set(
        (guildConfigs || [])
          .filter((config) => isTruthyBoolean(config.auto_verify))
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
    const db = getDB();

    // Lock the job
    const lockResult = db
      .prepare(
        `UPDATE "${TABLE_NAMES.GUILD_SYNC_JOBS}" SET in_progress = 1 WHERE guild_id = ? AND in_progress = 0`,
      )
      .run(job.guild_id);

    if (lockResult.changes === 0) {
      const lockErrorMessage = "Job is already in progress or missing";
      console.error(
        `[Guild Sync] Failed to lock job for guild ${job.guild_id}: ${lockErrorMessage}`,
      );
      await logGuildError(
        job.guild_id,
        this.client,
        "Guild Sync Lock Failed",
        lockErrorMessage,
        `Unable to lock sync job for guild ${job.guild_id}.`,
      );
      return;
    }

    try {
      const guildConfig = db
        .prepare(
          `SELECT * FROM "${TABLE_NAMES.GUILD_CONFIG}" WHERE guild_id = ? LIMIT 1`,
        )
        .get(job.guild_id) as
        | (Partial<GuildConfigRecord> & {
            auto_verify?: unknown;
            nickname_template?: string | null;
            verified_role_id?: string | null;
          })
        | undefined;

      if (!guildConfig) {
        console.error(`[Guild Sync] Guild ${job.guild_id} config not found`);
        await logGuildError(
          job.guild_id,
          this.client,
          "Guild Auto Verification Failed",
          "Missing guild config",
          `Guild config not found for ${job.guild_id}.`,
        );
        return;
      }

      if (!isTruthyBoolean(guildConfig.auto_verify)) {
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
      const factionMappings = db
        .prepare(
          `SELECT guild_id, faction_id, member_role_ids, leader_role_ids, enabled
           FROM "${TABLE_NAMES.FACTION_ROLES}"
           WHERE guild_id = ?`,
        )
        .all(job.guild_id)
        .map((row) => {
          const typed = row as {
            guild_id: string;
            faction_id: number;
            member_role_ids: unknown;
            leader_role_ids: unknown;
            enabled: unknown;
          };

          return {
            guild_id: typed.guild_id,
            faction_id: typed.faction_id,
            member_role_ids: parseTextArray(typed.member_role_ids),
            leader_role_ids: parseTextArray(typed.leader_role_ids),
            enabled:
              typed.enabled !== false &&
              typed.enabled !== 0 &&
              typed.enabled !== "0",
          } as FactionRoleMapping;
        });

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
          const existingUser = db
            .prepare(
              `SELECT discord_id, torn_name, faction_id, faction_tag
               FROM "${TABLE_NAMES.VERIFIED_USERS}"
               WHERE discord_id = ?
               LIMIT 1`,
            )
            .get(member.id) as
            | {
                discord_id: string;
                torn_name: string;
                faction_id: number | null;
                faction_tag: string | null;
              }
            | undefined;

          const isNewUser = !existingUser;
          const nameChanged = existingUser && name !== existingUser.torn_name;

          // Normalize faction data: handle both undefined and null values
          // When user has no faction, Torn API returns {} not null
          const normalizedFactionId = factionData?.id || null;
          const normalizedFactionTag = factionData?.tag || null;

          const factionChanged =
            existingUser &&
            (normalizedFactionId !== existingUser.faction_id ||
              normalizedFactionTag !== existingUser.faction_tag) &&
            // Prevent false positives: don't count leaving a faction as "changed" every sync
            // (when both old and new are null, it's truly unchanged)
            !(
              normalizedFactionId === null &&
              normalizedFactionTag === null &&
              existingUser.faction_id === null &&
              existingUser.faction_tag === null
            );

          // Upsert to database
          upsertVerifiedUser({
            discordId: member.id,
            tornId: playerId,
            tornName: name,
            factionId: normalizedFactionId,
            factionTag: normalizedFactionTag,
          });

          const rolesAdded: string[] = [];
          const rolesRemoved: string[] = [];

          // Always update nickname to apply current template
          const nickname = this.applyNicknameTemplate(
            guildConfig.nickname_template || "{name} [{id}]",
            name,
            playerId,
            factionData?.tag,
          );
          await member.setNickname(nickname).catch(() => {});

          // Ensure verification role is assigned if configured
          const verifiedRoleId = guildConfig.verified_role_id;
          if (verifiedRoleId && !member.roles.cache.has(verifiedRoleId)) {
            const addVerifiedRoleResult = await member.roles
              .add(verifiedRoleId)
              .then(() => true)
              .catch(() => false);
            if (addVerifiedRoleResult) {
              rolesAdded.push(verifiedRoleId);
            }
          }

          // Handle faction roles - WITH STRICT ROLE SECURITY
          // Treat faction roles as "master" - only people in that faction can have those roles
          if (factionMappings && factionMappings.length > 0) {
            const enabledMappings = (
              factionMappings as FactionRoleMapping[]
            ).filter((m) => m.enabled !== false);

            // Determine which roles user SHOULD have (based on their faction)
            const rolesUserShouldHave = new Set<string>();

            // Add member roles if they're in the mapped faction
            if (factionData?.id) {
              const currentFactionMapping = enabledMappings.find(
                (m) => m.faction_id === factionData.id,
              );

              if (currentFactionMapping) {
                // Add member roles
                currentFactionMapping.member_role_ids.forEach((roleId) => {
                  rolesUserShouldHave.add(roleId);
                });

                // Add leader roles if they are a leader
                const isLeader =
                  currentFactionMapping.leader_role_ids.length > 0 &&
                  factionLeadersCache.get(factionData.id)?.has(playerId);

                if (isLeader) {
                  currentFactionMapping.leader_role_ids.forEach((roleId) => {
                    rolesUserShouldHave.add(roleId);
                  });
                }
              }
            }

            // Now enforce role state: remove all faction-mapped roles that user shouldn't have
            // This ensures roles as "master" - no one can manually keep a role they shouldn't have
            for (const mapping of enabledMappings) {
              const allMappedRoles = [
                ...mapping.member_role_ids,
                ...mapping.leader_role_ids,
              ];

              for (const roleId of allMappedRoles) {
                const userHasRole = member.roles.cache.has(roleId);
                const userShouldHaveRole = rolesUserShouldHave.has(roleId);

                if (userHasRole && !userShouldHaveRole) {
                  // User has a role they shouldn't - remove it
                  const removeResult = await member.roles
                    .remove(roleId)
                    .then(() => true)
                    .catch(() => false);
                  if (removeResult) {
                    rolesRemoved.push(roleId);
                  }
                } else if (!userHasRole && userShouldHaveRole) {
                  // User should have a role - add it
                  const addResult = await member.roles
                    .add(roleId)
                    .then(() => true)
                    .catch(() => false);
                  if (addResult) {
                    rolesAdded.push(roleId);
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
            const removeResult = db
              .prepare(
                `DELETE FROM "${TABLE_NAMES.VERIFIED_USERS}" WHERE discord_id = ?`,
              )
              .run(member.id);
            if (removeResult.changes > 0) {
              removedCount++;
            }
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
      // Unlock job and schedule next sync (fixed 60-minute cycle)
      const nextSync = new Date(Date.now() + 3600 * 1000); // 60 minutes

      db.prepare(
        `UPDATE "${TABLE_NAMES.GUILD_SYNC_JOBS}"
         SET in_progress = 0, last_sync_at = ?, next_sync_at = ?
         WHERE guild_id = ?`,
      ).run(new Date().toISOString(), nextSync.toISOString(), job.guild_id);
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
