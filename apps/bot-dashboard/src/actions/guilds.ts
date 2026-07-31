"use server";

import { auth } from "@/auth";
import { revalidatePath } from "next/cache";
import { apiFetch, customFetch } from "@/lib/fetch";

function getApiUrl(): string {
  return process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:3001";
}

/**
 * Helper to dispatch Discord Embed to the guild's log channel (if set)
 */
async function dispatchDiscordLogEmbed(
  guildId: string,
  title: string,
  fields: { name: string; value: string; inline?: boolean }[],
  user?: { name?: string | null; id?: string | null; image?: string | null },
  overrideChannelId?: string | null,
) {
  const botToken = process.env.DISCORD_BOT_TOKEN;
  if (!botToken) return;

  try {
    let targetChannelId = overrideChannelId;

    if (targetChannelId === undefined) {
      const configRes = await getGuildConfigFromApi(guildId);
      targetChannelId = configRes?.config?.logChannelId || null;
    }

    if (!targetChannelId) return;

    const embed = {
      title,
      color: 0x3b82f6, // Blue
      fields,
      footer: {
        text: `Sentinel • ${user?.name || user?.id || "Dashboard Admin"}`,
        icon_url: user?.image || undefined,
      },
      timestamp: new Date().toISOString(),
    };

    await fetch(
      `https://discord.com/api/v10/channels/${targetChannelId}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bot ${botToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          embeds: [embed],
        }),
      },
    );
  } catch (err) {
    console.error(`Failed to dispatch log embed for guild ${guildId}:`, err);
  }
}

export async function getGuildConfigFromApi(guildId: string) {
  const session = await auth();
  if (!session?.user?.id) {
    throw new Error("Not authenticated");
  }

  const res = await customFetch(`${getApiUrl()}/api/guilds/${guildId}/config`, {
    next: { revalidate: 0 },
  });

  if (!res.ok) {
    throw new Error(`API returned status ${res.status}`);
  }

  const data = await res.json();
  return data;
}

/**
 * Resolves a faction ID to its name and tag from the Sentinel DB.
 * Returns null if the faction is not found or the request fails.
 */
export async function lookupFaction(
  factionId: number,
): Promise<{ id: number; name: string; tag: string | null } | null> {
  try {
    const res = await customFetch(`${getApiUrl()}/api/factions/${factionId}`, {
      next: { revalidate: 0 },
    });

    if (!res.ok) return null;

    const data = await res.json();
    return data.faction ?? null;
  } catch {
    return null;
  }
}

export async function updateGuildGeneralSettings(

  guildId: string,
  payload: {
    logChannelId?: string | null;
    adminRoleIds?: string[];
    enabledModules?: string[];
  },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return { success: false, error: "Not authenticated" };
  }

  try {
    // 1. Fetch current config before update to determine existing log channel
    let existingLogChannelId: string | null = null;
    try {
      const current = await getGuildConfigFromApi(guildId);
      existingLogChannelId = current?.config?.logChannelId || null;
    } catch {
      // Ignore if config fetch fails
    }

    // 2. Perform settings update via Fastify API
    const res = await customFetch(`${getApiUrl()}/api/guilds/${guildId}/config`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const errText = await res.text();
      return { success: false, error: `API error: ${errText}` };
    }

    const data = await res.json();
    revalidatePath(`/guilds/${guildId}`);

    // 3. Dispatch Discord Log Embed for modified settings
    const targetChannel =
      payload.logChannelId !== undefined
        ? payload.logChannelId
        : existingLogChannelId;

    if (targetChannel) {
      const fields: { name: string; value: string; inline?: boolean }[] = [];

      if (payload.logChannelId !== undefined) {
        fields.push({
          name: "Audit Log Channel",
          value: payload.logChannelId
            ? `<#${payload.logChannelId}>`
            : "*Disabled / None*",
          inline: true,
        });
      }

      if (payload.adminRoleIds !== undefined) {
        fields.push({
          name: "Administrator Roles",
          value:
            payload.adminRoleIds.length > 0
              ? payload.adminRoleIds.map((id) => `<@&${id}>`).join(", ")
              : "*Default Access (Owner & Admins)*",
          inline: true,
        });
      }

      if (payload.enabledModules !== undefined) {
        fields.push({
          name: "Active Modules",
          value:
            payload.enabledModules.length > 0
              ? payload.enabledModules
                  .map(
                    (m) =>
                      m.charAt(0).toUpperCase() + m.slice(1).replace("_", " "),
                  )
                  .join(", ")
              : "*All Modules Disabled*",
          inline: false,
        });
      }

      if (fields.length > 0) {
        await dispatchDiscordLogEmbed(
          guildId,
          "Guild Settings Updated",
          fields,
          session.user,
          targetChannel,
        );
      }
    }

    return { success: true, config: data.config };
  } catch (err) {
    console.error("Failed to update guild settings:", err);
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to update settings",
    };
  }
}

