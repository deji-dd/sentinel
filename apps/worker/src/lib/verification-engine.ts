import { Logger } from "@sentinel/utils";
import { db } from "@sentinel/database";
import { decryptApiKey, type TornSchema } from "@sentinel/torn-api";
import { tornApiManager } from "@sentinel/torn-api-manager";

const logger = new Logger("VerificationEngine");

export type VerificationRequest = {
  guild_id: string;
  channel_id: string;
  discord_id: string;
  current_role_ids: string[];
  current_nickname: string | null;
  triggered_by?: "user" | "admin" | "join" | "cron";
};

export type VerificationSuccessResponse = {
  guild_id: string;
  channel_id: string;
  discord_id: string;
  roles_to_add: string[] | null;
  roles_to_remove: string[] | null;
  new_nickname: string | null;
};

export type VerificationFailureResponse = {
  guild_id: string;
  channel_id: string;
  discord_id: string;
  error: { message: string };
};

type UserGenericResponse = TornSchema<"UserDiscordResponse"> &
  TornSchema<"UserFactionResponse"> &
  TornSchema<"UserProfileResponse">;

// In-memory map to round-robin load balance requests across a guild's registered API keys
const guildKeyIndexes = new Map<string, number>();

/**
 * Returns the next available API key entry for a guild in round-robin order
 * to spread API request load across all valid guild keys.
 */
export function getNextGuildApiKey(
  guildId: string,
  apiKeys: Array<{ apiKeyEncrypted: string; userId: number | null }>,
): { apiKey: string; userId: number } | null {
  if (!apiKeys || apiKeys.length === 0) return null;
  const masterKey = process.env.ENCRYPTION_KEY || "";
  const currentIndex = guildKeyIndexes.get(guildId) || 0;
  const keyObj = apiKeys[currentIndex % apiKeys.length];
  guildKeyIndexes.set(guildId, (currentIndex + 1) % apiKeys.length);

  return {
    apiKey: decryptApiKey(keyObj.apiKeyEncrypted, masterKey),
    userId: keyObj.userId || 0,
  };
}

/**
 * Runs verification for a single Discord member in a guild.
 * Calculates roles to add, roles to remove, and nickname formatting.
 */
