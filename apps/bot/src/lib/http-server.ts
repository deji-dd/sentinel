import express, { type Request, type Response } from "express";
import { EmbedBuilder, type Client } from "discord.js";
import { TABLE_NAMES } from "@sentinel/shared";
import { supabase } from "./supabase.js";

const app = express();
app.use(express.json());

let discordClient: Client;

const ASSIST_PROXY_SECRET_HEADER = "Proxy-Secret-Header";
const ASSIST_UUID_WINDOW_MS = 30000;
const ASSIST_STRIKE_BLACKLIST_THRESHOLD = 5;

const assistUuidLastSeen = new Map<string, number>();

type AssistTokenRecord = {
  id: number;
  guild_id: string;
  discord_id: string;
  torn_id: number;
  strike_count: number;
  is_active: boolean;
  blacklisted_at: string | null;
  expires_at: string | null;
};

type AssistPayload = {
  uuid: string;
  action?: string;
  source?: string;
  attacker_name?: string;
  attacker_torn_id?: number;
  target_name?: string;
  target_torn_id?: number;
  result?: string;
  details?: string;
  occurred_at?: string;
};

function isValidUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

function isAssistRateLimited(uuid: string): boolean {
  const now = Date.now();
  const previous = assistUuidLastSeen.get(uuid);

  for (const [key, ts] of assistUuidLastSeen) {
    if (now - ts > ASSIST_UUID_WINDOW_MS) {
      assistUuidLastSeen.delete(key);
    }
  }

  if (previous && now - previous < ASSIST_UUID_WINDOW_MS) {
    return true;
  }

  assistUuidLastSeen.set(uuid, now);
  return false;
}

function buildAssistEmbed(payload: AssistPayload): EmbedBuilder {
  const action = payload.action || "assist_event";
  const source = payload.source || "assist-script";
  const attacker = payload.attacker_name
    ? payload.attacker_torn_id
      ? `${payload.attacker_name} [${payload.attacker_torn_id}]`
      : payload.attacker_name
    : "Unknown";
  const target = payload.target_name
    ? payload.target_torn_id
      ? `${payload.target_name} [${payload.target_torn_id}]`
      : payload.target_name
    : "Unknown";

  const embed = new EmbedBuilder()
    .setColor(0xdc2626)
    .setTitle("Combat Assist Alert")
    .setDescription(payload.details || "A new assist event was received.")
    .addFields(
      { name: "Action", value: action, inline: true },
      { name: "Source", value: source, inline: true },
      { name: "Result", value: payload.result || "Unknown", inline: true },
      { name: "Attacker", value: attacker, inline: false },
      { name: "Target", value: target, inline: false },
    )
    .setTimestamp();

  if (payload.occurred_at) {
    embed.setFooter({ text: `Occurred at ${payload.occurred_at}` });
  }

  return embed;
}