export async function addGuildApiKey(guildId: string, apiKey: string) {
  const session = await auth();
  if (!session?.user?.id) {
    return { success: false, error: "Not authenticated" };
  }

  if (!apiKey || apiKey.trim().length !== 16) {
    return { success: false, error: "Torn API key must be 16 characters" };
  }

  try {
    const providedBy = session.user.name || session.user.id || "Dashboard User";

    const res = await customFetch(`${getApiUrl()}/api/guilds/${guildId}/api-keys`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ apiKey, providedBy }),
    });

    const data = await res.json();

    if (!res.ok) {
      return {
        success: false,
        error: data.error || `API error (${res.status})`,
      };
    }

    revalidatePath(`/guilds/${guildId}`);

    // Dispatch Audit Log Embed
    await dispatchDiscordLogEmbed(
      guildId,
      "Torn API Key Registered",
      [
        { name: "Key Status", value: "Valid & Active", inline: true },
        { name: "Provided By", value: providedBy, inline: true },
      ],
      session.user,
    );

    return { success: true, apiKey: data.apiKey };
  } catch (err) {
    console.error("Failed to add guild API key:", err);
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to add API key",
    };
  }
}

export async function updateVerificationSettings(
  guildId: string,
  payload: {
    verifiedRoleIds?: string[];
    nicknameTemplate?: string | null;
    verifyOnJoin?: boolean;
    verifyCron?: boolean;
    verifyCronInterval?: number;
    protectedRoleIds?: string[];
    factionListChannelId?: string | null;
  },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return { success: false, error: "Not authenticated" };
  }

  try {
    const res = await customFetch(`${getApiUrl()}/api/guilds/${guildId}/config`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const errText = await res.text();
      return { success: false, error: `API error: ${errText}` };
    }

    const data = await res.json();
    revalidatePath(`/guilds/${guildId}/verification`);
    revalidatePath(`/guilds/${guildId}`);

    const embedFields: { name: string; value: string; inline?: boolean }[] = [];

    if (payload.verifiedRoleIds !== undefined) {
      embedFields.push({
        name: "Verified Roles",
        value:
          payload.verifiedRoleIds.length > 0
            ? payload.verifiedRoleIds.map((id) => `<@&${id}>`).join(", ")
            : "*None*",
        inline: false,
      });
    }

    if (payload.nicknameTemplate !== undefined) {
      embedFields.push({
        name: "Nickname Template",
        value: payload.nicknameTemplate || "*Disabled*",
        inline: true,
      });
    }

    if (payload.verifyOnJoin !== undefined) {
      embedFields.push({
        name: "Verify on Join",
        value: payload.verifyOnJoin ? "Enabled" : "Disabled",
        inline: true,
      });
    }

    if (payload.verifyCron !== undefined) {
      embedFields.push({
        name: "Background Cron",
        value: payload.verifyCron ? "Enabled" : "Disabled",
        inline: true,
      });
    }

    if (payload.verifyCronInterval !== undefined) {
      embedFields.push({
        name: "Cron Interval",
        value: `${payload.verifyCronInterval}h`,
        inline: true,
      });
    }

    if (payload.protectedRoleIds !== undefined) {
      embedFields.push({
        name: "Protected Roles",
        value:
          payload.protectedRoleIds.length > 0
            ? payload.protectedRoleIds.map((id) => `<@&${id}>`).join(", ")
            : "*None*",
        inline: false,
      });
    }

    if (payload.factionListChannelId !== undefined) {
      embedFields.push({
        name: "Faction List Channel",
        value: payload.factionListChannelId
          ? `<#${payload.factionListChannelId}>`
          : "*Disabled / None*",
        inline: true,
      });
    }

    if (embedFields.length > 0) {
      await dispatchDiscordLogEmbed(
        guildId,
        "Verification Settings Updated",
        embedFields,
        session.user,
      );
    }


    return { success: true, config: data.config };
  } catch (err) {
    console.error("Failed to update verification settings:", err);
    return {
      success: false,
      error:
        err instanceof Error ? err.message : "Failed to update verification settings",
    };
  }
}

