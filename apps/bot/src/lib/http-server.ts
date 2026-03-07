import express, { type Request, type Response } from "express";
import {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type Client,
  type Message,
} from "discord.js";
import { TABLE_NAMES, getNextApiKey } from "@sentinel/shared";
import { db } from "./db-client.js";
import { buildAssistUserscript } from "./assist-userscript.js";
import { verifyLinkSignature } from "./assist-link-signing.js";
import {
  logProxyAuthFailure,
  logPayloadTooLarge,
  logRateLimitHit,
} from "./assist-monitoring.js";
import { fetchTornProfileData } from "./torn-api.js";
import { getGuildApiKeys } from "./guild-api-keys.js";

const app = express();
app.use(express.json());

let discordClient: Client;

const ASSIST_PROXY_SECRET_HEADER = "Proxy-Secret-Header";
const ASSIST_UUID_WINDOW_MS = 30000;
const ASSIST_STRIKE_BLACKLIST_THRESHOLD = 5;
const ASSIST_ALLOWED_PROXY_METHODS = new Set(["POST", "PATCH", "DELETE"]);
const parsedAssistMaxPayloadBytes = Number.parseInt(
  process.env.ASSIST_MAX_PAYLOAD_BYTES || "16384",
  10,
);
const ASSIST_MAX_PAYLOAD_BYTES =
  Number.isFinite(parsedAssistMaxPayloadBytes) &&
  parsedAssistMaxPayloadBytes > 0
    ? parsedAssistMaxPayloadBytes
    : 16384;

const assistUuidLastSeen = new Map<string, number>();
const assistMessageTracking = new Map<
  string,
  { message: Message; createdAt: number; attackerCount: number | null }
>();

const ASSIST_EMBED_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

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

function hasValidProxySecret(req: Request): boolean {
  const expectedProxySecret = process.env.ASSIST_PROXY_SECRET;
  const providedProxySecret = req.header(ASSIST_PROXY_SECRET_HEADER);

  if (!expectedProxySecret) {
    return false;
  }

  const isValid = Boolean(
    providedProxySecret && providedProxySecret === expectedProxySecret,
  );

  if (!isValid) {
    logProxyAuthFailure(
      req.path,
      req.header("X-Assist-Client-IP") || req.ip || null,
      req.header("X-Assist-Client-UA") || req.get("user-agent") || null,
    );
  }

  return isValid;
}

function getAssistPayloadSizeBytes(req: Request): number {
  const fromHeader = Number.parseInt(req.header("content-length") || "0", 10);
  if (Number.isFinite(fromHeader) && fromHeader > 0) {
    return fromHeader;
  }

  return Buffer.byteLength(JSON.stringify(req.body || {}), "utf8");
}

function buildInitialAssistEmbed(
  targetTornId: number | undefined,
): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setColor(0xdc2626)
    .setTitle("Assist Alert")
    .addFields(
      { name: "Source", value: "Userscript", inline: true },
      {
        name: "Target",
        value: targetTornId ? `Loading...` : "Unknown",
        inline: true,
      },
      { name: "Attackers", value: "Monitoring...", inline: true },
    )
    .setTimestamp();

  return embed;
}

async function enrichAssistEmbed(
  embed: EmbedBuilder,
  targetTornId: number,
  apiKey: string,
): Promise<void> {
  try {
    const profileData = await fetchTornProfileData(targetTornId, apiKey);

    if (profileData?.profile) {
      const targetDisplay = `[${profileData.profile.name} [${targetTornId}]](https://www.torn.com/profiles.php?XID=${targetTornId})`;
      embed.spliceFields(1, 1, {
        name: "Target",
        value: targetDisplay,
        inline: true,
      });

      if (profileData.faction?.name) {
        embed.addFields({
          name: "Faction",
          value: profileData.faction.name,
          inline: true,
        });
      }
    } else {
      embed.spliceFields(1, 1, {
        name: "Target",
        value: `[${targetTornId}]`,
        inline: true,
      });
    }
  } catch (error) {
    console.error(
      `[ASSIST] Failed to enrich embed for ${targetTornId}:`,
      error,
    );
    embed.spliceFields(1, 1, {
      name: "Target",
      value: `[${targetTornId}]`,
      inline: true,
    });
  }
}

function buildAssistButton(
  targetTornId: number | undefined,
): ActionRowBuilder<ButtonBuilder> | null {
  if (!targetTornId) {
    return null;
  }

  const assistButton = new ButtonBuilder()
    .setLabel("Assist")
    .setStyle(ButtonStyle.Link)
    .setURL(
      `https://www.torn.com/loader.php?sid=attack&user2ID=${targetTornId}`,
    );

  return new ActionRowBuilder<ButtonBuilder>().addComponents(assistButton);
}