async function incrementAssistStrikeByUuid(
  uuid: string,
  reason: string,
): Promise<void> {
  const { data: token } = await supabase
    .from(TABLE_NAMES.ASSIST_TOKENS)
    .select("id, strike_count, is_active")
    .eq("token_uuid", uuid)
    .maybeSingle();

  if (!token || !token.is_active) {
    return;
  }

  const nextStrike = (token.strike_count || 0) + 1;
  const shouldBlacklist = nextStrike >= ASSIST_STRIKE_BLACKLIST_THRESHOLD;

  await supabase
    .from(TABLE_NAMES.ASSIST_TOKENS)
    .update({
      strike_count: nextStrike,
      is_active: shouldBlacklist ? false : true,
      blacklisted_at: shouldBlacklist ? new Date().toISOString() : null,
      blacklisted_reason: shouldBlacklist ? reason : null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", token.id);
}

/**
 * Initialize the HTTP server with Discord and Supabase clients
 */
export function initHttpServer(client: Client, port: number = 3001) {
  discordClient = client;

  // Health check endpoint
  app.get("/health", (_req: Request, res: Response) => {
    res.json({
      status: "ok",
      bot: discordClient.user?.tag || "not ready",
      timestamp: new Date().toISOString(),
    });
  });

  // Send guild channel message endpoint for webhooks (e.g., TT notifications)
  app.post("/send-guild-message", async (req: Request, res: Response) => {
    try {
      const { guildId, channelId, embed, content } = req.body;

      if (!guildId || !channelId) {
        return res.status(400).json({
          error: "Missing required fields: guildId, channelId",
        });
      }

      if (!embed && !content) {
        return res.status(400).json({
          error: "Must provide either embed or content",
        });
      }

      // Fetch guild
      const guild = await discordClient.guilds.fetch(guildId);
      if (!guild) {
        return res.status(404).json({ error: "Guild not found" });
      }

      // Fetch channel
      const channel = await guild.channels.fetch(channelId);
      if (!channel || !channel.isTextBased()) {
        return res.status(404).json({ error: "Text channel not found" });
      }

      // Send message
      await channel.send({
        content: content || undefined,
        embeds: embed ? [embed] : undefined,
      });

      console.log(
        `[HTTP] Sent message to ${guild.name}#${channel.name} (guild: ${guildId})`,
      );

      return res.json({
        success: true,
        guild: guild.name,
        channel: channel.name,
      });
    } catch (error: unknown) {
      const discordError = error as { code?: number; message?: string };

      if (discordError.code === 50001) {
        // Missing access permission
        console.warn(`[HTTP] Missing access to channel ${req.body.channelId}`);
        return res.status(403).json({
          error: "Bot missing permissions in channel",
          code: "MISSING_PERMS",
        });
      }

      if (discordError.code === 50013) {
        // Missing send messages permission
        console.warn(
          `[HTTP] Cannot send messages to channel ${req.body.channelId}`,
        );
        return res.status(403).json({
          error: "Cannot send messages in channel",
          code: "NO_SEND_PERMS",
        });
      }

      console.error("[HTTP] Error sending guild message:", error);
      return res.status(500).json({
        error: "Failed to send message",
        details: discordError.message || "Unknown error",
      });
    }
  });

  // Send DM endpoint for workers
  app.post("/send-dm", async (req: Request, res: Response) => {
    try {
      const { discordId, embed } = req.body;

      if (!discordId || !embed) {
        return res.status(400).json({
          error: "Missing required fields: discordId, embed",
        });
      }

      // Fetch Discord user
      const user = await discordClient.users.fetch(discordId);
      if (!user) {
        return res.status(404).json({ error: "Discord user not found" });
      }

      // Send DM
      await user.send({ embeds: [embed] });

      console.log(`[HTTP] Sent DM to ${user.tag} (${discordId})`);

      return res.json({
        success: true,
        recipient: user.tag,
      });
    } catch (error: unknown) {
      // Handle common Discord errors
      const discordError = error as { code?: number; message?: string };

      if (discordError.code === 50007) {
        // Cannot send messages to this user (blocked/DMs disabled)
        console.warn(
          `[HTTP] Cannot send DM to user ${req.body.discordId}: DMs disabled or bot blocked`,
        );
        return res.status(403).json({
          error: "Cannot send messages to this user",
          code: "DM_BLOCKED",
        });
      }

      if (discordError.code === 10013) {
        // Unknown user
        console.error(`[HTTP] Unknown Discord user: ${req.body.discordId}`);
        return res.status(404).json({
          error: "Discord user not found",
          code: "UNKNOWN_USER",
        });
      }

      console.error("[HTTP] Error sending DM:", error);
      return res.status(500).json({
        error: "Failed to send message",
        details: discordError.message || "Unknown error",
      });
    }
  });

  // Internal assist ingestion endpoint. Traffic should arrive via Cloudflare worker.
  app.post("/internal/assist-events", async (req: Request, res: Response) => {
    try {
      const expectedProxySecret = process.env.ASSIST_PROXY_SECRET;
      const providedProxySecret = req.header(ASSIST_PROXY_SECRET_HEADER);

      if (!expectedProxySecret) {
        return res.status(500).json({
          error: "Server misconfigured: ASSIST_PROXY_SECRET is not set",
        });
      }

      if (!providedProxySecret || providedProxySecret !== expectedProxySecret) {
        return res.status(401).json({ error: "Unauthorized proxy" });
      }

      const payload = req.body as AssistPayload;
      if (!payload?.uuid || !isValidUuid(payload.uuid)) {
        return res.status(400).json({
          error: "Missing or invalid uuid in payload",
        });
      }

      if (isAssistRateLimited(payload.uuid)) {
        await incrementAssistStrikeByUuid(payload.uuid, "rate_limit_30s");
        return res.status(429).json({
          error: "Rate limited",
          retry_after_seconds: ASSIST_UUID_WINDOW_MS / 1000,
        });
      }

      const { data: rawToken } = await supabase
        .from(TABLE_NAMES.ASSIST_TOKENS)
        .select(
          "id, guild_id, discord_id, torn_id, strike_count, is_active, blacklisted_at, expires_at",
        )
        .eq("token_uuid", payload.uuid)
        .maybeSingle();

      const token = rawToken as AssistTokenRecord | null;

      if (!token) {
        return res.status(401).json({ error: "Invalid assist token" });
      }

      if (!token.is_active || token.blacklisted_at) {
        return res.status(403).json({ error: "Assist token is inactive" });
      }

      if (
        token.expires_at &&
        new Date(token.expires_at).getTime() <= Date.now()
      ) {
        return res.status(403).json({ error: "Assist token expired" });
      }

      const { data: guildConfig } = await supabase
        .from(TABLE_NAMES.GUILD_CONFIG)
        .select("enabled_modules")
        .eq("guild_id", token.guild_id)
        .maybeSingle();

      const enabledModules: string[] = guildConfig?.enabled_modules || [];
      if (!enabledModules.includes("assist")) {
        return res.status(403).json({ error: "Assist module disabled" });
      }

      const { data: assistConfig } = await supabase
        .from(TABLE_NAMES.ASSIST_CONFIG)
        .select("assist_channel_id, ping_role_id, is_active")
        .eq("guild_id", token.guild_id)
        .maybeSingle();

      if (!assistConfig?.is_active || !assistConfig.assist_channel_id) {
        return res.status(412).json({
          error: "Assist channel is not configured",
        });
      }

      const guild = await discordClient.guilds.fetch(token.guild_id);
      const channel = await guild.channels.fetch(
        assistConfig.assist_channel_id,
      );

      if (!channel || !channel.isTextBased()) {
        return res
          .status(404)
          .json({ error: "Configured assist channel not found" });
      }

      const mention = assistConfig.ping_role_id
        ? `<@&${assistConfig.ping_role_id}>`
        : "#combat-assists";
      const embed = buildAssistEmbed(payload);

      await channel.send({
        content: mention,
        embeds: [embed],
      });

      await supabase
        .from(TABLE_NAMES.ASSIST_TOKENS)
        .update({
          last_used_at: new Date().toISOString(),
          last_seen_ip: req.ip,
          last_seen_user_agent: req.get("user-agent") || null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", token.id);

      return res.json({
        success: true,
        guildId: token.guild_id,
        channelId: assistConfig.assist_channel_id,
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Unknown error";
      console.error("[HTTP] Error processing assist event:", error);
      return res
        .status(500)
        .json({ error: "Failed to process assist event", message });
    }
  });

  // Start server
  app.listen(port, () => {
    console.log(`[HTTP] Server listening on port ${port}`);
  });

  return app;
}