export async function addFactionRoleMapping(
  guildId: string,
  payload: {
    factionId: number;
    factionName?: string;
    memberRoleIds: string[];
    leaderRoleIds: string[];
  },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return { success: false, error: "Not authenticated" };
  }

  try {
    const res = await customFetch(
      `${getApiUrl()}/api/guilds/${guildId}/faction-mappings`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      },
    );

    if (!res.ok) {
      const errText = await res.text();
      return { success: false, error: `API error: ${errText}` };
    }

    const data = await res.json();
    revalidatePath(`/guilds/${guildId}/verification`);

    await dispatchDiscordLogEmbed(
      guildId,
      "Faction Mapping Added",
      [
        {
          name: "Faction",
          value: payload.factionName
            ? `${payload.factionName} (\`${payload.factionId}\`)`
            : `\`${payload.factionId}\``,
          inline: true,
        },
        {
          name: "Member Roles",
          value:
            payload.memberRoleIds.length > 0
              ? payload.memberRoleIds.map((id) => `<@&${id}>`).join(", ")
              : "*None*",
          inline: false,
        },
        {
          name: "Leader Roles",
          value:
            payload.leaderRoleIds.length > 0
              ? payload.leaderRoleIds.map((id) => `<@&${id}>`).join(", ")
              : "*None*",
          inline: false,
        },
      ],
      session.user,
    );

    return { success: true, mapping: data.mapping };
  } catch (err) {
    console.error("Failed to add faction role mapping:", err);
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to add faction mapping",
    };
  }
}

export async function updateFactionRoleMapping(
  guildId: string,
  mappingId: string,
  payload: {
    factionId: number;
    factionName: string | null;
    memberRoleIds: string[];
    leaderRoleIds: string[];
  },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return { success: false, error: "Not authenticated" };
  }

  try {
    const res = await customFetch(
      `${getApiUrl()}/api/guilds/${guildId}/faction-mappings/${mappingId}`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          memberRoleIds: payload.memberRoleIds,
          leaderRoleIds: payload.leaderRoleIds,
        }),
      },
    );

    if (!res.ok) {
      const errText = await res.text();
      return { success: false, error: `API error: ${errText}` };
    }

    const data = await res.json();
    revalidatePath(`/guilds/${guildId}/verification`);

    await dispatchDiscordLogEmbed(
      guildId,
      "Faction Mapping Updated",
      [
        {
          name: "Faction",
          value: payload.factionName
            ? `${payload.factionName} (\`${payload.factionId}\`)`
            : `\`${payload.factionId}\``,
          inline: true,
        },
        {
          name: "Member Roles",
          value:
            payload.memberRoleIds.length > 0
              ? payload.memberRoleIds.map((id) => `<@&${id}>`).join(", ")
              : "*None*",
          inline: false,
        },
        {
          name: "Leader Roles",
          value:
            payload.leaderRoleIds.length > 0
              ? payload.leaderRoleIds.map((id) => `<@&${id}>`).join(", ")
              : "*None*",
          inline: false,
        },
      ],
      session.user,
    );

    return { success: true, mapping: data.mapping };
  } catch (err) {
    console.error("Failed to update faction role mapping:", err);
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to update faction mapping",
    };
  }
}

export async function deleteFactionRoleMapping(

  guildId: string,
  mappingId: string,
  factionId: number,
  factionName: string | null,
) {
  const session = await auth();
  if (!session?.user?.id) {
    return { success: false, error: "Not authenticated" };
  }

  try {
    const res = await customFetch(
      `${getApiUrl()}/api/guilds/${guildId}/faction-mappings/${mappingId}`,
      { method: "DELETE" },
    );

    if (!res.ok) {
      const errText = await res.text();
      return { success: false, error: `API error: ${errText}` };
    }

    revalidatePath(`/guilds/${guildId}/verification`);

    await dispatchDiscordLogEmbed(
      guildId,
      "Faction Mapping Removed",
      [
        {
          name: "Faction",
          value: factionName
            ? `${factionName} (\`${factionId}\`)`
            : `\`${factionId}\``,
          inline: true,
        },
      ],
      session.user,
    );

    return { success: true };
  } catch (err) {
    console.error("Failed to delete faction role mapping:", err);
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to delete faction mapping",
    };
  }
}