async function incrementAssistStrikeByUuid(
  uuid: string,
  reason: string,
): Promise<void> {
  const { data: token } = await db
    .from(TABLE_NAMES.ASSIST_TOKENS)
    .select("id, strike_count, is_active")
    .eq("token_uuid", uuid)
    .maybeSingle();

  if (!token || !token.is_active) {
    return;
  }

  const nextStrike = (token.strike_count || 0) + 1;
  const shouldBlacklist = nextStrike >= ASSIST_STRIKE_BLACKLIST_THRESHOLD;

  await db
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
 * Initialize the HTTP server with Discord and database clients
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

  // Internal userscript installation endpoint. Traffic should arrive via Cloudflare worker.
  app.get(
    "/internal/assist-install/:fileName",
    async (req: Request, res: Response) => {
      try {
        if (!process.env.ASSIST_PROXY_SECRET) {
          return res.status(500).json({
            error: "Server misconfigured: ASSIST_PROXY_SECRET is not set",
          });
        }

        if (!hasValidProxySecret(req)) {
          return res.status(401).json({ error: "Unauthorized proxy" });
        }

        const fileParam = req.params.fileName;
        const fileName = Array.isArray(fileParam)
          ? fileParam[0] || ""
          : fileParam || "";
        if (!fileName.endsWith(".user.js")) {
          return res.status(400).json({ error: "Invalid script path" });
        }

        const uuid = fileName.replace(/\.user\.js$/i, "");
        if (!isValidUuid(uuid)) {
          return res.status(400).json({ error: "Invalid UUID in script path" });
        }

        // Verify signed link
        const expParam = req.query.exp;
        const sigParam = req.query.sig;

        if (!expParam || !sigParam) {
          return res.status(400).json({
            error: "Missing signature parameters",
            hint: "Install links must include exp and sig query params",
          });
        }

        const expiresAt = Number.parseInt(String(expParam), 10);
        const signature = String(sigParam);

        if (!Number.isFinite(expiresAt)) {
          return res.status(400).json({ error: "Invalid expiry timestamp" });
        }

        const verification = verifyLinkSignature(uuid, expiresAt, signature);
        if (!verification.valid) {
          return res.status(403).json({
            error: verification.reason || "Invalid install link",
          });
        }

        const { data: rawToken } = await db
          .from(TABLE_NAMES.ASSIST_TOKENS)
          .select(
            "id, guild_id, discord_id, torn_id, strike_count, is_active, blacklisted_at, expires_at",
          )
          .eq("token_uuid", uuid)
          .maybeSingle();

        const token = rawToken as AssistTokenRecord | null;

        if (!token) {
          return res.status(404).json({ error: "Assist token not found" });
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

        const proxyOrigin = req.header("X-Assist-Proxy-Origin");
        const fallbackOrigin = `${req.protocol}://${req.get("host")}`;

        let apiBaseUrl = fallbackOrigin;
        if (proxyOrigin) {
          try {
            apiBaseUrl = new URL(proxyOrigin).origin;
          } catch {
            apiBaseUrl = fallbackOrigin;
          }
        }

        const script = buildAssistUserscript({
          uuid,
          apiBaseUrl,
        });

        await db
          .from(TABLE_NAMES.ASSIST_TOKENS)
          .update({
            last_used_at: new Date().toISOString(),
            last_seen_ip: req.header("X-Assist-Client-IP") || req.ip || null,
            last_seen_user_agent:
              req.header("X-Assist-Client-UA") || req.get("user-agent") || null,
            updated_at: new Date().toISOString(),
          })
          .eq("id", token.id);

        res.setHeader("Content-Type", "application/javascript; charset=utf-8");
        res.setHeader("Cache-Control", "no-store");
        res.setHeader("X-Content-Type-Options", "nosniff");

        return res.status(200).send(script);
      } catch (error: unknown) {
        const message =
          error instanceof Error ? error.message : "Unknown error";
        console.error("[HTTP] Error generating assist userscript:", error);
        return res
          .status(500)
          .json({ error: "Failed to generate assist script", message });
      }
    },
  );

  // Internal assist ingestion endpoint. Traffic should arrive via Cloudflare worker.
  app.all("/internal/assist-events", async (req: Request, res: Response) => {
    try {
      if (!process.env.ASSIST_PROXY_SECRET) {
        return res.status(500).json({
          error: "Server misconfigured: ASSIST_PROXY_SECRET is not set",
        });
      }

      if (!ASSIST_ALLOWED_PROXY_METHODS.has(req.method)) {
        return res.status(405).json({
          error: "Method not allowed",
          allowed_methods: Array.from(ASSIST_ALLOWED_PROXY_METHODS),
        });
      }

      if (!hasValidProxySecret(req)) {
        return res.status(401).json({ error: "Unauthorized proxy" });
      }

      const payloadSize = getAssistPayloadSizeBytes(req);
      if (payloadSize > ASSIST_MAX_PAYLOAD_BYTES) {
        logPayloadTooLarge(
          req.path,
          req.header("X-Assist-Client-IP") || req.ip || null,
          req.header("X-Assist-Client-UA") || req.get("user-agent") || null,
          payloadSize,
          ASSIST_MAX_PAYLOAD_BYTES,
        );
        return res.status(413).json({
          error: "Payload too large",
          max_bytes: ASSIST_MAX_PAYLOAD_BYTES,
        });
      }

      const payload = req.body as AssistPayload;
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
        return res
          .status(400)
          .json({ error: "JSON payload must be an object" });
      }

      if (!payload?.uuid || !isValidUuid(payload.uuid)) {
        return res.status(400).json({
          error: "Missing or invalid uuid in payload",
        });
      }

      if (isAssistRateLimited(payload.uuid)) {
        await incrementAssistStrikeByUuid(payload.uuid, "rate_limit_30s");
        logRateLimitHit(
          req.path,
          req.header("X-Assist-Client-IP") || req.ip || null,
          req.header("X-Assist-Client-UA") || req.get("user-agent") || null,
          payload.uuid,
        );
        return res.status(429).json({
          error: "Rate limited",
          retry_after_seconds: ASSIST_UUID_WINDOW_MS / 1000,
        });
      }

      const { data: rawToken } = await db
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

      const { data: guildConfig } = await db
        .from(TABLE_NAMES.GUILD_CONFIG)
        .select("enabled_modules")
        .eq("guild_id", token.guild_id)
        .maybeSingle();

      const enabledModules: string[] = guildConfig?.enabled_modules || [];
      if (!enabledModules.includes("assist")) {
        return res.status(403).json({ error: "Assist module disabled" });
      }

      const { data: assistConfig } = await db
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

      // Handle PATCH method for attacker count updates
      if (req.method === "PATCH") {
        const tracked = assistMessageTracking.get(payload.uuid);
        if (!tracked) {
          return res
            .status(404)
            .json({ error: "No active assist message for this UUID" });
        }

        const now = Date.now();
        if (now - tracked.createdAt > ASSIST_EMBED_TIMEOUT_MS) {
          assistMessageTracking.delete(payload.uuid);
          return res.status(410).json({ error: "Assist message expired" });
        }

        // Extract attacker count from details
        const details = payload.details || "";
        const match = details.match(/(\d+)\s*->\s*(\d+)/);
        if (match) {
          const newCount = Number.parseInt(match[2], 10);
          if (Number.isFinite(newCount) && newCount !== tracked.attackerCount) {
            const updatedEmbed = EmbedBuilder.from(tracked.message.embeds[0]);
            updatedEmbed.spliceFields(2, 1, {
              name: "Attackers",
              value: String(newCount),
              inline: true,
            });

            await tracked.message.edit({ embeds: [updatedEmbed] });
            tracked.attackerCount = newCount;

            return res.json({ success: true, updated: "attacker_count" });
          }
        }

        return res.json({ success: true, updated: "none" });
      }

      // Handle DELETE method for session end
      if (req.method === "DELETE") {
        assistMessageTracking.delete(payload.uuid);
        return res.json({ success: true, deleted: true });
      }

      // Handle POST method for new assist alerts
      const mention = assistConfig.ping_role_id
        ? `<@&${assistConfig.ping_role_id}>`
        : "";
      const embed = buildInitialAssistEmbed(payload.target_torn_id);
      const button = buildAssistButton(payload.target_torn_id);

      const components = button ? [button] : [];
      const sentMessage = await channel.send({
        content: mention || undefined,
        embeds: [embed],
        components,
      });

      // Track message for updates and timeout
      assistMessageTracking.set(payload.uuid, {
        message: sentMessage,
        createdAt: Date.now(),
        attackerCount: null,
      });

      // Set timeout to expire the embed after 5 minutes
      setTimeout(async () => {
        const tracked = assistMessageTracking.get(payload.uuid);
        if (tracked) {
          try {
            const expiredEmbed = EmbedBuilder.from(tracked.message.embeds[0])
              .setColor(0x6b7280)
              .setFooter({ text: "This assist alert has expired" });
            await tracked.message.edit({
              embeds: [expiredEmbed],
              components: [],
            });
          } catch (error) {
            console.error(
              `[ASSIST] Failed to expire embed for ${payload.uuid}:`,
              error,
            );
          }
          assistMessageTracking.delete(payload.uuid);
        }
      }, ASSIST_EMBED_TIMEOUT_MS);

      // Enrich embed asynchronously if target_torn_id is present
      const targetTornId = payload.target_torn_id;
      if (targetTornId) {
        (async () => {
          try {
            const apiKeys = await getGuildApiKeys(token.guild_id);
            if (apiKeys.length === 0) {
              console.warn(
                `[ASSIST] No API keys configured for guild ${token.guild_id}`,
              );
              return;
            }

            const apiKey = getNextApiKey(token.guild_id, apiKeys);
            const embed = EmbedBuilder.from(sentMessage.embeds[0]);
            await enrichAssistEmbed(embed, targetTornId, apiKey);
            await sentMessage.edit({ embeds: [embed] });
          } catch (error) {
            console.error(
              `[ASSIST] Failed to enrich embed for ${payload.uuid}:`,
              error,
            );
          }
        })();
      }

      await db
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