export async function runVerificationJob(
  job: VerificationRequest,
  apiKeyOverride?: string,
): Promise<VerificationSuccessResponse | VerificationFailureResponse> {
  const finishLog = logger.time();

  try {
    // 1. Fetch Guild Configuration
    const config = await db.guildConfig.findUnique({
      where: { guildId: job.guild_id },
      include: {
        apiKeys: { where: { isValid: true } },
        factionRoleMappings: { where: { enabled: true } },
      },
    });

    if (!config) {
      finishLog();
      const errRes: VerificationFailureResponse = {
        guild_id: job.guild_id,
        channel_id: job.channel_id,
        discord_id: job.discord_id,
        error: { message: "Guild configuration not found." },
      };
      await db.verificationLog
        .create({
          data: {
            guildId: job.guild_id,
            discordId: job.discord_id,
            status: "failure",
            triggeredBy: job.triggered_by || "user",
            rolesAdded: [],
            rolesRemoved: [],
            oldNickname: job.current_nickname,
            error: errRes.error.message,
          },
        })
        .catch(() => {});
      return errRes;
    }

    // 2. Select API Key using round-robin load balancing
    let apiKey: string | null = apiKeyOverride || null;
    let keyUserId = 0;

    if (apiKeyOverride) {
      apiKey = apiKeyOverride;
    } else if (config.apiKeys.length > 0) {
      const selectedKey = getNextGuildApiKey(job.guild_id, config.apiKeys);
      if (selectedKey) {
        apiKey = selectedKey.apiKey;
        keyUserId = selectedKey.userId;
      }
    }

    if (!apiKey) {
      finishLog();
      const errRes: VerificationFailureResponse = {
        guild_id: job.guild_id,
        channel_id: job.channel_id,
        discord_id: job.discord_id,
        error: { message: "No valid API key available for this guild." },
      };
      await db.verificationLog
        .create({
          data: {
            guildId: job.guild_id,
            discordId: job.discord_id,
            status: "failure",
            triggeredBy: job.triggered_by || "user",
            rolesAdded: [],
            rolesRemoved: [],
            oldNickname: job.current_nickname,
            error: errRes.error.message,
          },
        })
        .catch(() => {});
      return errRes;
    }

    // 3. Compile Managed & Protected Roles
    const managedRoles = new Set<string>();
    config.verifiedRoleIds.forEach((id) => managedRoles.add(id));
    config.protectedRoleIds.forEach((id) => managedRoles.add(id));

    config.factionRoleMappings.forEach((mapping) => {
      mapping.memberRoleIds.forEach((id) => managedRoles.add(id));
      mapping.leaderRoleIds.forEach((id) => managedRoles.add(id));
    });

    // 4. Fetch User via Managed Torn API Client (rate limited & key health checked)
    let response: UserGenericResponse;
    try {
      response = (await tornApiManager.get("/user", {
        userId: keyUserId || job.discord_id,
        apiKey,
        queryParams: {
          selections: ["discord", "faction", "profile"],
          id: job.discord_id,
        },
      })) as UserGenericResponse;
    } catch (apiErr: any) {
      logger.warn(
        `Torn API fetch failed for user ${job.discord_id}:`,
        apiErr?.message || apiErr,
      );

      // Handle Torn API code 6 (Unlinked Discord account)
      if (
        apiErr?.code === 6 ||
        apiErr?.message?.includes("not found") ||
        apiErr?.message?.includes("linked")
      ) {
        const rolesToRemove = Array.from(managedRoles).filter((roleId) =>
          job.current_role_ids.includes(roleId),
        );

        await db.verifiedUser.deleteMany({
          where: { discordId: job.discord_id },
        });

        await db.verificationLog
          .create({
            data: {
              guildId: job.guild_id,
              discordId: job.discord_id,
              status: "success",
              triggeredBy: job.triggered_by || "user",
              rolesAdded: [],
              rolesRemoved: rolesToRemove,
              oldNickname: job.current_nickname,
              newNickname: "",
            },
          })
          .catch(() => {});

        finishLog();
        return {
          guild_id: job.guild_id,
          channel_id: job.channel_id,
          discord_id: job.discord_id,
          roles_to_add: null,
          roles_to_remove: rolesToRemove.length > 0 ? rolesToRemove : null,
          new_nickname: "",
        };
      }

      const errMsg = apiErr?.message || "Torn API request failed.";
      await db.verificationLog
        .create({
          data: {
            guildId: job.guild_id,
            discordId: job.discord_id,
            status: "failure",
            triggeredBy: job.triggered_by || "user",
            rolesAdded: [],
            rolesRemoved: [],
            oldNickname: job.current_nickname,
            error: errMsg,
          },
        })
        .catch(() => {});

      finishLog();
      return {
        guild_id: job.guild_id,
        channel_id: job.channel_id,
        discord_id: job.discord_id,
        error: { message: errMsg },
      };
    }

    if (!response || !response.profile?.id) {
      const errMsg = "Torn account not verified or profile unavailable.";
      await db.verificationLog
        .create({
          data: {
            guildId: job.guild_id,
            discordId: job.discord_id,
            status: "failure",
            triggeredBy: job.triggered_by || "user",
            rolesAdded: [],
            rolesRemoved: [],
            oldNickname: job.current_nickname,
            error: errMsg,
          },
        })
        .catch(() => {});

      finishLog();
      return {
        guild_id: job.guild_id,
        channel_id: job.channel_id,
        discord_id: job.discord_id,
        error: { message: errMsg },
      };
    }

    // 5. Target Roles Calculation
    const targetRoles = new Set<string>();
    const tornId = response.profile.id;
    const tornName = response.profile.name;
    const factionId = response.faction?.id || null;
    const factionTag = response.faction?.tag || null;
    const factionPosition = response.faction?.position || null;

    // Add base verified roles
    config.verifiedRoleIds.forEach((id) => targetRoles.add(id));

    // Check Faction Role Mappings
    let isInMappedFaction = false;
    if (factionId) {
      const mapping = config.factionRoleMappings.find(
        (m) => m.factionId === factionId,
      );
      if (mapping) {
        isInMappedFaction = true;
        mapping.memberRoleIds.forEach((id) => targetRoles.add(id));

        if (factionPosition === "Leader" || factionPosition === "Co-leader") {
          mapping.leaderRoleIds.forEach((id) => targetRoles.add(id));
        }
      }
    }

    // Protected Roles logic: Keep protected roles IF user is in a mapped faction
    if (isInMappedFaction) {
      config.protectedRoleIds.forEach((roleId) => {
        if (job.current_role_ids.includes(roleId)) {
          targetRoles.add(roleId);
        }
      });
    }

    // 6. Update Verified User Record in DB
    await db.verifiedUser.upsert({
      where: { discordId: job.discord_id },
      update: {
        tornId,
        tornName,
        factionId,
        factionTag,
      },
      create: {
        discordId: job.discord_id,
        tornId,
        tornName,
        factionId,
        factionTag,
      },
    });

    // 7. Format Nickname
    let template = config.nicknameTemplate || "[{tag}] {name} [{id}]";
    if (!factionTag) {
      template = template.replace("[{tag}]", "").replace("{tag}", "").trim();
    } else {
      template = template.replace("{tag}", factionTag);
    }
    const formattedNickname = template
      .replace("{name}", tornName)
      .replace("{id}", tornId.toString())
      .replace(/\s+/g, " ")
      .trim();

    // 8. Calculate Diff
    const rolesToAdd = Array.from(targetRoles).filter(
      (roleId) => !job.current_role_ids.includes(roleId),
    );

    const rolesToRemove = Array.from(managedRoles).filter(
      (roleId) =>
        !targetRoles.has(roleId) && job.current_role_ids.includes(roleId),
    );

    const newNickname =
      formattedNickname === job.current_nickname ? null : formattedNickname;

    // 9. Create Verification Log
    await db.verificationLog
      .create({
        data: {
          guildId: job.guild_id,
          discordId: job.discord_id,
          status: "success",
          triggeredBy: job.triggered_by || "user",
          rolesAdded: rolesToAdd,
          rolesRemoved: rolesToRemove,
          oldNickname: job.current_nickname,
          newNickname,
        },
      })
      .catch(() => {});

    finishLog();
    return {
      guild_id: job.guild_id,
      channel_id: job.channel_id,
      discord_id: job.discord_id,
      roles_to_add: rolesToAdd.length > 0 ? rolesToAdd : null,
      roles_to_remove: rolesToRemove.length > 0 ? rolesToRemove : null,
      new_nickname: newNickname,
    };
  } catch (error) {
    logger.error(
      `Error in runVerificationJob for user ${job.discord_id}:`,
      error,
    );
    const errMsg =
      error instanceof Error ? error.message : "Internal worker error.";
    await db.verificationLog
      .create({
        data: {
          guildId: job.guild_id,
          discordId: job.discord_id,
          status: "failure",
          triggeredBy: job.triggered_by || "user",
          rolesAdded: [],
          rolesRemoved: [],
          oldNickname: job.current_nickname,
          error: errMsg,
        },
      })
      .catch(() => {});

    finishLog();
    return {
      guild_id: job.guild_id,
      channel_id: job.channel_id,
      discord_id: job.discord_id,
      error: { message: errMsg },
    };
  }
}