export async function deleteGuildApiKey(guildId: string, keyId: string) {
  const session = await auth();
  if (!session?.user?.id) {
    return { success: false, error: "Not authenticated" };
  }

  try {
    const res = await customFetch(
      `${getApiUrl()}/api/guilds/${guildId}/api-keys/${keyId}`,
      {
        method: "DELETE",
      },
    );

    if (!res.ok) {
      const errText = await res.text();
      return { success: false, error: `API error: ${errText}` };
    }

    revalidatePath(`/guilds/${guildId}`);

    // Dispatch Audit Log Embed
    await dispatchDiscordLogEmbed(
      guildId,
      "Torn API Key Revoked",
      [
        { name: "Key ID", value: keyId, inline: true },
        { name: "Action", value: "Key deleted from database", inline: true },
      ],
      session.user,
    );

    return { success: true };
  } catch (err) {
    console.error("Failed to delete guild API key:", err);
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to delete API key",
    };
  }
}

export async function updateTerritorySettings(
  guildId: string,
  payload: {
    ttFullChannelId?: string | null;
    ttFilteredChannelId?: string | null;
    ttTerritoryIds?: string[];
    ttFactionIds?: number[];
  },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return { success: false, error: "Not authenticated" };
  }

  try {
    const res = await customFetch(`${getApiUrl()}/api/guilds/${guildId}/config`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const errText = await res.text();
      return { success: false, error: `API error: ${errText}` };
    }

    const data = await res.json();
    revalidatePath(`/guilds/${guildId}/territory`);

    const fields: { name: string; value: string; inline?: boolean }[] = [];

    if (payload.ttFullChannelId !== undefined) {
      fields.push({
        name: "Full Feed Channel",
        value: payload.ttFullChannelId
          ? `<#${payload.ttFullChannelId}>`
          : "*Disabled / None*",
        inline: true,
      });
    }

    if (payload.ttFilteredChannelId !== undefined) {
      fields.push({
        name: "Filtered Feed Channel",
        value: payload.ttFilteredChannelId
          ? `<#${payload.ttFilteredChannelId}>`
          : "*Disabled / None*",
        inline: true,
      });
    }

    if (payload.ttTerritoryIds !== undefined) {
      fields.push({
        name: "Filtered Territories",
        value:
          payload.ttTerritoryIds.length > 0
            ? payload.ttTerritoryIds.map((id) => `\`${id}\``).join(", ")
            : "*All Territories*",
        inline: false,
      });
    }

    if (payload.ttFactionIds !== undefined) {
      fields.push({
        name: "Filtered Factions",
        value:
          payload.ttFactionIds.length > 0
            ? payload.ttFactionIds.map((id) => `\`${id}\``).join(", ")
            : "*All Factions*",
        inline: false,
      });
    }

    if (fields.length > 0) {
      await dispatchDiscordLogEmbed(
        guildId,
        "Territory Alert Settings Updated",
        fields,
        session.user,
      );
    }

    return { success: true, config: data.config };
  } catch (err) {
    console.error("Failed to update territory settings:", err);
    return {
      success: false,
      error:
        err instanceof Error
          ? err.message
          : "Failed to update territory settings",
    };
  }
}

/**
 * Fetches all territory blueprints/codes from the database via API.
 */
export async function getTerritories(): Promise<{ id: string; sector?: number }[]> {
  try {
    const res = await customFetch(`${getApiUrl()}/api/territories`, {
      next: { revalidate: 3600 },
    });
    if (!res.ok) return [];
    const data = await res.json();
    return data.territories ?? [];
  } catch {
    return [];
  }
}

export interface ReactionRoleMappingPayload {
  id?: string;
  emoji: string;
  roleId: string;
  description?: string | null;
}

