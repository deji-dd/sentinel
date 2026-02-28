/**
 * Auto-Verify Module
 * Automatically verifies new members when they join guilds
 */

import { Client, GuildMember, EmbedBuilder } from "discord.js";
import { TABLE_NAMES, getNextApiKey } from "@sentinel/shared";
import { type TornApiComponents } from "@sentinel/shared";
import { supabase } from "./supabase.js";
import { getGuildApiKeys } from "./guild-api-keys.js";
import { logGuildSuccess, logGuildError } from "./guild-logger.js";
import { tornApi } from "../services/torn-client.js";

type UserGenericResponse = TornApiComponents["schemas"]["UserDiscordResponse"] &
  TornApiComponents["schemas"]["UserFactionResponse"] &
  TornApiComponents["schemas"]["UserProfileResponse"];

interface VerificationResult {
  status: "success" | "not_linked" | "error";
  title: string;
  description: string;
  color: number;
  data?: {
    name: string;
    id: number;
    faction?: { name: string; tag: string };
  };
  errorMessage?: string;
}

/**
 * Handle member join event - auto-verify if enabled
 */
export async function handleMemberJoin(
  member: GuildMember,
  client: Client,
): Promise<void> {
  try {
    // Skip bots
    if (member.user.bot) {
      return;
    }

    const guildId = member.guild.id;

    // Get guild config to check if auto-verify is enabled
    const { data: guildConfig, error: configError } = await supabase
      .from(TABLE_NAMES.GUILD_CONFIG)
      .select("auto_verify, nickname_template, verified_role_id")
      .eq("guild_id", guildId)
      .single();

    if (configError || !guildConfig) {
      // Guild not configured, skip
      return;
    }

    if (!guildConfig.auto_verify) {
      // Auto-verify not enabled for this guild
      return;
    }

    // Get API keys from guild
    const apiKeys = await getGuildApiKeys(guildId);

    if (apiKeys.length === 0) {
      // No API keys configured for this guild, skip
      return;
    }

    // Try to verify the user
    let verificationResult: VerificationResult | null = null;

    try {
      verificationResult = await attemptAutoVerification(
        member,
        guildId,
        apiKeys,
        guildConfig,
      );
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";

      const isNotLinked = /Incorrect ID/i.test(errorMessage);

      if (isNotLinked) {
        verificationResult = {
          status: "not_linked",
          title: "❌ Not Linked to Torn",
          description: "Your Discord account is not linked to a Torn account.",
          color: 0xef4444,
          errorMessage:
            "This Discord account is not linked to any Torn account",
        };
      } else {
        verificationResult = {
          status: "error",
          title: "❌ Verification Failed",
          description: `An unexpected error occurred. Please try the /verify command manually. (${errorMessage})`,
          color: 0xef4444,
          errorMessage,
        };
      }

      console.error(
        `[Auto-Verify] Error verifying ${member.user.username} (${member.id}):`,
        error,
      );

      if (!isNotLinked) {
        await logGuildError(
          guildId,
          client,
          "Auto-Verify: Unexpected Error",
          error instanceof Error ? error : String(error),
          `Unexpected error verifying ${member.user}.`,
        );
      }
    }

    // Send DM with verification results
    if (verificationResult) {
      await sendVerificationResultsDM(member, verificationResult);
    }
  } catch (error) {
    console.error("[Auto-Verify] Unexpected error:", error);
  }
}

/**
 * Attempt to verify user and assign roles
 */