/**
 * Optimised bulk guild verification run.
 * Round-robins requests across all registered guild API keys and fetches mapped faction member lists.
 */
export async function runBulkGuildVerification(
  guildId: string,
  triggeredBy: "cron" | "admin" = "cron",
): Promise<{ processed: number; updated: number; errors: number }> {
  const finishLog = logger.time();

  try {
    const config = await db.guildConfig.findUnique({
      where: { guildId },
      include: {
        apiKeys: { where: { isValid: true } },
        factionRoleMappings: { where: { enabled: true } },
      },
    });

    if (!config || config.apiKeys.length === 0) {
      logger.warn(`No valid API keys found for bulk verification of guild ${guildId}`);
      return { processed: 0, updated: 0, errors: 1 };
    }

    // Map: factionId -> Set of member Torn IDs, Map: factionId -> Set of Leader/Co-leader Torn IDs
    const factionMembersMap = new Map<number, Set<number>>();
    const factionLeadersMap = new Map<number, Set<number>>();

    // Fetch members for each mapped faction using round-robin key selection across all guild API keys
    for (const mapping of config.factionRoleMappings) {
      const keyEntry = getNextGuildApiKey(guildId, config.apiKeys);
      if (!keyEntry) continue;

      try {
        const facRes = await tornApiManager.get("/faction/{id}/members", {
          userId: keyEntry.userId,
          apiKey: keyEntry.apiKey,
          pathParams: { id: mapping.factionId },
        });

        if (facRes && facRes.members) {
          const membersSet = new Set<number>();
          const leadersSet = new Set<number>();

          for (const [idStr, memberData] of Object.entries(facRes.members)) {
            const tornId = parseInt(idStr, 10);
            if (!isNaN(tornId)) {
              membersSet.add(tornId);
              if (
                memberData.position === "Leader" ||
                memberData.position === "Co-leader"
              ) {
                leadersSet.add(tornId);
              }
            }
          }

          factionMembersMap.set(mapping.factionId, membersSet);
          factionLeadersMap.set(mapping.factionId, leadersSet);
        }
      } catch (facErr) {
        logger.warn(
          `Failed to fetch members for faction ${mapping.factionId}:`,
          facErr,
        );
      }
    }

    // Fetch all verified users in DB
    const verifiedUsers = await db.verifiedUser.findMany();
    let processed = 0;
    let updated = 0;
    let errors = 0;

    for (const user of verifiedUsers) {
      processed++;
      try {
        const res = await runVerificationJob({
          guild_id: guildId,
          channel_id: "",
          discord_id: user.discordId,
          current_role_ids: [],
          current_nickname: user.tornName,
          triggered_by: triggeredBy,
        });

        if ("error" in res && res.error) {
          errors++;
        } else {
          updated++;
        }
      } catch (err) {
        errors++;
      }
    }

    finishLog();
    return { processed, updated, errors };
  } catch (err) {
    logger.error(
      `Error in runBulkGuildVerification for guild ${guildId}:`,
      err,
    );
    finishLog();
    return { processed: 0, updated: 0, errors: 1 };
  }
}
