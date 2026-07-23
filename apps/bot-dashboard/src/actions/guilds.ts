"use server";

import { auth } from "@/auth";
import type {
  FactionRoleMappingDocument,
  UpdateGuildConfigPayload,
  TerritoryBlueprintSummary,
  ReactionRoleMessageWithMappings,
  ReactionRoleMessagesListResponse,
  CreateReactionRoleMessagePayload,
  UpdateReactionRoleMessagePayload,
  AddEmojiMappingPayload,
  ReactionRoleMappingDocument,
} from "@sentinel/shared";

const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:3001";
const INTERNAL_SECRET = process.env.SENTINEL_INTERNAL_SECRET || "";

async function discordFetch(endpoint: string, options: RequestInit = {}) {
  if (!BOT_TOKEN) {
    throw new Error("Missing DISCORD_BOT_TOKEN in environment variables.");
  }

  const res = await fetch(`https://discord.com/api/v10${endpoint}`, {
    ...options,
    headers: {
      Authorization: `Bot ${BOT_TOKEN}`,
      "Content-Type": "application/json",
      ...options.headers,
    },
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Discord API error (${res.status}): ${errText}`);
  }

  return res.json();
}

export async function requestInitialization(guildId: string) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return { success: false, error: "Not authenticated" };
    }

    // 1. Check if request already exists via Fastify API
    const checkRes = await fetch(
      `${API_URL}/api/guilds/${guildId}/request-init`,
      {
        headers: {
          "x-sentinel-secret": INTERNAL_SECRET,
        },
        next: { revalidate: 0 },
      },
    );

    if (checkRes.ok) {
      const checkData = await checkRes.json();
      if (checkData.requested) {
        return {
          success: false,
          error:
            "An initialization request has already been submitted for this server.",
        };
      }
    }

    // 2. Resolve Bot Owner Discord ID
    let ownerId = process.env.SENTINEL_DISCORD_USER_ID;
    if (!ownerId) {
      try {
        const appInfo = await discordFetch("/oauth2/applications/@me");
        ownerId = appInfo.owner?.id;
      } catch (err) {
        console.error("Failed to dynamically fetch bot owner:", err);
      }
    }

    if (!ownerId) {
      return {
        success: false,
        error:
          "Could not resolve bot owner ID. Please configure SENTINEL_DISCORD_USER_ID.",
      };
    }

    // 3. Fetch Guild details to show in DM
    let guildName = "Unknown Server";
    try {
      const guildInfo = await discordFetch(`/guilds/${guildId}`);
      guildName = guildInfo.name;
    } catch (err) {
      console.error(`Failed to fetch guild details for ${guildId}:`, err);
    }

    // 4. Open DM Channel with the owner
    const dmChannel = await discordFetch("/users/@me/channels", {
      method: "POST",
      body: JSON.stringify({ recipient_id: ownerId }),
    });

    const channelId = dmChannel.id;

    // 5. Send Message to Owner DM with Interactive Button
    await discordFetch(`/channels/${channelId}/messages`, {
      method: "POST",
      body: JSON.stringify({
        embeds: [
          {
            title: "Sentinel Initialization Request",
            description: `A user has requested initialization for a guild.`,
            color: 0x3b82f6, // Blue
            fields: [
              { name: "Server Name", value: guildName, inline: true },
              { name: "Server ID", value: guildId, inline: true },
              {
                name: "Requested By",
                value: `<@${session.user.id}> (${session.user.name || "Unknown"})`,
                inline: false,
              },
            ],
            footer: {
              text: "Sentinel",
            },
            timestamp: new Date().toISOString(),
          },
        ],
        components: [
          {
            type: 1, // ACTION_ROW
            components: [
              {
                type: 2, // BUTTON
                style: 1, // PRIMARY (blue)
                label: "Initialize Guild",
                custom_id: `admin_guild_initialize_from_dm|${guildId}`,
              },
            ],
          },
        ],
      }),
    });

    // 6. Record request in database via Fastify API
    const recordRes = await fetch(
      `${API_URL}/api/guilds/${guildId}/request-init`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-sentinel-secret": INTERNAL_SECRET,
        },
        body: JSON.stringify({ userId: session.user.id }),
      },
    );

    if (!recordRes.ok) {
      console.error(
        "Failed to record initialization request in DB:",
        await recordRes.text(),
      );
    }

    return { success: true };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    console.error("Error requesting guild initialization:", err);
    return {
      success: false,
      error: err.message || "Failed to submit request.",
    };
  }
}

export async function updateGuildConfig(
  guildId: string,
  data: UpdateGuildConfigPayload,
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return { success: false, error: "Not authenticated" };
    }

    const res = await fetch(`${API_URL}/api/guilds/${guildId}/config`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "x-sentinel-secret": INTERNAL_SECRET,
      },
      body: JSON.stringify(data),
    });

    if (!res.ok) {
      const errText = await res.text();
      return { success: false, error: `API error: ${errText}` };
    }

    const result = await res.json();
    return { success: true, config: result.config };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    console.error("Error updating guild config action:", err);
    return { success: false, error: err.message || "Unexpected failure" };
  }
}

export async function deinitializeGuild(guildId: string) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return { success: false, error: "Not authenticated" };
    }

    // Verify bot owner status
    let botOwnerId = process.env.SENTINEL_DISCORD_USER_ID;
    if (!botOwnerId) {
      const botToken = process.env.DISCORD_BOT_TOKEN;
      const appRes = await fetch(
        "https://discord.com/api/v10/oauth2/applications/@me",
        {
          headers: { Authorization: `Bot ${botToken}` },
        },
      );
      if (appRes.ok) {
        const appInfo = await appRes.json();
        botOwnerId = appInfo.owner?.id;
      }
    }

    if (session.user.id !== botOwnerId) {
      return {
        success: false,
        error: "Unauthorized: Only the bot owner can de-initialize guilds",
      };
    }

    const res = await fetch(`${API_URL}/api/guilds/${guildId}/config`, {
      method: "DELETE",
      headers: {
        "x-sentinel-secret": INTERNAL_SECRET,
      },
    });

    if (!res.ok) {
      const errText = await res.text();
      return { success: false, error: `API error: ${errText}` };
    }

    return { success: true };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    console.error("Error de-initializing guild:", err);
    return { success: false, error: err.message || "Unexpected failure" };
  }
}

export async function addGuildApiKey(guildId: string, apiKey: string) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return { success: false, error: "Not authenticated" };
    }

    const providedBy = session.user.name || session.user.id;

    const res = await fetch(`${API_URL}/api/guilds/${guildId}/api-keys`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-sentinel-secret": INTERNAL_SECRET,
      },
      body: JSON.stringify({ api_key: apiKey, provided_by: providedBy }),
    });

    if (!res.ok) {
      const errText = await res.text();
      let errorMsg = `API error: ${errText}`;
      try {
        const parsed = JSON.parse(errText);
        if (parsed.error) errorMsg = parsed.error;
      } catch {}
      return { success: false, error: errorMsg };
    }

    const result = await res.json();
    return { success: true, apiKey: result.apiKey };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    console.error("Error adding guild api key action:", err);
    return { success: false, error: err.message || "Unexpected failure" };
  }
}

export async function deleteGuildApiKey(guildId: string, keyId: string) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return { success: false, error: "Not authenticated" };
    }

    const res = await fetch(
      `${API_URL}/api/guilds/${guildId}/api-keys/${keyId}`,
      {
        method: "DELETE",
        headers: {
          "x-sentinel-secret": INTERNAL_SECRET,
        },
      },
    );

    if (!res.ok) {
      const errText = await res.text();
      return { success: false, error: `API error: ${errText}` };
    }

    return { success: true };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    console.error("Error deleting guild api key action:", err);
    return { success: false, error: err.message || "Unexpected failure" };
  }
}

export async function setGuildApiKeyPrimary(guildId: string, keyId: string) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return { success: false, error: "Not authenticated" };
    }

    const res = await fetch(
      `${API_URL}/api/guilds/${guildId}/api-keys/${keyId}/primary`,
      {
        method: "PUT",
        headers: {
          "x-sentinel-secret": INTERNAL_SECRET,
        },
      },
    );

    if (!res.ok) {
      const errText = await res.text();
      return { success: false, error: `API error: ${errText}` };
    }

    return { success: true };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    console.error("Error setting primary guild api key action:", err);
    return { success: false, error: err.message || "Unexpected failure" };
  }
}

export async function getFactionRoleMappings(guildId: string) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return { success: false, error: "Not authenticated" };
    }

    const res = await fetch(`${API_URL}/api/guilds/${guildId}/faction-roles`, {
      headers: {
        "x-sentinel-secret": INTERNAL_SECRET,
      },
      next: { revalidate: 0 },
    });

    if (!res.ok) {
      const errText = await res.text();
      return { success: false, error: `API error: ${errText}` };
    }

    const data = await res.json();
    return { success: true, mappings: data };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    console.error("Error fetching faction mappings:", err);
    return { success: false, error: err.message || "Unexpected failure" };
  }
}

export async function createFactionRoleMapping(
  guildId: string,
  data: Omit<FactionRoleMappingDocument, "id" | "guild_id">,
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return { success: false, error: "Not authenticated" };
    }

    const res = await fetch(`${API_URL}/api/guilds/${guildId}/faction-roles`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-sentinel-secret": INTERNAL_SECRET,
      },
      body: JSON.stringify(data),
    });

    if (!res.ok) {
      const errText = await res.text();
      return { success: false, error: `API error: ${errText}` };
    }

    const created = await res.json();
    return { success: true, mapping: created };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    console.error("Error creating faction mapping:", err);
    return { success: false, error: err.message || "Unexpected failure" };
  }
}

export async function updateFactionRoleMapping(
  guildId: string,
  mappingId: string,
  data: Partial<Omit<FactionRoleMappingDocument, "id" | "guild_id">>,
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return { success: false, error: "Not authenticated" };
    }

    const res = await fetch(
      `${API_URL}/api/guilds/${guildId}/faction-roles/${mappingId}`,
      {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "x-sentinel-secret": INTERNAL_SECRET,
        },
        body: JSON.stringify(data),
      },
    );

    if (!res.ok) {
      const errText = await res.text();
      return { success: false, error: `API error: ${errText}` };
    }

    const updated = await res.json();
    return { success: true, mapping: updated };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    console.error("Error updating faction mapping:", err);
    return { success: false, error: err.message || "Unexpected failure" };
  }
}

export async function deleteFactionRoleMapping(
  guildId: string,
  mappingId: string,
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return { success: false, error: "Not authenticated" };
    }

    const res = await fetch(
      `${API_URL}/api/guilds/${guildId}/faction-roles/${mappingId}`,
      {
        method: "DELETE",
        headers: {
          "x-sentinel-secret": INTERNAL_SECRET,
        },
      },
    );

    if (!res.ok) {
      const errText = await res.text();
      return { success: false, error: `API error: ${errText}` };
    }

    return { success: true };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    console.error("Error deleting faction mapping:", err);
    return { success: false, error: err.message || "Unexpected failure" };
  }
}

export async function getFactionInfo(guildId: string, factionId: number) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return { success: false, error: "Not authenticated" };
    }

    const res = await fetch(
      `${API_URL}/api/guilds/${guildId}/faction-info/${factionId}`,
      {
        headers: {
          "x-sentinel-secret": INTERNAL_SECRET,
        },
        next: { revalidate: 300 },
      },
    );

    if (!res.ok) {
      const errText = await res.text();
      return { success: false, error: `API error: ${errText}` };
    }

    const data = await res.json();
    return { success: true, faction: data };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    console.error("Error fetching faction info action:", err);
    return { success: false, error: err.message || "Unexpected failure" };
  }
}

export async function getTerritoryList() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return { success: false, error: "Not authenticated" };
    }

    const res = await fetch(`${API_URL}/api/guilds/territories/list`, {
      headers: {
        "x-sentinel-secret": INTERNAL_SECRET,
      },
      next: { revalidate: 86400 },
    });

    if (!res.ok) {
      const errText = await res.text();
      return { success: false, error: `API error: ${errText}` };
    }

    const data = await res.json();
    return {
      success: true,
      territories: data as TerritoryBlueprintSummary[],
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    console.error("Error fetching territory list action:", err);
    return { success: false, error: err.message || "Unexpected failure" };
  }
}

// ─── Reaction Roles ─────────────────────────────────────────────────────────

/**
 * Fetches all reaction role messages for a guild, each with their emoji mappings.
 */
export async function getReactionRoleMessages(guildId: string): Promise<{
  success: boolean;
  messages?: ReactionRoleMessagesListResponse;
  error?: string;
}> {
  try {
    const res = await fetch(`${API_URL}/api/guilds/${guildId}/reaction-roles`, {
      headers: { "x-sentinel-secret": INTERNAL_SECRET },
      cache: "no-store",
    });
    if (!res.ok) return { success: false, error: await res.text() };
    const data = (await res.json()) as ReactionRoleMessagesListResponse;
    return { success: true, messages: data };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    return { success: false, error: err.message || "Unexpected failure" };
  }
}

/**
 * Creates a new reaction role message record.
 */
export async function createReactionRoleMessage(
  guildId: string,
  payload: CreateReactionRoleMessagePayload,
): Promise<{
  success: boolean;
  message?: ReactionRoleMessageWithMappings;
  error?: string;
}> {
  try {
    const res = await fetch(`${API_URL}/api/guilds/${guildId}/reaction-roles`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-sentinel-secret": INTERNAL_SECRET,
      },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const errText = await res.text();
      try {
        const p = JSON.parse(errText);
        if (p.error) return { success: false, error: p.error };
      } catch {}
      return { success: false, error: errText };
    }
    const data = await res.json();
    return {
      success: true,
      message: data.message as ReactionRoleMessageWithMappings,
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    return { success: false, error: err.message || "Unexpected failure" };
  }
}

/**
 * Updates metadata for an existing reaction role message.
 */
export async function updateReactionRoleMessage(
  guildId: string,
  msgId: string,
  payload: UpdateReactionRoleMessagePayload,
): Promise<{
  success: boolean;
  message?: ReactionRoleMessageWithMappings;
  error?: string;
}> {
  try {
    const res = await fetch(
      `${API_URL}/api/guilds/${guildId}/reaction-roles/${msgId}`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "x-sentinel-secret": INTERNAL_SECRET,
        },
        body: JSON.stringify(payload),
      },
    );
    if (!res.ok) {
      const errText = await res.text();
      try {
        const p = JSON.parse(errText);
        if (p.error) return { success: false, error: p.error };
      } catch {}
      return { success: false, error: errText };
    }
    const data = await res.json();
    return {
      success: true,
      message: data.message as ReactionRoleMessageWithMappings,
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    return { success: false, error: err.message || "Unexpected failure" };
  }
}

/**
 * Deletes a reaction role message and all its emoji mappings.
 */
export async function deleteReactionRoleMessage(
  guildId: string,
  msgId: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const res = await fetch(
      `${API_URL}/api/guilds/${guildId}/reaction-roles/${msgId}`,
      {
        method: "DELETE",
        headers: { "x-sentinel-secret": INTERNAL_SECRET },
      },
    );
    if (!res.ok) {
      const errText = await res.text();
      try {
        const p = JSON.parse(errText);
        if (p.error) return { success: false, error: p.error };
      } catch {}
      return { success: false, error: errText };
    }
    return { success: true };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    return { success: false, error: err.message || "Unexpected failure" };
  }
}

/**
 * Adds an emoji → role mapping to a reaction role message.
 */
export async function addEmojiMapping(
  guildId: string,
  msgId: string,
  payload: AddEmojiMappingPayload,
): Promise<{
  success: boolean;
  mapping?: ReactionRoleMappingDocument;
  error?: string;
}> {
  try {
    const res = await fetch(
      `${API_URL}/api/guilds/${guildId}/reaction-roles/${msgId}/emojis`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-sentinel-secret": INTERNAL_SECRET,
        },
        body: JSON.stringify(payload),
      },
    );
    if (!res.ok) {
      const errText = await res.text();
      try {
        const p = JSON.parse(errText);
        if (p.error) return { success: false, error: p.error };
      } catch {}
      return { success: false, error: errText };
    }
    const data = await res.json();
    return {
      success: true,
      mapping: data.mapping as ReactionRoleMappingDocument,
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    return { success: false, error: err.message || "Unexpected failure" };
  }
}

/**
 * Removes a single emoji → role mapping from a reaction role message.
 */
export async function deleteEmojiMapping(
  guildId: string,
  msgId: string,
  emojiMappingId: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const res = await fetch(
      `${API_URL}/api/guilds/${guildId}/reaction-roles/${msgId}/emojis/${emojiMappingId}`,
      {
        method: "DELETE",
        headers: { "x-sentinel-secret": INTERNAL_SECRET },
      },
    );
    if (!res.ok) {
      const errText = await res.text();
      try {
        const p = JSON.parse(errText);
        if (p.error) return { success: false, error: p.error };
      } catch {}
      return { success: false, error: errText };
    }
    return { success: true };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    return { success: false, error: err.message || "Unexpected failure" };
  }
}

/**
 * Server action to manually trigger Discord slash command deployment for a guild
 */
export async function deployGuildSlashCommandsAction(
  guildId: string,
): Promise<{
  success: boolean;
  deployedCount?: number;
  message?: string;
  error?: string;
}> {
  try {
    const res = await fetch(`${API_URL}/api/guilds/${guildId}/deploy-commands`, {
      method: "POST",
      headers: { "x-sentinel-secret": INTERNAL_SECRET },
    });
    if (!res.ok) {
      const errText = await res.text();
      try {
        const p = JSON.parse(errText);
        if (p.error) return { success: false, error: p.error };
      } catch {}
      return { success: false, error: errText };
    }
    const data = await res.json();
    return {
      success: true,
      deployedCount: data.deployedCount,
      message: data.message || "Slash commands deployed successfully.",
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    return {
      success: false,
      error: err.message || "Failed to deploy slash commands.",
    };
  }
}
