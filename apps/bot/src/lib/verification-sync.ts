import { type Client } from "discord.js";
import { TABLE_NAMES, TornApiClient, getNextApiKey } from "@sentinel/shared";
import { db } from "./db-client.js";
import { getGuildApiKeys } from "./guild-api-keys.js";
import { logGuildError, logGuildSuccess } from "./guild-logger.js";
import { upsertVerifiedUser } from "./verified-users.js";
import { tornApi } from "../services/torn-client.js";
import {
  applyNicknameTemplate,
  type factionGenericResponse,
  type FactionRoleMapping,
  type GuildSyncJob,
  isTruthyBoolean,
  isVerificationRecordStale,
  loadVerifiedUsersByDiscordIds,
  parseTextArray,
  type UserGenericResponse,
} from "./verification-sync-support.js";

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
  private readonly VERIFICATION_REFRESH_MS = 24 * 60 * 60 * 1000; // 24h
  private readonly VERIFIED_USER_QUERY_CHUNK_SIZE = 500;
  private isPolling = false;

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
    if (this.isPolling) {
      console.log(`[Guild Sync] Poll skipped (previous poll still running)`);
      return;
    }

    this.isPolling = true;
    try {
      // Clear any jobs that have been stuck in_progress for over 30 minutes
      await this.clearStuckJobs();

      // Get all sync jobs that need to run
      const jobsRaw = (await db
        .selectFrom(TABLE_NAMES.GUILD_SYNC_JOBS)
        .select(["guild_id", "last_sync_at", "next_sync_at", "in_progress"])
        .where("in_progress", "=", 0)
        .where("next_sync_at", "<=", new Date().toISOString())
        .orderBy("next_sync_at", "asc")
        .execute()) as Array<{
        guild_id: string;
        last_sync_at: string | null;
        next_sync_at: string;
        in_progress: number;
      }>;

      const jobs: GuildSyncJob[] = jobsRaw.map((job) => ({
        guild_id: job.guild_id,
        last_sync_at: job.last_sync_at,
        next_sync_at: job.next_sync_at,
        in_progress: job.in_progress,
      }));

      if (!jobs || jobs.length === 0) {
        return;
      }

      const jobGuildIds = jobs.map((job: GuildSyncJob) => job.guild_id);
      const guildConfigs = (await db
        .selectFrom(TABLE_NAMES.GUILD_CONFIG)
        .select(["guild_id", "auto_verify"])
        .where("guild_id", "in", jobGuildIds)
        .execute()) as Array<{
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
    } finally {
      this.isPolling = false;
    }
  }

  /**
   * Sync a single guild
   */
  private async syncGuild(job: GuildSyncJob): Promise<void> {
    // Lock the job
    const lockResult = await db
      .updateTable(TABLE_NAMES.GUILD_SYNC_JOBS)
      .set({ in_progress: 1, updated_at: new Date().toISOString() })
      .where("guild_id", "=", job.guild_id)
      .where("in_progress", "=", 0)
      .executeTakeFirst();

    if (Number(lockResult.numUpdatedRows) === 0) {
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

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let guildConfig: any = undefined;

    try {
      const configRow = await db
        .selectFrom(TABLE_NAMES.GUILD_CONFIG)
        .selectAll()
        .where("guild_id", "=", job.guild_id)
        .limit(1)
        .executeTakeFirst();

      if (!configRow) {
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

      if (!isTruthyBoolean(configRow.auto_verify)) {
        console.log(
          `[Guild Sync] Auto verification disabled for guild ${job.guild_id}. Skipping sync.`,
        );
        return;
      }

      // Prepare a clean config object with parsed arrays
      guildConfig = {
        ...configRow,
        admin_role_ids: parseTextArray(configRow.admin_role_ids),
        verified_role_ids: parseTextArray(configRow.verified_role_ids),
        enabled_modules: parseTextArray(configRow.enabled_modules),
      };

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

      // Load verified users for all members in the guild
      // This allows us to identify who IS verified versus who just has managed roles
      const existingVerifiedUsers = await loadVerifiedUsersByDiscordIds(
        Array.from(allMembers.keys()),
        this.VERIFIED_USER_QUERY_CHUNK_SIZE,
      );

      // Get faction role mappings for this guild
      const factionMappings = (
        await db
          .selectFrom(TABLE_NAMES.FACTION_ROLES)
          .select([
            "guild_id",
            "faction_id",
            "member_role_ids",
            "leader_role_ids",
            "enabled",
          ])
          .where("guild_id", "=", job.guild_id)
          .execute()
      ).map((row) => {
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

      // Get reaction role mappings requiring sync
      const strictReactionMessages = await db
        .selectFrom(TABLE_NAMES.REACTION_ROLE_MESSAGES)
        .select(["message_id", "required_role_id"])
        .where("guild_id", "=", job.guild_id)
        .where("sync_roles", "=", 1)
        .where("required_role_id", "is not", null)
        .execute();

      const reactionRoleSyncs: Array<{ required_role_id: string; mapped_role_ids: string[] }> = [];
      for (const rxMsg of strictReactionMessages) {
         if (!rxMsg.required_role_id) continue;
         const mappings = await db
           .selectFrom(TABLE_NAMES.REACTION_ROLE_MAPPINGS)
           .select(["role_id"])
           .where("message_id", "=", rxMsg.message_id)
           .execute();
         const roleIds = mappings.map(m => m.role_id);
         if (roleIds.length > 0) {
            reactionRoleSyncs.push({
               required_role_id: rxMsg.required_role_id,
               mapped_role_ids: roleIds
            });
         }
      }

      // Get managed roles (verified role(s) + all faction roles)
      const managedRoleIds = new Set<string>();
      if (guildConfig.verified_role_id) {
        managedRoleIds.add(guildConfig.verified_role_id);
      }
      if (
        guildConfig.verified_role_ids &&
        Array.isArray(guildConfig.verified_role_ids)
      ) {
        guildConfig.verified_role_ids.forEach((id: string) =>
          managedRoleIds.add(id),
        );
      }
      for (const mapping of factionMappings) {
        mapping.member_role_ids.forEach((id) => managedRoleIds.add(id));
        mapping.leader_role_ids.forEach((id) => managedRoleIds.add(id));
      }
      for (const rxMapping of reactionRoleSyncs) {
        rxMapping.mapped_role_ids.forEach((id) => managedRoleIds.add(id));
      }

      // Filter members to sync: only those who ARE verified OR carry a managed role
      // This prevents hammering the API for thousands of unverified users while still
      // ensuring role security (removing roles from people who shouldn't have them)
      const membersToSync = Array.from(allMembers.values()).filter((member) => {
        if (member.user.bot) return false;

        const isVerified = existingVerifiedUsers.has(member.id);
        const hasManagedRole = Array.from(managedRoleIds).some((roleId) =>
          member.roles.cache.has(roleId),
        );

        return isVerified || hasManagedRole;
      });

      // Cache faction members + profiles for mapped factions.
      const factionMembersCache = new Map<number, Set<number>>();
      const factionLeadersCache = new Map<number, Set<number>>();
      const factionProfilesCache = new Map<
        number,
        { name: string; tag: string }
      >();

      // Fetch faction members for all mapped factions that are enabled.
      // This powers hybrid verification so we only call /user when required.
      const mappedFactionIds = [
        ...new Set(
          (factionMappings || [])
            .filter((m) => m.enabled !== false)
            .map((m) => m.faction_id),
        ),
      ];

      if (mappedFactionIds.length > 0) {
        for (const factionId of mappedFactionIds) {
          try {
            // Fetch basic info (name/tag) AND members list
            // Using selections: "basic,members" to get all required data in one call
            const factionResponse =
              await this.tornApi.get<factionGenericResponse>("/faction/{id}", {
                apiKey: getNextApiKey(job.guild_id, apiKeys),
                pathParams: { id: factionId },
                queryParams: { selections: ["basic", "members"] },
              });

            if (factionResponse.basic.name) {
              factionProfilesCache.set(factionId, {
                name: factionResponse.basic.name,
                tag: factionResponse.basic.tag || "",
              });
            }

            const memberIds = new Set<number>();
            const leaders = new Set<number>();
            const members = factionResponse.members || [];

            // Torn API v2 returns members selection as an array of objects
            for (const memberInfo of members) {
              const id = memberInfo.id;
              memberIds.add(id);
              if (
                memberInfo.position === "Leader" ||
                memberInfo.position === "Co-leader"
              ) {
                leaders.add(id);
              }
            }

            factionMembersCache.set(factionId, memberIds);
            factionLeadersCache.set(factionId, leaders);

            // Rate limiting delay
            await new Promise((resolve) => setTimeout(resolve, 100));
          } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            console.error(
              `[Guild Sync] Error fetching faction ${factionId} members: ${msg}`,
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
      for (const member of membersToSync) {
        try {
          const existingUser = existingVerifiedUsers.get(member.id);

          let name: string;
          let playerId: number;
          let normalizedFactionId: number | null;
          let normalizedFactionTag: string | null;
          let factionName: string | null = null;
          let usedApiLookup = false;

          const inferredMappedFactionId = existingUser
            ? (mappedFactionIds.find((factionId) =>
                factionMembersCache.get(factionId)?.has(existingUser.torn_id),
              ) ?? null)
            : null;

          const staleRecord = existingUser
            ? isVerificationRecordStale(
                existingUser.updated_at,
                this.VERIFICATION_REFRESH_MS,
              )
            : false;

          const mappedFactionMismatch = existingUser
            ? existingUser.faction_id !== null &&
              mappedFactionIds.includes(existingUser.faction_id) &&
              !factionMembersCache
                .get(existingUser.faction_id)
                ?.has(existingUser.torn_id)
            : false;

          const shouldFetchFromApi =
            !existingUser || staleRecord || mappedFactionMismatch;

          if (shouldFetchFromApi) {
            usedApiLookup = true;
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

            name = response.profile.name;
            playerId = response.profile.id;
            normalizedFactionId = response.faction?.id || null;
            normalizedFactionTag = response.faction?.tag || null;
            factionName = response.faction?.name || null;

            if (!name || !playerId) {
              console.warn(
                `[Guild Sync] Missing required fields for user ${member.id}`,
              );
              errorCount++;
              continue;
            }
          } else {
            // Existing verified users can be resolved from DB + mapped faction cache.
            name = existingUser.torn_name;
            playerId = existingUser.torn_id;

            if (inferredMappedFactionId) {
              normalizedFactionId = inferredMappedFactionId;
              const profile = factionProfilesCache.get(inferredMappedFactionId);
              normalizedFactionTag = profile?.tag || null;
              factionName = profile?.name || null;
            } else if (
              existingUser.faction_id !== null &&
              !mappedFactionIds.includes(existingUser.faction_id)
            ) {
              normalizedFactionId = existingUser.faction_id;
              normalizedFactionTag = existingUser.faction_tag;
            } else {
              normalizedFactionId = null;
              normalizedFactionTag = null;
            }
          }

          const isNewUser = !existingUser;
          const nameChanged = existingUser && name !== existingUser.torn_name;

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

          if (isNewUser || nameChanged || factionChanged || usedApiLookup) {
            await upsertVerifiedUser({
              discordId: member.id,
              tornId: playerId,
              tornName: name,
              factionId: normalizedFactionId,
              factionTag: normalizedFactionTag,
            });

            existingVerifiedUsers.set(member.id, {
              discord_id: member.id,
              torn_id: playerId,
              torn_name: name,
              faction_id: normalizedFactionId,
              faction_tag: normalizedFactionTag,
              updated_at: new Date().toISOString(),
            });
          }

          const rolesAdded: string[] = [];
          const rolesRemoved: string[] = [];

          // Always update nickname to apply current template
          const nickname = applyNicknameTemplate(
            guildConfig.nickname_template || "{name} [{id}]",
            name,
            playerId,
            normalizedFactionTag || undefined,
          );
          await member.setNickname(nickname).catch(() => {});

          // Ensure verification roles are assigned if configured
          const rolesToAssign = new Set<string>();
          if (guildConfig.verified_role_id)
            rolesToAssign.add(guildConfig.verified_role_id);
          if (
            guildConfig.verified_role_ids &&
            Array.isArray(guildConfig.verified_role_ids)
          ) {
            guildConfig.verified_role_ids.forEach((id: string) =>
              rolesToAssign.add(id),
            );
          }

          for (const roleId of rolesToAssign) {
            if (!member.roles.cache.has(roleId)) {
              const addResult = await member.roles
                .add(roleId)
                .then(() => true)
                .catch(() => false);
              if (addResult) {
                rolesAdded.push(roleId);
              }
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
            if (normalizedFactionId) {
              const currentFactionMapping = enabledMappings.find(
                (m) => m.faction_id === normalizedFactionId,
              );

              if (currentFactionMapping) {
                // Add member roles
                currentFactionMapping.member_role_ids.forEach((roleId) => {
                  rolesUserShouldHave.add(roleId);
                });

                // Add leader roles if they are a leader
                // If API failed to load leaders for this faction, we preserve existing roles to avoid incorrectly removing perms
                if (factionLeadersCache.has(normalizedFactionId)) {
                  const isLeader =
                    currentFactionMapping.leader_role_ids.length > 0 &&
                    factionLeadersCache.get(normalizedFactionId)?.has(playerId);

                  if (isLeader) {
                    currentFactionMapping.leader_role_ids.forEach((roleId) => {
                      rolesUserShouldHave.add(roleId);
                    });
                  }
                } else {
                  currentFactionMapping.leader_role_ids.forEach((roleId) => {
                    if (member.roles.cache.has(roleId)) {
                      rolesUserShouldHave.add(roleId);
                    }
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

          // Enforce strict reaction roles (sync_roles)
          for (const rx of reactionRoleSyncs) {
            const requiredRoleIds = rx.required_role_id.split(",");
            const hasRequired = requiredRoleIds.some(rid => member.roles.cache.has(rid));
            if (!hasRequired) {
               // Strip any mapped roles if member doesn't have the required role
               for (const mappedRoleId of rx.mapped_role_ids) {
                  if (member.roles.cache.has(mappedRoleId)) {
                     const removeResult = await member.roles
                       .remove(mappedRoleId, "Auto-sync: Did not meet required role for this reaction role")
                       .then(() => true)
                       .catch(() => false);
                     if (removeResult) {
                       rolesRemoved.push(mappedRoleId);
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

            if (
              normalizedFactionId !== null ||
              normalizedFactionTag !== null ||
              factionName !== null
            ) {
              logFields.push({
                name: "Faction",
                value:
                  factionName ||
                  (normalizedFactionTag
                    ? `[${normalizedFactionTag}]`
                    : String(normalizedFactionId)),
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

          // Delay only after /user calls; cached-member processing is local.
          if (usedApiLookup) {
            await new Promise((resolve) => setTimeout(resolve, 100));
          }
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);

          // Check if user has no linked Torn account or disconnected
          if (/Incorrect ID/i.test(msg) || /User not found/i.test(msg)) {
            // Remove from verified_users if they were previously verified
            const removeResult = await db
              .deleteFrom(TABLE_NAMES.VERIFIED_USERS)
              .where("discord_id", "=", member.id)
              .executeTakeFirst();
            if (Number(removeResult.numDeletedRows) > 0) {
              existingVerifiedUsers.delete(member.id);
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
      // Unlock job and schedule next sync (default 60 minutes)
      const syncInterval = Number(guildConfig?.sync_interval_seconds || 3600);
      const nextSync = new Date(Date.now() + syncInterval * 1000);

      await db
        .updateTable(TABLE_NAMES.GUILD_SYNC_JOBS)
        .set({
          in_progress: 0,
          last_sync_at: new Date().toISOString(),
          next_sync_at: nextSync.toISOString(),
          updated_at: new Date().toISOString(),
        })
        .where("guild_id", "=", job.guild_id)
        .execute();
    }
  }

  /**
   * Reset sync jobs that have been stuck in progress for over 30 minutes
   * (likely due to process crash/restart during a sync run)
   */
  private async clearStuckJobs(): Promise<void> {
    try {
      const thirtyMinutesAgo = new Date(
        Date.now() - 30 * 60 * 1000,
      ).toISOString();

      const result = await db
        .updateTable(TABLE_NAMES.GUILD_SYNC_JOBS)
        .set({ in_progress: 0 })
        .where("in_progress", "=", 1)
        .where("updated_at", "<", thirtyMinutesAgo)
        .executeTakeFirst();

      if (Number(result.numUpdatedRows) > 0) {
        console.log(
          `[Guild Sync] Cleared ${result.numUpdatedRows} stuck sync job(s)`,
        );
      }
    } catch (error) {
      console.error(
        `[Guild Sync] Error clearing stuck jobs: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