async function attemptAutoVerification(
  member: GuildMember,
  guildId: string,
  apiKeys: string[],
  guildConfig: {
    auto_verify: boolean;
    nickname_template: string;
    verified_role_id: string | null;
  },
): Promise<VerificationResult> {
  const apiKey = getNextApiKey(guildId, apiKeys);

  const response = await tornApi.get<UserGenericResponse>(`/user`, {
    apiKey,
    queryParams: {
      selections: ["discord", "faction", "profile"],
      id: member.id,
    },
  });

  if (!response.discord) {
    // Discord not linked but other data present
    return {
      status: "error",
      title: "❌ Verification Failed",
      description:
        "Your account exists but verification failed. Please try the /verify command manually.",
      color: 0xef4444,
      errorMessage: "Discord not linked to account",
    };
  }

  // Validate that required fields exist in response
  if (!response.profile?.id || !response.profile?.name) {
    return {
      status: "error",
      title: "❌ Verification Failed",
      description: `An error occurred while verifying your account: incomplete response from Torn API. Please try the /verify command manually.`,
      color: 0xef4444,
      errorMessage: `Torn API returned incomplete data: player_id=${response.profile?.id}, name=${response.profile?.name}`,
    };
  }

  // Successfully verified - store in database
  await supabase.from(TABLE_NAMES.VERIFIED_USERS).upsert({
    discord_id: member.id,
    torn_player_id: response.profile.id,
    torn_player_name: response.profile.name,
    faction_id: response.faction?.id || null,
    faction_name: response.faction?.name || null,
    verified_at: new Date().toISOString(),
  });

  // Assign nickname
  const rolesAdded: string[] = [];
  const rolesFailed: string[] = [];

  try {
    const nickname = guildConfig.nickname_template
      .replace("{name}", response.profile.name)
      .replace("{id}", response.profile.id.toString())
      .replace("{tag}", response.faction?.tag || "");

    await member.setNickname(nickname);
  } catch (nicknameError) {
    console.error(
      `[Auto-Verify] Failed to set nickname for ${member.user.username}:`,
      nicknameError,
    );
    await logGuildError(
      member.guild.id,
      member.client,
      "Auto-Verify: Nickname Failed",
      nicknameError instanceof Error ? nicknameError : String(nicknameError),
      `Failed to set nickname for ${member.user}.`,
    );
  }

  // Assign verification role if configured
  if (guildConfig.verified_role_id) {
    try {
      await member.roles.add(guildConfig.verified_role_id);
      rolesAdded.push(guildConfig.verified_role_id);
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
    } catch (_roleError) {
      rolesFailed.push(guildConfig.verified_role_id);
    }
  }

  // Assign faction role if mapping exists
  if (response.faction?.id) {
    const { data: factionRole } = await supabase
      .from(TABLE_NAMES.FACTION_ROLES)
      .select("role_ids")
      .eq("guild_id", member.guild.id)
      .eq("faction_id", response.faction.id)
      .single();

    if (factionRole && factionRole.role_ids.length > 0) {
      try {
        await member.roles.add(factionRole.role_ids);
        rolesAdded.push(...factionRole.role_ids);
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
      } catch (_roleError) {
        rolesFailed.push(...factionRole.role_ids);
      }
    }
  }

  // Build guild log fields
  const logFields: Array<{
    name: string;
    value: string;
    inline: boolean;
  }> = [
    { name: "Discord ID", value: member.id, inline: true },
    {
      name: "Torn ID",
      value: String(response.profile.id),
      inline: true,
    },
  ];

  if (rolesAdded.length > 0) {
    logFields.push({
      name: "✅ Roles Added",
      value: rolesAdded.map((id) => `<@&${id}>`).join(", "),
      inline: false,
    });
  }

  if (rolesFailed.length > 0) {
    logFields.push({
      name: "❌ Roles Failed",
      value: rolesFailed.map((id) => `<@&${id}>`).join(", "),
      inline: false,
    });
  }

  await logGuildSuccess(
    member.guild.id,
    member.client,
    "Auto-Verify: Success",
    `${member.user} verified as **${response.profile.name}** (${response.profile.id}).`,
    logFields,
  );

  return {
    status: "success",
    title: "✅ Automatically Verified",
    description: `Welcome to **${member.guild.name}**! You've been automatically verified.`,
    color: 0x22c55e,
    data: {
      name: response.profile.name,
      id: response.profile.id,
      faction: response.faction
        ? {
            name: response.faction.name,
            tag: response.faction.tag,
          }
        : undefined,
    },
  };
}

/**
 * Send verification results via DM to member
 */
async function sendVerificationResultsDM(
  member: GuildMember,
  verificationResult: VerificationResult,
): Promise<void> {
  try {
    const dmEmbed = new EmbedBuilder()
      .setColor(verificationResult.color)
      .setTitle(verificationResult.title)
      .setDescription(verificationResult.description);

    if (verificationResult.data) {
      dmEmbed.addFields([
        {
          name: "Player Name",
          value: verificationResult.data.name,
          inline: true,
        },
        {
          name: "Player ID",
          value: String(verificationResult.data.id),
          inline: true,
        },
      ]);
      if (verificationResult.data.faction) {
        dmEmbed.addFields([
          {
            name: "Faction",
            value: `${verificationResult.data.faction.name} [${verificationResult.data.faction.tag}]`,
          },
        ]);
      }
    }

    await member.send({ embeds: [dmEmbed] });
  } catch (dmError) {
    console.warn(
      `[Auto-Verify] Failed to send verification DM to ${member.user.username}:`,
      dmError,
    );
    // Don't fail the entire verification process if DM fails
  }
}
