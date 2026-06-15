import { type Client } from "discord.js";
import { TABLE_NAMES, TornApiClient, getNextApiKey, decryptApiKey } from "@sentinel/shared";
import { db } from "./db-client.js";
import { getGuildApiKeys } from "./guild-api-keys.js";
import { logGuildError, logGuildSuccess, logGuildWarning } from "./guild-logger.js";
import { upsertVerifiedUser } from "./verified-users.js";
import { tornApi, validateTornApiKey } from "../services/torn-client.js";
import { Logger } from "./logger.js";

const logger = new Logger("Guild Sync");
import {
  applyNicknameTemplate,
  type factionGenericResponse,
  type FactionRoleMapping,
  type GuildSyncJob,
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
  private tornApi: TornApiClient;
  private readonly VERIFICATION_REFRESH_MS = 24 * 60 * 60 * 1000; // 24h
  private readonly VERIFIED_USER_QUERY_CHUNK_SIZE = 500;

  constructor(client: Client) {
    this.client = client;
    // Create single tornApi instance with per-user rate limiting
    this.tornApi = tornApi;
  }

  async runGuildOnce(guildId: string): Promise<void> {
    await this.clearStuckJobs();

    let job = await db
      .selectFrom(TABLE_NAMES.GUILD_SYNC_JOBS)
      .select(["guild_id", "last_sync_at", "next_sync_at", "in_progress"])
      .where("guild_id", "=", guildId)
      .executeTakeFirst();

    if (!job) {
      try {
        await db
          .insertInto(TABLE_NAMES.GUILD_SYNC_JOBS)
          .values({
            guild_id: guildId,
            next_sync_at: new Date().toISOString(),
            in_progress: 0,
          })
          .execute();

        job = {
          guild_id: guildId,
          last_sync_at: null,
          next_sync_at: new Date().toISOString(),
          in_progress: 0,
        };
      } catch (err) {
        logger.error(`Failed to self-heal missing sync job for guild ${guildId}`, err);
        return;
      }
    }

    await this.syncGuild({
      guild_id: job.guild_id,
      last_sync_at: job.last_sync_at,
      next_sync_at: job.next_sync_at,
      in_progress: job.in_progress,
    });
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
      logger.error(
        `Failed to lock job for guild ${job.guild_id}: ${lockErrorMessage}`,
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
        logger.error(`Guild ${job.guild_id} config not found`);
        await logGuildError(
          job.guild_id,
          this.client,
          "Guild Auto Verification Failed",
          "Missing guild config",
          `Guild config not found for ${job.guild_id}.`,
        );
        return;
      }

      // Resolve Discord guild and name early for logging
      const discord = this.client.guilds.cache.get(job.guild_id);
      const guildName = discord?.name || job.guild_id;

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
        logger.error(
          `No API keys configured (guild ${guildName})`,
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

      if (!discord) {
        logger.warn(`Guild ${guildName} not in cache`);
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

      const reactionRoleSyncs: Array<{
        required_role_id: string;
        mapped_role_ids: string[];
      }> = [];
      const strictMessageIds = strictReactionMessages
        .map((message) => message.message_id)
        .filter((messageId): messageId is string => !!messageId);

      const mappingsByMessageId = new Map<string, string[]>();
      if (strictMessageIds.length > 0) {
        const mappingRows = await db
          .selectFrom(TABLE_NAMES.REACTION_ROLE_MAPPINGS)
          .select(["message_id", "role_id"])
          .where("message_id", "in", strictMessageIds)
          .execute();

        for (const mapping of mappingRows) {
          const existing = mappingsByMessageId.get(mapping.message_id) || [];
          existing.push(mapping.role_id);
          mappingsByMessageId.set(mapping.message_id, existing);
        }
      }

      for (const rxMsg of strictReactionMessages) {
        if (!rxMsg.required_role_id) continue;
        const roleIds = mappingsByMessageId.get(rxMsg.message_id) || [];
        if (roleIds.length > 0) {
          reactionRoleSyncs.push({
            required_role_id: rxMsg.required_role_id,
            mapped_role_ids: roleIds,
          });
        }
      }

      // Get all registered active mercenaries in this guild
      const registeredMercs = await db
        .selectFrom(TABLE_NAMES.MERCENARY_REGISTERED_MERCS)
        .select(["id", "discord_id", "api_key", "torn_id", "torn_name", "updated_at"])
        .where("guild_id", "=", job.guild_id)
        .where("is_active", "=", 1)
        .execute();

      // Get mercenary config and role ids
      const mercConfig = await db
        .selectFrom(TABLE_NAMES.MERCENARY_CONFIG)
        .select(["merc_role_ids_json"])
        .where("guild_id", "=", job.guild_id)
        .executeTakeFirst();
      const mercRoleIds = parseTextArray(mercConfig?.merc_role_ids_json);

      // Routine check for active registered mercenaries' API keys (check every 12 hours)
      const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY;
      if (ENCRYPTION_KEY) {
        const twelveHoursAgo = Date.now() - 12 * 60 * 60 * 1000;
        const mercsToCheck = registeredMercs.filter(m => {
          if (!m.api_key) return false;
          if (!m.updated_at) return true;
          const updatedTime = new Date(m.updated_at.replace(" ", "T")).getTime();
          return isNaN(updatedTime) || updatedTime < twelveHoursAgo;
        });

        for (const merc of mercsToCheck) {
          if (!merc.api_key) continue;
          let decryptedKey = "";
          try {
            decryptedKey = decryptApiKey(merc.api_key, ENCRYPTION_KEY);
          } catch (decryptErr) {
            logger.error(`Failed to decrypt API key for mercenary ${merc.torn_name} [${merc.torn_id}]`, decryptErr);
            continue;
          }

          try {
            // Validate the key
            await validateTornApiKey(decryptedKey);
            // If valid, update updated_at to now to defer the next check
            await db
              .updateTable(TABLE_NAMES.MERCENARY_REGISTERED_MERCS)
              .set({ updated_at: new Date().toISOString() })
              .where("id", "=", merc.id)
              .execute();
          } catch (validateErr) {
            const errorMsg = validateErr instanceof Error ? validateErr.message : String(validateErr);
            logger.warn(`API key validation failed for mercenary ${merc.torn_name} [${merc.torn_id}] during routine check. Deregistering. Error: ${errorMsg}`);

            // Mark as inactive
            const now = new Date().toISOString();
            await db
              .updateTable(TABLE_NAMES.MERCENARY_REGISTERED_MERCS)
              .set({
                is_active: 0,
                deregistered_at: now,
                updated_at: now,
              })
              .where("id", "=", merc.id)
              .execute();

            // Strip roles if possible
            if (mercRoleIds.length > 0) {
              try {
                const member = await discord.members.fetch(merc.discord_id);
                for (const roleId of mercRoleIds) {
                  if (member.roles.cache.has(roleId)) {
                    await member.roles.remove(roleId, "Auto-sync: Mercenary API key became invalid");
                  }
                }
              } catch (roleErr) {
                logger.error(`Failed to strip roles for deregistered mercenary ${merc.discord_id}:`, roleErr);
              }
            }

            // Log action to guild audit logs
            await logGuildWarning(
              job.guild_id,
              this.client,
              "Mercenary Auto-Deregistered",
              `${merc.torn_name ? `**${merc.torn_name} [${merc.torn_id}]**` : `<@${merc.discord_id}>`} was automatically removed from the mercenary system because their API key is no longer valid.\nReason: ${errorMsg}`,
            );
          }
        }
      }

      const mercDiscordIds = new Set(registeredMercs.map((m) => m.discord_id));

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
        if (mapping.enabled !== false) {
          mapping.member_role_ids.forEach((id) => managedRoleIds.add(id));
          mapping.leader_role_ids.forEach((id) => managedRoleIds.add(id));
        }
      }
      for (const rxMapping of reactionRoleSyncs) {
        rxMapping.mapped_role_ids.forEach((id) => managedRoleIds.add(id));
      }
      for (const roleId of mercRoleIds) {
        managedRoleIds.add(roleId);
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
            logger.error(
              `Error fetching faction ${factionId} members for guild ${guildName}: ${msg}`,
            );
          }
        }
      }

      let verifiedCount = 0;
      let updatedCount = 0;
      let unchangedCount = 0;
      let removedCount = 0;
      let errorCount = 0;
      let totalRolesAdded = 0;
      let totalRolesRemoved = 0;

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
              logger.warn(
                `Missing required fields for user ${member.id} in guild ${guildName}`,
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

          // Track all roles this user should keep across verification and faction roles
          const rolesUserShouldKeep = new Set<string>(rolesToAssign);

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
                  rolesUserShouldKeep.add(roleId);
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
                      rolesUserShouldKeep.add(roleId);
                    });
                  }
                } else {
                  currentFactionMapping.leader_role_ids.forEach((roleId) => {
                    if (member.roles.cache.has(roleId)) {
                      rolesUserShouldHave.add(roleId);
                      rolesUserShouldKeep.add(roleId);
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

          // Enforce mercenary roles state: strictly add if registered merc, remove if not
          if (mercRoleIds.length > 0) {
            const isMerc = mercDiscordIds.has(member.id);
            for (const roleId of mercRoleIds) {
              const userHasRole = member.roles.cache.has(roleId);
              if (userHasRole && !isMerc) {
                // If they should keep the role from verified config or faction mapping, do not remove it
                if (rolesUserShouldKeep.has(roleId)) continue;

                const removeResult = await member.roles
                  .remove(roleId, "Auto-sync: Not a registered mercenary")
                  .then(() => true)
                  .catch(() => false);
                if (removeResult) {
                  rolesRemoved.push(roleId);
                }
              } else if (!userHasRole && isMerc) {
                const addResult = await member.roles
                  .add(roleId, "Auto-sync: Registered mercenary")
                  .then(() => true)
                  .catch(() => false);
                if (addResult) {
                  rolesAdded.push(roleId);
                }
              }
            }
          }

          // Enforce strict reaction roles (sync_roles)
          for (const rx of reactionRoleSyncs) {
            const requiredRoleIds = rx.required_role_id.split(",");
            const hasRequired = requiredRoleIds.some((rid) =>
              member.roles.cache.has(rid),
            );
            if (!hasRequired) {
              // Strip any mapped roles if member doesn't have the required role
              for (const mappedRoleId of rx.mapped_role_ids) {
                if (member.roles.cache.has(mappedRoleId)) {
                  const removeResult = await member.roles
                    .remove(
                      mappedRoleId,
                      "Auto-sync: Did not meet required role for this reaction role",
                    )
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
            if (rolesAdded.length > 0) {
              totalRolesAdded += rolesAdded.length;
            }
            if (rolesRemoved.length > 0) {
              totalRolesRemoved += rolesRemoved.length;
            }

            if (rolesAdded.length > 0 || rolesRemoved.length > 0) {
              logger.debug(
                `Roles updated for ${member.user.username} (${name} [${playerId}]): +${rolesAdded.length} / -${rolesRemoved.length} roles`,
              );
            } else if (isNewUser) {
              logger.debug(`Verified user ${member.user.username} as ${name} [${playerId}]`);
            } else if (nameChanged || factionChanged) {
              logger.debug(`Updated info for user ${member.user.username} (${name} [${playerId}]): nameChanged=${nameChanged}, factionChanged=${factionChanged}`);
            }

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

          logger.error(`Error syncing user ${member.id} in guild ${guildName}: ${msg}`);
          errorCount++;
        }
      }

      logger.info(
        `Guild ${guildName} sync complete: ${verifiedCount} verified, ${updatedCount} updated, ${unchangedCount} unchanged, ${removedCount} removed, ${errorCount} errors. Role updates: ${totalRolesAdded} roles added, ${totalRolesRemoved} roles removed`,
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
        logger.info(
          `Cleared ${result.numUpdatedRows} stuck sync job(s)`,
        );
      }
    } catch (error) {
      logger.error(
        `Error clearing stuck jobs`,
        error,
      );
    }
  }
}