export interface ReactionRoleMessageRecord {
  id: string;
  guildId: string;
  title: string;
  channelId: string;
  messageId: string | null;
  requiredRoleId: string | null;
  mappings: ReactionRoleMappingPayload[];
  createdAt: string;
  updatedAt: string;
}

export async function getReactionRoleMessages(
  guildId: string,
): Promise<ReactionRoleMessageRecord[]> {
  try {
    const res = await customFetch(
      `${getApiUrl()}/api/guilds/${guildId}/reaction-roles`,
      {
        next: { revalidate: 0 },
      },
    );
    if (!res.ok) return [];
    const data = await res.json();
    return data.reactionRoleMessages ?? [];
  } catch (err) {
    console.error("Failed to fetch reaction role messages:", err);
    return [];
  }
}

export async function createReactionRoleMessage(
  guildId: string,
  payload: {
    title: string;
    channelId: string;
    requiredRoleId?: string | null;
    mappings: { emoji: string; roleId: string; description?: string | null }[];
  },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return { success: false, error: "Not authenticated" };
  }

  try {
    const res = await customFetch(
      `${getApiUrl()}/api/guilds/${guildId}/reaction-roles`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      },
    );

    if (!res.ok) {
      const errText = await res.text();
      return { success: false, error: `API error: ${errText}` };
    }

    const data = await res.json();
    revalidatePath(`/guilds/${guildId}/reaction-roles`);

    await dispatchDiscordLogEmbed(
      guildId,
      "Reaction Role Menu Created",
      [
        { name: "Title", value: payload.title, inline: true },
        { name: "Target Channel", value: `<#${payload.channelId}>`, inline: true },
        {
          name: "Required Role",
          value: payload.requiredRoleId ? `<@&${payload.requiredRoleId}>` : "*None (Public)*",
          inline: true,
        },
        {
          name: "Emoji Mappings",
          value: `${payload.mappings.length} role bindings configured`,
          inline: false,
        },
      ],
      session.user,
    );

    return { success: true, message: data.message };
  } catch (err) {
    console.error("Failed to create reaction role message:", err);
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to create reaction role message",
    };
  }
}

export async function updateReactionRoleMessage(
  guildId: string,
  messageId: string,
  payload: {
    title: string;
    channelId: string;
    requiredRoleId?: string | null;
    mappings: { emoji: string; roleId: string; description?: string | null }[];
  },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return { success: false, error: "Not authenticated" };
  }

  try {
    const res = await customFetch(
      `${getApiUrl()}/api/guilds/${guildId}/reaction-roles/${messageId}`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      },
    );

    if (!res.ok) {
      const errText = await res.text();
      return { success: false, error: `API error: ${errText}` };
    }

    const data = await res.json();
    revalidatePath(`/guilds/${guildId}/reaction-roles`);

    await dispatchDiscordLogEmbed(
      guildId,
      "Reaction Role Menu Updated",
      [
        { name: "Title", value: payload.title, inline: true },
        { name: "Target Channel", value: `<#${payload.channelId}>`, inline: true },
        {
          name: "Required Role",
          value: payload.requiredRoleId ? `<@&${payload.requiredRoleId}>` : "*None (Public)*",
          inline: true,
        },
        {
          name: "Emoji Mappings",
          value: `${payload.mappings.length} role bindings updated`,
          inline: false,
        },
      ],
      session.user,
    );

    return { success: true, message: data.message };
  } catch (err) {
    console.error("Failed to update reaction role message:", err);
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to update reaction role message",
    };
  }
}

export async function deleteReactionRoleMessage(
  guildId: string,
  messageId: string,
  title: string,
) {
  const session = await auth();
  if (!session?.user?.id) {
    return { success: false, error: "Not authenticated" };
  }

  try {
    const res = await customFetch(
      `${getApiUrl()}/api/guilds/${guildId}/reaction-roles/${messageId}`,
      { method: "DELETE" },
    );

    if (!res.ok) {
      const errText = await res.text();
      return { success: false, error: `API error: ${errText}` };
    }

    revalidatePath(`/guilds/${guildId}/reaction-roles`);

    await dispatchDiscordLogEmbed(
      guildId,
      "Reaction Role Menu Removed",
      [{ name: "Title", value: title, inline: true }],
      session.user,
    );

    return { success: true };
  } catch (err) {
    console.error("Failed to delete reaction role message:", err);
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to delete reaction role message",
    };
  }
}


