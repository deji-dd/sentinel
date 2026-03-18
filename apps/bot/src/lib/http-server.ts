import { randomUUID, randomBytes } from "node:crypto";
import express, { type Request, type Response } from "express";
import cors from "cors";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
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
import { getKysely } from "@sentinel/shared/db/sqlite.js";
import { buildAssistUserscript } from "./assist-userscript.js";
import {
  generateAssistEventAuthToken,
  verifyLinkSignature,
} from "./assist-link-signing.js";
import { logPayloadTooLarge, logRateLimitHit } from "./assist-monitoring.js";
import { DatabaseIPRateLimiter } from "./assist-ip-rate-limiter.js";
import {
  fetchTornProfileData,
  fetchPointPrice,
  fetchMarketPrices,
} from "./torn-api.js";
import { getGuildApiKeys, storeGuildApiKey } from "./guild-api-keys.js";
import { parseRewardString } from "@sentinel/shared";
import { getAllowedOrigins, getUiUrl } from "./bot-config.js";
import { MagicLinkService } from "./services/magic-link-service.js";
import { validateTornApiKey } from "../services/torn-client.js";
import { logGuildSuccess, logGuildAction } from "./guild-logger.js";

const app = express();
app.set("trust proxy", 1);

// Health check - BEFORE any middleware to diagnose hangs
app.get("/health", (_req: Request, res: Response) => {
  res.json({ ok: true, ts: Date.now() });
});

app.use(
  helmet({
    contentSecurityPolicy: false,
  }),
);
app.use(express.json());
app.use(
  cors({
    origin: (origin, callback) => {
      const allowed = getAllowedOrigins();
      if (!origin || allowed.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error("Not allowed by CORS"));
      }
    },
    credentials: true,
  }),
);

// Rate limiting for Map Painter API
const mapRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 1000,
  message: {
    error:
      "Too many requests from this IP for Map Painter, please try again later.",
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Rate limiting for Assist API (general flood protection)
const assistRateLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 300,
  message: {
    error:
      "Too many requests from this IP for Assist API, please try again later.",
  },
  standardHeaders: true,
  legacyHeaders: false,
});

let discordClient: Client;
let ipRateLimiter: DatabaseIPRateLimiter;

// Proxy header removed
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
const ASSIST_SLOW_DELIVERY_WARN_MS = 1000; // Flag transport lag at 1s+

const assistMessageTracking = new Map<
  string,
  {
    message: Message;
    createdAt: number;
    lastActivityAt: number;
    attackerCount: number | null;
  }
>();

const ASSIST_EMBED_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

type _AssistTokenRecord = {
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
  auth_token?: string;
  client_sent_at?: string;
  action?: string;
  source?: string;
  attacker_name?: string;
  attacker_torn_id?: number;
  target_name?: string;
  target_torn_id?: number;
  result?: string;
  details?: string;
  occurred_at?: string;
  fight_status?: string;
  attacker_count?: number;
  attacker_count_state?: string;
  enemy_health_current?: number;
  enemy_health_max?: number;
  enemy_health_percent?: number;
};

function getClientToServerLagMs(value: string | undefined): number | null {
  if (!value) {
    return null;
  }

  const parsed = new Date(value).getTime();
  if (!Number.isFinite(parsed)) {
    return null;
  }

  const lagMs = Date.now() - parsed;
  return lagMs >= 0 ? lagMs : null;
}

function normalizeFightStatus(value: string | undefined): string | null {
  if (!value) {
    return null;
  }

  const normalized = value.trim().toLowerCase();

  if (normalized === "target is down") {
    return "Target is down";
  }

  if (normalized === "requester is down") {
    return "Requester is down";
  }

  if (normalized === "requester stalemated") {
    return "Requester stalemated";
  }

  if (normalized === "requester timed out") {
    return "Requester timed out";
  }

  if (normalized === "fight ended") {
    return "Fight ended";
  }

  if (normalized === "not started" || normalized === "not_started") {
    return "Requester not started fight";
  }

  if (normalized === "ongoing" || normalized === "started") {
    return "Ongoing";
  }

  if (normalized === "ended" || normalized === "finished") {
    return "Fight ended";
  }

  return null;
}

function normalizeFightOutcomeStatus(value: string | undefined): string | null {
  if (!value) {
    return null;
  }

  const compact = value.replace(/\s+/g, " ").trim();
  if (!compact) {
    return null;
  }

  const lower = compact.toLowerCase();

  if (
    lower.includes("target is down") ||
    lower.includes("you defeated") ||
    lower.includes("you mugged") ||
    lower.includes("you hospitalized") ||
    lower.includes("you arrested")
  ) {
    return "Target is down";
  }

  if (
    lower.includes("requester stalemated") ||
    lower.includes("you stalemated")
  ) {
    return "Requester stalemated";
  }

  if (lower.includes("requester is down") || lower.includes("you lost")) {
    return "Requester is down";
  }

  if (lower.includes("requester timed out") || lower.includes("timed out")) {
    return "Requester timed out";
  }

  if (
    lower.includes("took down your opponent") ||
    lower.includes("was defeated by")
  ) {
    return "Target is down";
  }

  if (
    lower.includes("was sent to hospital") ||
    lower.includes("was surrounded by police")
  ) {
    return "Target is down";
  }

  return null;
}

function resolveStatusFieldValue(payload: AssistPayload): string | null {
  const outcomeStatus = normalizeFightOutcomeStatus(payload.fight_status);
  if (outcomeStatus) {
    return outcomeStatus;
  }

  return normalizeFightStatus(payload.fight_status);
}

function isValidUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

function getClientIp(req: Request): string {
  // Cloudflared passes the original IP in CF-Connecting-IP
  let ip =
    req.header("CF-Connecting-IP") || req.header("X-Forwarded-For") || req.ip;
  if (ip && ip.includes(",")) {
    ip = ip.split(",")[0].trim();
  }
  return ip || "unknown";
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
  requesterDiscordId: string,
  fightStatus: string,
  initialAttackerValue: string,
  initialEnemyHpValue: string,
): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setColor(0xdc2626)
    .setTitle("Assist Alert")
    .addFields(
      { name: "Source", value: "Userscript", inline: true },
      { name: "Requester", value: `<@${requesterDiscordId}>`, inline: true },
      { name: "Status", value: fightStatus, inline: true },
      {
        name: "Target",
        value: targetTornId ? `Loading...` : "Unknown",
        inline: true,
      },
      { name: "Attackers", value: initialAttackerValue, inline: true },
      { name: "Enemy HP", value: initialEnemyHpValue, inline: true },
    )
    .setTimestamp();

  return embed;
}

function upsertEmbedField(
  embed: EmbedBuilder,
  name: string,
  value: string,
  inline: boolean,
): void {
  const fields = embed.data.fields || [];
  const index = fields.findIndex((field) => field.name === name);

  if (index >= 0) {
    embed.spliceFields(index, 1, { name, value, inline });
    return;
  }

  embed.addFields({ name, value, inline });
}

function getActiveTrackedAssist(uuid: string): {
  message: Message;
  createdAt: number;
  lastActivityAt: number;
  attackerCount: number | null;
} | null {
  const tracked = assistMessageTracking.get(uuid);
  if (!tracked) {
    return null;
  }

  if (Date.now() - tracked.lastActivityAt > ASSIST_EMBED_TIMEOUT_MS) {
    assistMessageTracking.delete(uuid);
    return null;
  }

  return tracked;
}

function scheduleAssistExpiry(uuid: string): void {
  const tracked = assistMessageTracking.get(uuid);
  if (!tracked) {
    return;
  }

  const idleMs = Date.now() - tracked.lastActivityAt;
  const remainingMs = Math.max(1, ASSIST_EMBED_TIMEOUT_MS - idleMs);

  setTimeout(async () => {
    const current = assistMessageTracking.get(uuid);
    if (!current) {
      return;
    }

    const currentIdleMs = Date.now() - current.lastActivityAt;
    if (currentIdleMs < ASSIST_EMBED_TIMEOUT_MS) {
      scheduleAssistExpiry(uuid);
      return;
    }

    try {
      const expiredEmbed = EmbedBuilder.from(current.message.embeds[0])
        .setColor(0x6b7280)
        .setFooter({ text: "This assist alert has expired" });
      upsertEmbedField(expiredEmbed, "Status", "Ended (Expired)", true);
      await current.message.edit({
        embeds: [expiredEmbed],
        components: [],
      });

      // Delete the message after a short delay
      setTimeout(async () => {
        try {
          await current.message.delete();
          console.log(`[ASSIST] Deleted expired assist message for ${uuid}`);
        } catch (error) {
          console.error(
            `[ASSIST] Failed to delete expired assist message for ${uuid}:`,
            error,
          );
        }
      }, 5000); // 5 second delay
    } catch (error) {
      console.error(`[ASSIST] Failed to expire embed for ${uuid}:`, error);
    }

    assistMessageTracking.delete(uuid);
  }, remainingMs);
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
      upsertEmbedField(embed, "Target", targetDisplay, true);

      if (profileData.faction?.name) {
        upsertEmbedField(embed, "Faction", profileData.faction.name, true);
      }
    } else {
      upsertEmbedField(embed, "Target", `[${targetTornId}]`, true);
    }
  } catch (error) {
    console.error(
      `[ASSIST] Failed to enrich embed for ${targetTornId}:`,
      error,
    );
    upsertEmbedField(embed, "Target", `[${targetTornId}]`, true);
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
  const token = await db
    .selectFrom(TABLE_NAMES.ASSIST_TOKENS)
    .select(["id", "strike_count", "is_active"])
    .where("token_uuid", "=", uuid)
    .executeTakeFirst();

  if (!token || !token.is_active) {
    return;
  }

  const nextStrike = (token.strike_count || 0) + 1;
  const shouldBlacklist = nextStrike >= ASSIST_STRIKE_BLACKLIST_THRESHOLD;

  await db
    .updateTable(TABLE_NAMES.ASSIST_TOKENS)
    .set({
      strike_count: nextStrike,
      is_active: shouldBlacklist ? 0 : 1,
      blacklisted_at: shouldBlacklist ? new Date().toISOString() : null,
      blacklisted_reason: shouldBlacklist ? reason : null,
      updated_at: new Date().toISOString(),
    })
    .where("id", "=", token.id)
    .execute();
}

/**
 * Initialize the HTTP server with Discord and database clients
 */
export function initHttpServer(client: Client, port: number = 3001) {
  discordClient = client;
  ipRateLimiter = new DatabaseIPRateLimiter(
    db,
    TABLE_NAMES.ASSIST_IP_RATE_LIMITS,
    TABLE_NAMES.ASSIST_SCRIPT_GENERATION_LIMITS,
  );

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

  // Public userscript installation endpoint. Traffic expected via Cloudflared.
  app.get(
    "/install/:fileName",
    assistRateLimiter,
    async (req: Request, res: Response) => {
      try {
        const clientIp = getClientIp(req);
        const clientUA = req.get("user-agent") || null;

        // Check if this IP is blocked
        if (await ipRateLimiter.isIPBlocked(clientIp)) {
          return res.status(429).json({
            error: "Too many requests from this IP",
            retry_after: 3600,
          });
        }

        const fileParam = req.params.fileName;
        const fileName = Array.isArray(fileParam)
          ? fileParam[0] || ""
          : fileParam || "";
        if (!fileName.endsWith(".user.js")) {
          await ipRateLimiter.recordFailure(
            clientIp,
            "invalid_script_extension",
            undefined,
            req.path,
            clientUA,
          );
          return res.status(400).json({ error: "Invalid script path" });
        }

        const uuid = fileName.replace(/\.user\.js$/i, "");
        if (!isValidUuid(uuid)) {
          await ipRateLimiter.recordFailure(
            clientIp,
            "invalid_uuid",
            uuid,
            req.path,
            clientUA,
          );
          return res.status(400).json({ error: "Invalid UUID in script path" });
        }

        // Verify signed link
        const expParam = req.query.exp;
        const sigParam = req.query.sig;

        if (!expParam || !sigParam) {
          await ipRateLimiter.recordFailure(
            clientIp,
            "missing_signature_params",
            uuid,
            req.path,
            clientUA,
          );
          return res.status(400).json({
            error: "Missing signature parameters",
            hint: "Install links must include exp and sig query params",
          });
        }

        const expiresAt = Number.parseInt(String(expParam), 10);
        const signature = String(sigParam);

        if (!Number.isFinite(expiresAt)) {
          await ipRateLimiter.recordFailure(
            clientIp,
            "invalid_expiry_timestamp",
            uuid,
            req.path,
            clientUA,
          );
          return res.status(400).json({ error: "Invalid expiry timestamp" });
        }

        const verification = verifyLinkSignature(uuid, expiresAt, signature);
        if (!verification.valid) {
          await ipRateLimiter.recordFailure(
            clientIp,
            "invalid_signature",
            uuid,
            req.path,
            clientUA,
          );
          logRateLimitHit(req.path, clientIp, clientUA, uuid);
          return res.status(403).json({
            error: verification.reason || "Invalid install link",
          });
        }

        const token = await db
          .selectFrom(TABLE_NAMES.ASSIST_TOKENS)
          .select([
            "id",
            "guild_id",
            "discord_id",
            "torn_id",
            "strike_count",
            "is_active",
            "blacklisted_at",
            "expires_at",
          ])
          .where("token_uuid", "=", uuid)
          .executeTakeFirst();

        if (!token) {
          await ipRateLimiter.recordFailure(
            clientIp,
            "token_not_found",
            uuid,
            req.path,
            clientUA,
          );
          return res.status(404).json({ error: "Assist token not found" });
        }

        if (!token.is_active || token.blacklisted_at) {
          await ipRateLimiter.recordFailure(
            clientIp,
            "token_inactive_or_blacklisted",
            uuid,
            req.path,
            clientUA,
          );
          return res.status(403).json({ error: "Assist token is inactive" });
        }

        if (
          token.expires_at &&
          new Date(token.expires_at).getTime() <= Date.now()
        ) {
          await ipRateLimiter.recordFailure(
            clientIp,
            "token_expired",
            uuid,
            req.path,
            clientUA,
          );
          return res.status(403).json({ error: "Assist token expired" });
        }

        // Check if UUID is rate limited (now we have torn_id for bypass check)
        if (await ipRateLimiter.isUUIDRateLimited(uuid, token.torn_id)) {
          return res.status(429).json({
            error: "Script generation rate limit exceeded for this UUID",
            retry_after: 600,
          });
        }
        const fallbackOrigin = `${req.protocol}://${req.get("host")}`;

        const configuredProd = process.env.BOT_ORIGIN;
        const configuredLocal = process.env.BOT_ORIGIN_LOCAL;
        const rawBase =
          process.env.NODE_ENV === "development"
            ? configuredLocal || configuredProd || `http://127.0.0.1:${port}`
            : configuredProd;

        let apiBaseUrl = fallbackOrigin;
        if (rawBase) {
          try {
            apiBaseUrl = new URL(rawBase).origin;
          } catch {
            apiBaseUrl = fallbackOrigin;
          }
        }

        const script = buildAssistUserscript({
          uuid,
          apiBaseUrl,
          eventAuthToken: generateAssistEventAuthToken(uuid),
        });

        await db
          .updateTable(TABLE_NAMES.ASSIST_TOKENS)
          .set({
            // Install/download should not start the active-assist lock window.
            last_seen_ip: clientIp,
            last_seen_user_agent: clientUA,
            updated_at: new Date().toISOString(),
          })
          .where("id", "=", token.id)
          .execute();

        // Record successful generation for rate limiting
        await ipRateLimiter.recordSuccessfulGeneration(
          uuid,
          clientIp,
          token.torn_id,
        );

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

  // Public assist ingestion endpoint. Traffic expected via Cloudflared.
  app.all(
    "/api/assist-events",
    assistRateLimiter,
    async (req: Request, res: Response) => {
      try {
        if (!ASSIST_ALLOWED_PROXY_METHODS.has(req.method)) {
          return res.status(405).json({
            error: "Method not allowed",
            allowed_methods: Array.from(ASSIST_ALLOWED_PROXY_METHODS),
          });
        }

        const clientIp = getClientIp(req);
        const clientUA = req.get("user-agent") || null;

        const payloadSize = getAssistPayloadSizeBytes(req);
        if (payloadSize > ASSIST_MAX_PAYLOAD_BYTES) {
          logPayloadTooLarge(
            req.path,
            clientIp,
            clientUA,
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

        const clientToServerLagMs = getClientToServerLagMs(
          payload.client_sent_at,
        );
        if (
          clientToServerLagMs !== null &&
          clientToServerLagMs >= ASSIST_SLOW_DELIVERY_WARN_MS
        ) {
          console.warn(
            `[ASSIST] Slow client->server delivery for ${payload.uuid}: ${clientToServerLagMs}ms`,
          );
        }

        const token = await db
          .selectFrom(TABLE_NAMES.ASSIST_TOKENS)
          .select([
            "id",
            "guild_id",
            "discord_id",
            "torn_id",
            "strike_count",
            "is_active",
            "blacklisted_at",
            "expires_at",
            "last_used_at",
          ])
          .where("token_uuid", "=", payload.uuid)
          .executeTakeFirst();

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

        const guildConfig = await db
          .selectFrom(TABLE_NAMES.GUILD_CONFIG)
          .select(["enabled_modules"])
          .where("guild_id", "=", token.guild_id)
          .executeTakeFirst();

        const enabledModules: string[] = guildConfig?.enabled_modules
          ? typeof guildConfig.enabled_modules === "string"
            ? JSON.parse(guildConfig.enabled_modules)
            : guildConfig.enabled_modules
          : [];
        if (!enabledModules.includes("assist")) {
          return res.status(403).json({ error: "Assist module disabled" });
        }

        const assistConfig = await db
          .selectFrom(TABLE_NAMES.ASSIST_CONFIG)
          .select(["assist_channel_id", "ping_role_id", "is_active"])
          .where("guild_id", "=", token.guild_id)
          .executeTakeFirst();

        if (!assistConfig?.is_active || !assistConfig.assist_channel_id) {
          return res.status(412).json({
            error:
              "Assist is not set up for this Discord server yet. Ask a server admin to configure Assist in Discord and try again.",
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
          const tracked = getActiveTrackedAssist(payload.uuid);
          if (!tracked) {
            await incrementAssistStrikeByUuid(
              payload.uuid,
              "invalid_patch_without_active_assist",
            );
            return res.status(409).json({
              error:
                "No active assist request exists for this token. Repeated invalid lifecycle updates will deactivate this token.",
            });
          }

          tracked.lastActivityAt = Date.now();

          // Support both explicit attacker payload fields and legacy details parsing.
          const details = payload.details || "";
          const match = details.match(/(\d+)\s*->\s*(\d+)/);
          const updatedEmbed = EmbedBuilder.from(tracked.message.embeds[0]);
          let hasChanges = false;

          const normalizedStatus = resolveStatusFieldValue(payload);
          if (normalizedStatus) {
            const statusField = updatedEmbed.data.fields?.find(
              (field) => field.name === "Status",
            );
            if (statusField?.value !== normalizedStatus) {
              upsertEmbedField(updatedEmbed, "Status", normalizedStatus, true);
              hasChanges = true;
            }
          }

          const explicitCount = Number.isFinite(payload.attacker_count)
            ? Number(payload.attacker_count)
            : null;
          const parsedCountFromDetails = match
            ? Number.parseInt(match[2], 10)
            : null;
          const newCount = Number.isFinite(explicitCount)
            ? explicitCount
            : parsedCountFromDetails;

          if (Number.isFinite(newCount)) {
            if (
              Number.isFinite(newCount) &&
              newCount !== tracked.attackerCount
            ) {
              upsertEmbedField(
                updatedEmbed,
                "Attackers",
                String(newCount),
                true,
              );
              tracked.attackerCount = newCount;
              hasChanges = true;
            }
          }

          if (
            payload.action === "attacker_count_unavailable" ||
            payload.attacker_count_state === "mobile_unavailable"
          ) {
            const attackersField = updatedEmbed.data.fields?.find(
              (field) => field.name === "Attackers",
            );
            const unavailableLabel =
              payload.attacker_count_state === "mobile_unavailable"
                ? "Unavailable (mobile)"
                : "Unavailable";
            if (attackersField?.value !== unavailableLabel) {
              upsertEmbedField(
                updatedEmbed,
                "Attackers",
                unavailableLabel,
                true,
              );
              tracked.attackerCount = null;
              hasChanges = true;
            }
          }

          const healthCurrent = payload.enemy_health_current;
          const healthMax = payload.enemy_health_max;
          const healthPercent = payload.enemy_health_percent;
          if (
            Number.isFinite(healthCurrent) &&
            Number.isFinite(healthMax) &&
            healthMax &&
            healthMax > 0
          ) {
            const roundedPercent = Number.isFinite(healthPercent)
              ? Math.max(0, Math.min(100, Math.round(healthPercent)))
              : Math.round((healthCurrent / healthMax) * 100);

            const enemyHpValue = `${Math.round(healthCurrent)} / ${Math.round(healthMax)} (${roundedPercent}%)`;
            const hpField = updatedEmbed.data.fields?.find(
              (field) => field.name === "Enemy HP",
            );
            if (hpField?.value !== enemyHpValue) {
              upsertEmbedField(updatedEmbed, "Enemy HP", enemyHpValue, true);
              hasChanges = true;
            }
          } else if (payload.action === "enemy_health_updated") {
            const hpField = updatedEmbed.data.fields?.find(
              (field) => field.name === "Enemy HP",
            );
            if (hpField?.value !== "Unavailable") {
              upsertEmbedField(updatedEmbed, "Enemy HP", "Unavailable", true);
              hasChanges = true;
            }
          }

          if (hasChanges) {
            await tracked.message.edit({ embeds: [updatedEmbed] });
          }

          await db
            .updateTable(TABLE_NAMES.ASSIST_TOKENS)
            .set({
              last_used_at: new Date().toISOString(),
              last_seen_ip: clientIp,
              last_seen_user_agent: clientUA,
              updated_at: new Date().toISOString(),
            })
            .where("id", "=", token.id)
            .execute();

          if (hasChanges) {
            return res.json({ success: true, updated: "message" });
          }

          return res.json({ success: true, updated: "none" });
        }

        // Handle DELETE method for session end
        if (req.method === "DELETE") {
          const tracked = getActiveTrackedAssist(payload.uuid);
          if (!tracked) {
            await incrementAssistStrikeByUuid(
              payload.uuid,
              "invalid_delete_without_active_assist",
            );
            return res.status(409).json({
              error:
                "No active assist request exists for this token. Repeated invalid lifecycle updates will deactivate this token.",
            });
          }

          try {
            const endedEmbed = EmbedBuilder.from(tracked.message.embeds[0])
              .setColor(0x6b7280)
              .setFooter({ text: "This assist alert has ended" });
            const endedStatus =
              resolveStatusFieldValue(payload) || "Fight ended";
            upsertEmbedField(endedEmbed, "Status", endedStatus, true);
            await tracked.message.edit({
              embeds: [endedEmbed],
              components: [],
            });

            // Delete the message after a short delay
            setTimeout(async () => {
              try {
                await tracked.message.delete();
                console.log(
                  `[ASSIST] Deleted ended assist message for ${payload.uuid}`,
                );
              } catch (error) {
                console.error(
                  `[ASSIST] Failed to delete ended assist message for ${payload.uuid}:`,
                  error,
                );
              }
            }, 5000); // 5 second delay
          } catch (error) {
            console.error(
              `[ASSIST] Failed to mark assist as ended for ${payload.uuid}:`,
              error,
            );
          }

          assistMessageTracking.delete(payload.uuid);

          await db
            .updateTable(TABLE_NAMES.ASSIST_TOKENS)
            .set({
              last_used_at: null,
              last_seen_ip: req.ip,
              last_seen_user_agent: req.get("user-agent") || null,
              updated_at: new Date().toISOString(),
            })
            .where("id", "=", token.id)
            .execute();

          return res.json({ success: true, deleted: true, status: "ended" });
        }

        // Handle POST method for new assist alerts
        const activeTracked = getActiveTrackedAssist(payload.uuid);
        if (activeTracked) {
          return res.status(202).json({
            success: true,
            dropped: true,
            reason: "active_assist_exists",
          });
        }

        const mention = assistConfig.ping_role_id
          ? `<@&${assistConfig.ping_role_id}>`
          : "";
        const initialFightStatus =
          resolveStatusFieldValue(payload) || "Requester not started fight";

        const initialAttackerCount = Number.isFinite(payload.attacker_count)
          ? Number(payload.attacker_count)
          : null;
        const initialAttackerValue = Number.isFinite(initialAttackerCount)
          ? String(initialAttackerCount)
          : payload.attacker_count_state === "mobile_unavailable"
            ? "Unavailable (mobile)"
            : "Unavailable";

        const healthCurrent = payload.enemy_health_current;
        const healthMax = payload.enemy_health_max;
        const healthPercent = payload.enemy_health_percent;
        const initialEnemyHpValue =
          Number.isFinite(healthCurrent) &&
          Number.isFinite(healthMax) &&
          healthMax &&
          healthMax > 0
            ? `${Math.round(healthCurrent)} / ${Math.round(healthMax)} (${Math.max(0, Math.min(100, Math.round(Number.isFinite(healthPercent) ? healthPercent : (healthCurrent / healthMax) * 100)))}%)`
            : "Unavailable";

        const embed = buildInitialAssistEmbed(
          payload.target_torn_id,
          token.discord_id,
          initialFightStatus,
          initialAttackerValue,
          initialEnemyHpValue,
        );
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
          lastActivityAt: Date.now(),
          attackerCount: Number.isFinite(initialAttackerCount)
            ? initialAttackerCount
            : null,
        });

        scheduleAssistExpiry(payload.uuid);

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
          .updateTable(TABLE_NAMES.ASSIST_TOKENS)
          .set({
            last_used_at: new Date().toISOString(),
            last_seen_ip: req.ip,
            last_seen_user_agent: req.get("user-agent") || null,
            updated_at: new Date().toISOString(),
          })
          .where("id", "=", token.id)
          .execute();

        return res.json({
          success: true,
          guildId: token.guild_id,
          channelId: assistConfig.assist_channel_id,
        });
      } catch (error: unknown) {
        const message =
          error instanceof Error ? error.message : "Unknown error";
        console.error("[HTTP] Error processing assist event:", error);
        return res
          .status(500)
          .json({ error: "Failed to process assist event", message });
      }
    },
  );
  // TT Selector Configuration Fetch Endpoint
  app.get("/api/map", async (req: Request, res: Response) => {
    const start = Date.now();
    try {
      const sessionToken = req.headers.authorization?.split(" ")[1];
      const mapIdParam = req.query.mapId as string;

      if (!sessionToken)
        return res.status(401).json({ error: "Missing session token" });

      const session = await magicLinkService.validateSession(
        sessionToken,
        "map",
      );
      if (!session)
        return res.status(401).json({ error: "Invalid or expired session" });

      // If map scope, ensure we have a mapId. If user is admin (all scope), they can access any map.
      // For now, we'll use the mapId from the query if they have permission.
      const sqlDb = getKysely();

      const mapId =
        mapIdParam ||
        (session.scope === "map"
          ? session.target_path.split("mapId=")[1]
          : null);
      if (!mapId) return res.status(400).json({ error: "Missing map ID" });

      // map scope session.target_path usually is '/territories'
      // When opening a map, it might be '/selector?mapId=...'
      // We should allow access if the target_path is generic '/territories' (owner of the session)
      // or if it explicitly matches the mapId.
      const isGenericMapOwner =
        session.scope === "map" && session.target_path === "/territories";
      const isSpecificMapOwner =
        session.scope === "map" &&
        session.target_path.includes(`mapId=${mapId}`);

      if (
        session.scope === "map" &&
        !isGenericMapOwner &&
        !isSpecificMapOwner
      ) {
        return res
          .status(403)
          .json({ error: "Forbidden: You do not have access to this map" });
      }

      const map = await sqlDb
        .selectFrom(TABLE_NAMES.MAPS)
        .selectAll()
        .where("id", "=", mapId)
        .executeTakeFirst();

      if (!map) {
        return res.status(404).json({ error: "Configuration not found" });
      }

      const isOwner = map.created_by === session.discord_id;
      const isPublicInGuild =
        map.is_public === 1 && map.guild_id === session.guild_id;

      if (!isOwner && !isPublicInGuild) {
        return res
          .status(403)
          .json({ error: "Forbidden: You do not have access to this map" });
      }

      const labels = await sqlDb
        .selectFrom(TABLE_NAMES.MAP_LABELS)
        .selectAll()
        .where("map_id", "=", mapId)
        .execute();

      const assignmentsRows = await sqlDb
        .selectFrom(TABLE_NAMES.MAP_TERRITORIES)
        .select(["territory_id", "label_id"])
        .where("map_id", "=", mapId)
        .execute();

      const labelTerritories: Record<string, string[]> = {};
      const assignments: Record<string, string> = {};

      // Separate loop for clarity: 1. Record all territories per label for the UI
      // 2. Identify active assignment (last one wins if multiple)
      assignmentsRows.forEach((row) => {
        if (!labelTerritories[row.label_id])
          labelTerritories[row.label_id] = [];
        labelTerritories[row.label_id].push(row.territory_id);

        // In the assignments map (backward compatibility/rendering helper),
        // we still want one "active" owner.
        assignments[row.territory_id] = row.label_id;
      });

      const blueprints = await sqlDb
        .selectFrom(TABLE_NAMES.TERRITORY_BLUEPRINT)
        .leftJoin(
          TABLE_NAMES.TERRITORY_STATE,
          `${TABLE_NAMES.TERRITORY_STATE}.territory_id`,
          `${TABLE_NAMES.TERRITORY_BLUEPRINT}.id`,
        )
        .select([
          `${TABLE_NAMES.TERRITORY_BLUEPRINT}.id`,
          `${TABLE_NAMES.TERRITORY_BLUEPRINT}.sector`,
          `${TABLE_NAMES.TERRITORY_BLUEPRINT}.respect`,
          `${TABLE_NAMES.TERRITORY_BLUEPRINT}.size`,
          `${TABLE_NAMES.TERRITORY_BLUEPRINT}.slots`,
          `${TABLE_NAMES.TERRITORY_STATE}.racket_name`,
          `${TABLE_NAMES.TERRITORY_STATE}.racket_reward`,
          `${TABLE_NAMES.TERRITORY_STATE}.racket_level`,
        ])
        .execute();

      const territoryMetadata: Record<
        string,
        {
          sector: number;
          respect: number;
          size: number;
          slots: number;
          racket: { name: string; reward: string; level: number } | null;
        }
      > = {};

      const itemNames = new Set<string>();
      let hasPoints = false;

      blueprints.forEach((bp) => {
        if (bp.id) {
          territoryMetadata[bp.id] = {
            sector: bp.sector as number,
            respect: bp.respect as number,
            size: bp.size as number,
            slots: bp.slots as number,
            racket: bp.racket_name
              ? {
                  name: bp.racket_name as string,
                  reward: bp.racket_reward as string,
                  level: bp.racket_level as number,
                }
              : null,
          };

          if (bp.racket_reward) {
            const parsed = parseRewardString(bp.racket_reward);
            if (parsed) {
              if (parsed.type === "items" && parsed.itemName) {
                itemNames.add(parsed.itemName);
              } else if (parsed.type === "points") {
                hasPoints = true;
              }
            }
          }
        }
      });

      console.log(
        `[HTTP] /api/map - Metadata assembled for ${blueprints.length} territories. ${itemNames.size} items to check price.`,
      );

      // Fetch market prices if we have a guild API key
      const guildApiKeys = await getGuildApiKeys(map.guild_id);
      const prices: { items: Record<string, number>; points: number } = {
        items: {},
        points: 0,
      };

      if (guildApiKeys.length > 0) {
        const apiKey = getNextApiKey(map.guild_id, guildApiKeys);

        // Map item names to IDs and get existing values
        if (itemNames.size > 0) {
          const itemRecords = await sqlDb
            .selectFrom(TABLE_NAMES.TORN_ITEMS)
            .select(["item_id", "name", "value"])
            .where("name", "in", Array.from(itemNames))
            .execute();

          const itemIdMap: Record<number, string> = {};
          const missingPriceIds: number[] = [];

          itemRecords.forEach((r) => {
            const name = r.name as string;
            const id = r.item_id as number;
            itemIdMap[id] = name;

            if (r.value !== null && r.value !== undefined) {
              prices.items[name] = r.value as number;
            } else {
              missingPriceIds.push(id);
            }
          });

          if (missingPriceIds.length > 0) {
            console.log(
              `[HTTP] /api/map - Fetching ${missingPriceIds.length} missing market prices...`,
            );
            const marketPrices = await fetchMarketPrices(
              apiKey,
              missingPriceIds,
            );
            Object.entries(marketPrices).forEach(([id, price]) => {
              const name = itemIdMap[Number(id)];
              if (name) prices.items[name] = price;
            });
          }
        }

        if (hasPoints) {
          const pointStart = Date.now();
          prices.points = await fetchPointPrice(apiKey);
          if (Date.now() - pointStart > 5000) {
            console.log(
              `[HTTP] /api/map - Point price fetch took ${Date.now() - pointStart}ms`,
            );
          }
        }
      }

      console.log(`[HTTP] /api/map success - ${Date.now() - start}ms`);
      return res.json({
        map,
        labels: labels.map((l) => ({
          id: l.id as string,
          text: l.label_text,
          color: l.color_hex,
          enabled: (l.is_enabled ?? 1) === 1,
          territories: labelTerritories[l.id as string] || [],
          respect: 0,
          sectors: 0,
          rackets: 0,
        })),
        assignments,
        territoryMetadata,
        prices,
      });
    } catch (error) {
      console.error("[HTTP] Error fetching configuration:", error);
      return res.status(500).json({ error: "Server error" });
    }
  });

  // TT Selector Management Endpoints
  app.get("/api/map/list", async (req: Request, res: Response) => {
    try {
      const sessionToken = req.headers.authorization?.split(" ")[1];
      if (!sessionToken)
        return res.status(401).json({ error: "Missing session token" });

      const session = await magicLinkService.validateSession(
        sessionToken,
        "map",
      );
      if (!session)
        return res.status(401).json({ error: "Invalid or expired session" });

      const guildId = session.guild_id;

      const maps = await db
        .selectFrom(TABLE_NAMES.MAPS)
        .selectAll()
        .where("guild_id", "=", guildId)
        .where((eb) =>
          eb.or([
            eb("created_by", "=", session.discord_id),
            eb("is_public", "=", 1),
          ]),
        )
        .orderBy("updated_at", "desc")
        .execute();

      // Fetch stats for each map (label count and territory count)
      const mapsWithStats = await Promise.all(
        maps.map(async (m) => {
          const labelCount = await db
            .selectFrom(TABLE_NAMES.MAP_LABELS)
            .select(db.fn.count("id").as("count"))
            .where("map_id", "=", m.id)
            .executeTakeFirst();

          const ttCount = await db
            .selectFrom(TABLE_NAMES.MAP_TERRITORIES)
            .select(db.fn.count("territory_id").as("count"))
            .where("map_id", "=", m.id)
            .executeTakeFirst();

          return {
            ...m,
            labelCount: Number(labelCount?.count || 0),
            ttCount: Number(ttCount?.count || 0),
          };
        }),
      );

      return res.json(mapsWithStats);
    } catch (error) {
      console.error("[HTTP] Error listing maps:", error);
      return res.status(500).json({ error: "Server error" });
    }
  });

  app.get("/api/map/channels", async (req: Request, res: Response) => {
    try {
      const sessionToken = req.headers.authorization?.split(" ")[1];
      if (!sessionToken)
        return res.status(401).json({ error: "Missing session token" });

      const session = await magicLinkService.validateSession(
        sessionToken,
        "map",
      );
      if (!session || !session.guild_id)
        return res.status(401).json({ error: "Invalid or expired session" });

      const guildId = session.guild_id;
      const guild = await client.guilds.fetch(guildId);
      const channels = await guild.channels.fetch();

      const textChannels = Array.from(channels.values())
        .filter((c) => c && c.isTextBased())
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .map((c: any) => ({ id: c.id, name: c.name }));

      return res.json(textChannels);
    } catch (error) {
      console.error("[HTTP] Error fetching channels for map:", error);
      return res.status(500).json({ error: "Server error" });
    }
  });

  app.post("/api/map/create", async (req: Request, res: Response) => {
    try {
      const sessionToken = req.headers.authorization?.split(" ")[1];
      const { name } = req.body;

      if (!sessionToken)
        return res.status(401).json({ error: "Missing session token" });
      if (!name) return res.status(400).json({ error: "Missing map name" });

      const session = await magicLinkService.validateSession(
        sessionToken,
        "map",
      );
      if (!session)
        return res.status(401).json({ error: "Invalid or expired session" });

      const mapId = randomUUID();
      await db
        .insertInto(TABLE_NAMES.MAPS)
        .values({
          id: mapId,
          guild_id: session.guild_id,
          name,
          created_by: session.discord_id,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .execute();

      return res.json({ success: true, mapId });
    } catch (error) {
      console.error("[HTTP] Error creating map:", error);
      return res.status(500).json({ error: "Server error" });
    }
  });

  app.get("/api/map/:id/history", async (req: Request, res: Response) => {
    try {
      const sessionToken = req.headers.authorization?.split(" ")[1];
      const { id } = req.params;

      if (!sessionToken)
        return res.status(401).json({ error: "Missing session token" });

      const session = await magicLinkService.validateSession(
        sessionToken,
        "map",
      );
      if (!session)
        return res.status(401).json({ error: "Invalid or expired session" });

      const map = await db
        .selectFrom(TABLE_NAMES.MAPS)
        .select(["guild_id", "created_by", "is_public"])
        .where("id", "=", id)
        .executeTakeFirst();

      if (!map) {
        return res.status(404).json({ error: "Map not found" });
      }

      // Hard Guard on session path
      const isGenericMapOwner =
        session.scope === "map" && session.target_path === "/territories";
      const isSpecificMapOwner =
        session.scope === "map" && session.target_path.includes(`mapId=${id}`);

      if (
        session.scope === "map" &&
        !isGenericMapOwner &&
        !isSpecificMapOwner
      ) {
        return res.status(403).json({ error: "Forbidden: Session mismatch" });
      }

      const isOwner = map.created_by === session.discord_id;
      const isPublicInGuild =
        map.is_public === 1 && map.guild_id === session.guild_id;

      if (!isOwner && !isPublicInGuild) {
        return res
          .status(403)
          .json({
            error: "Forbidden: You do not have access to this map's history",
          });
      }

      const history = await db
        .selectFrom(TABLE_NAMES.MAP_HISTORY)
        .selectAll()
        .where("map_id", "=", id)
        .orderBy("created_at", "desc")
        .limit(20)
        .execute();

      return res.json({ success: true, history });
    } catch (error) {
      console.error("[HTTP] Error fetching map history:", error);
      return res.status(500).json({ error: "Server error" });
    }
  });

  app.post("/api/map/:id/restore", async (req: Request, res: Response) => {
    try {
      const sessionToken = req.headers.authorization?.split(" ")[1];
      const { id } = req.params;
      const { historyId } = req.body;

      if (!sessionToken)
        return res.status(401).json({ error: "Missing session token" });
      if (!historyId)
        return res.status(400).json({ error: "Missing history ID" });

      const session = await magicLinkService.validateSession(
        sessionToken,
        "map",
      );
      if (!session)
        return res.status(401).json({ error: "Invalid or expired session" });

      const map = await db
        .selectFrom(TABLE_NAMES.MAPS)
        .select(["guild_id", "created_by", "is_public"])
        .where("id", "=", id)
        .executeTakeFirst();

      if (!map) {
        return res.status(404).json({ error: "Map not found" });
      }

      // Hard Guard on session path
      const isGenericMapOwner =
        session.scope === "map" && session.target_path === "/territories";
      const isSpecificMapOwner =
        session.scope === "map" && session.target_path.includes(`mapId=${id}`);

      if (
        session.scope === "map" &&
        !isGenericMapOwner &&
        !isSpecificMapOwner
      ) {
        return res.status(403).json({ error: "Forbidden: Session mismatch" });
      }

      const isOwner = map.created_by === session.discord_id;
      const isPublicInGuild =
        map.is_public === 1 && map.guild_id === session.guild_id;

      if (!isOwner && !isPublicInGuild) {
        return res
          .status(403)
          .json({
            error: "Forbidden: You do not have permission to restore this map",
          });
      }

      const historyEntry = await db
        .selectFrom(TABLE_NAMES.MAP_HISTORY)
        .selectAll()
        .where("id", "=", historyId)
        .where("map_id", "=", id)
        .executeTakeFirst();

      if (!historyEntry) {
        return res.status(404).json({ error: "History entry not found" });
      }

      const labels = JSON.parse(historyEntry.snapshot_json);
      const sqlDb = getKysely();

      await sqlDb.transaction().execute(async (trx) => {
        await trx
          .deleteFrom(TABLE_NAMES.MAP_TERRITORIES)
          .where("map_id", "=", id)
          .execute();

        await trx
          .deleteFrom(TABLE_NAMES.MAP_LABELS)
          .where("map_id", "=", id)
          .execute();

        await trx
          .insertInto(TABLE_NAMES.MAP_LABELS)
          .values(
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            labels.map((l: any) => ({
              id: l.id,
              map_id: id,
              label_text: l.text,
              color_hex: l.color,
              is_enabled: l.enabled ? 1 : 0,
            })),
          )
          .execute();

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const territoryValues: any[] = [];
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        labels.forEach((l: any) => {
          if (l.territories && l.territories.length > 0) {
            l.territories.forEach((tid: string) => {
              territoryValues.push({
                map_id: id,
                territory_id: tid,
                label_id: l.id,
              });
            });
          }
        });

        if (territoryValues.length > 0) {
          const chunks = [];
          for (let i = 0; i < territoryValues.length; i += 500) {
            chunks.push(territoryValues.slice(i, i + 500));
          }
          for (const chunk of chunks) {
            await trx
              .insertInto(TABLE_NAMES.MAP_TERRITORIES)
              .values(chunk)
              .execute();
          }
        }

        await trx
          .updateTable(TABLE_NAMES.MAPS)
          .set({ updated_at: new Date().toISOString() })
          .where("id", "=", id)
          .execute();
      });

      return res.json({ success: true });
    } catch (error) {
      console.error("[HTTP] Error restoring map history:", error);
      return res.status(500).json({ error: "Server error" });
    }
  });

  app.patch("/api/map/:id", async (req: Request, res: Response) => {
    try {
      const sessionToken = req.headers.authorization?.split(" ")[1];
      const { id } = req.params;
      const { name, isPublic } = req.body;

      if (!sessionToken)
        return res.status(401).json({ error: "Missing session token" });

      const session = await magicLinkService.validateSession(
        sessionToken,
        "map",
      );
      if (!session)
        return res.status(401).json({ error: "Invalid or expired session" });

      const map = await db
        .selectFrom(TABLE_NAMES.MAPS)
        .select(["guild_id", "created_by"])
        .where("id", "=", id)
        .executeTakeFirst();

      if (!map) {
        return res.status(404).json({ error: "Map not found" });
      }

      // Only owner can rename or toggle public
      if (map.created_by !== session.discord_id) {
        return res
          .status(403)
          .json({
            error:
              "Forbidden: You do not have permission to modify map metadata",
          });
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const updateData: any = {
        updated_at: new Date().toISOString(),
      };
      if (name !== undefined) updateData.name = name;
      if (isPublic !== undefined) updateData.is_public = isPublic ? 1 : 0;

      await db
        .updateTable(TABLE_NAMES.MAPS)
        .set(updateData)
        .where("id", "=", id)
        .execute();

      return res.json({ success: true });
    } catch (error) {
      console.error("[HTTP] Error updating map:", error);
      return res.status(500).json({ error: "Server error" });
    }
  });

  app.delete("/api/map/:id", async (req: Request, res: Response) => {
    try {
      const sessionToken = req.headers.authorization?.split(" ")[1];
      const { id } = req.params;

      if (!sessionToken)
        return res.status(401).json({ error: "Missing session token" });

      const session = await magicLinkService.validateSession(
        sessionToken,
        "map",
      );
      if (!session)
        return res.status(401).json({ error: "Invalid or expired session" });

      const map = await db
        .selectFrom(TABLE_NAMES.MAPS)
        .select("guild_id")
        .where("id", "=", id)
        .executeTakeFirst();

      if (!map || map.guild_id !== session.guild_id) {
        return res.status(403).json({ error: "Forbidden or map not found" });
      }

      const sqlDb = getKysely();
      await sqlDb.transaction().execute(async (trx) => {
        await trx
          .deleteFrom(TABLE_NAMES.MAP_TERRITORIES)
          .where("map_id", "=", id)
          .execute();
        await trx
          .deleteFrom(TABLE_NAMES.MAP_LABELS)
          .where("map_id", "=", id)
          .execute();
        await trx.deleteFrom(TABLE_NAMES.MAPS).where("id", "=", id).execute();
      });

      return res.json({ success: true });
    } catch (error) {
      console.error("[HTTP] Error deleting map:", error);
      return res.status(500).json({ error: "Server error" });
    }
  });

  app.post("/api/map/:id/duplicate", async (req: Request, res: Response) => {
    try {
      const sessionToken = req.headers.authorization?.split(" ")[1];
      const { id } = req.params;
      const { name } = req.body;

      if (!sessionToken)
        return res.status(401).json({ error: "Missing session token" });
      if (!name) return res.status(400).json({ error: "Missing new name" });

      const session = await magicLinkService.validateSession(
        sessionToken,
        "map",
      );
      if (!session)
        return res.status(401).json({ error: "Invalid or expired session" });

      const oldMap = await db
        .selectFrom(TABLE_NAMES.MAPS)
        .selectAll()
        .where("id", "=", id)
        .executeTakeFirst();

      if (!oldMap) {
        return res.status(404).json({ error: "Map not found" });
      }

      const isOwner = oldMap.created_by === session.discord_id;
      const isPublicInGuild =
        oldMap.is_public === 1 && oldMap.guild_id === session.guild_id;

      if (!isOwner && !isPublicInGuild) {
        return res
          .status(403)
          .json({
            error:
              "Forbidden: You do not have permission to duplicate this map",
          });
      }

      const newMapId = randomUUID();
      const sqlDb = getKysely();

      await sqlDb.transaction().execute(async (trx) => {
        await trx
          .insertInto(TABLE_NAMES.MAPS)
          .values({
            id: newMapId,
            guild_id: session.guild_id,
            name,
            created_by: session.discord_id,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .execute();

        const oldLabels = await trx
          .selectFrom(TABLE_NAMES.MAP_LABELS)
          .selectAll()
          .where("map_id", "=", id)
          .execute();

        const labelIdMap: Record<string, string> = {};
        if (oldLabels.length > 0) {
          const newLabels = oldLabels.map((ol) => {
            const newId = `label-${randomBytes(8).toString("hex")}`;
            labelIdMap[ol.id] = newId;
            return {
              id: newId,
              map_id: newMapId,
              label_text: ol.label_text,
              color_hex: ol.color_hex,
              is_enabled: ol.is_enabled,
              created_at: new Date().toISOString(),
            };
          });
          await trx
            .insertInto(TABLE_NAMES.MAP_LABELS)
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            .values(newLabels as any)
            .execute();
        }

        const oldTerritories = await trx
          .selectFrom(TABLE_NAMES.MAP_TERRITORIES)
          .selectAll()
          .where("map_id", "=", id)
          .execute();

        if (oldTerritories.length > 0) {
          const newTerritories = oldTerritories.map((ot) => ({
            map_id: newMapId,
            territory_id: ot.territory_id,
            label_id: labelIdMap[ot.label_id] || ot.label_id,
          }));

          for (let i = 0; i < newTerritories.length; i += 500) {
            await trx
              .insertInto(TABLE_NAMES.MAP_TERRITORIES)
              .values(newTerritories.slice(i, i + 500))
              .execute();
          }
        }
      });

      return res.json({ success: true, mapId: newMapId });
    } catch (error) {
      console.error("[HTTP] Error duplicating map:", error);
      return res.status(500).json({ error: "Server error" });
    }
  });

  app.post("/api/map/:id/publish", async (req: Request, res: Response) => {
    try {
      const sessionToken = req.headers.authorization?.split(" ")[1];
      const { id } = req.params;
      const { channelId } = req.body;

      if (!sessionToken)
        return res.status(401).json({ error: "Missing session token" });
      if (!channelId)
        return res.status(400).json({ error: "Missing channel ID" });

      const session = await magicLinkService.validateSession(
        sessionToken,
        "map",
      );
      if (!session)
        return res.status(401).json({ error: "Invalid or expired session" });

      const map = await db
        .selectFrom(TABLE_NAMES.MAPS)
        .selectAll()
        .where("id", "=", id)
        .executeTakeFirst();

      if (!map || map.guild_id !== session.guild_id) {
        return res.status(403).json({ error: "Forbidden or map not found" });
      }

      const guild = await client.guilds.fetch(session.guild_id);
      const channel = await guild.channels.fetch(channelId);

      if (!channel || !channel.isTextBased()) {
        return res.status(400).json({ error: "Invalid text channel" });
      }

      const labels = await db
        .selectFrom(TABLE_NAMES.MAP_LABELS)
        .selectAll()
        .where("map_id", "=", id)
        .execute();

      const assignments = await db
        .selectFrom(TABLE_NAMES.MAP_TERRITORIES)
        .select(["territory_id", "label_id"])
        .where("map_id", "=", id)
        .execute();

      const tids = assignments.map((a) => a.territory_id);

      const blueprints =
        tids.length > 0
          ? await db
              .selectFrom(TABLE_NAMES.TERRITORY_BLUEPRINT)
              .selectAll()
              .where("id", "in", tids)
              .execute()
          : [];

      const states =
        tids.length > 0
          ? await db
              .selectFrom(TABLE_NAMES.TERRITORY_STATE)
              .selectAll()
              .where("territory_id", "in", tids)
              .execute()
          : [];

      const embeds: EmbedBuilder[] = [];

      embeds.push(
        new EmbedBuilder()
          .setColor(0x3b82f6)
          .setTitle(map.name)
          .setDescription(
            `This configuration was published by <@${session.discord_id}> via Dashboard.`,
          )
          .setTimestamp(),
      );

      for (const label of labels) {
        const labelAssignments = assignments.filter(
          (a) => a.label_id === label.id,
        );
        if (labelAssignments.length === 0) continue;

        const lines = labelAssignments.map((a) => {
          const st = states.find((s) => s.territory_id === a.territory_id);
          let info = `• [**${a.territory_id}**](https://www.torn.com/city.php#territory=${a.territory_id})`;
          if (st?.racket_name)
            info += ` | ${st.racket_name} (L${st.racket_level})`;
          return info;
        });

        const totalRespect = labelAssignments.reduce((acc, a) => {
          const bp = blueprints.find((b) => b.id === a.territory_id);
          return acc + (bp?.respect || 0);
        }, 0);

        const sectors: Record<number, number> = {
          1: 0,
          2: 0,
          3: 0,
          4: 0,
          5: 0,
          6: 0,
          7: 0,
        };
        labelAssignments.forEach((a) => {
          const bp = blueprints.find((b) => b.id === a.territory_id);
          if (bp?.sector) sectors[bp.sector]++;
        });

        const sectorDistribution = [1, 2, 3, 4, 5, 6, 7]
          .map((s) => `**S${s}**: ${sectors[s]}`)
          .join(" | ");

        const value = lines.join("\n").substring(0, 2000);

        const labelEmbed = new EmbedBuilder()
          .setColor(parseInt(label.color_hex.replace("#", ""), 16) || 0x3b82f6)
          .setTitle(label.label_text)
          .setDescription(value)
          .addFields(
            { name: "Sectors", value: sectorDistribution, inline: false },
            {
              name: "Summary",
              value: `Territories: **${labelAssignments.length}**\nDaily Respect: **${totalRespect.toLocaleString()}**`,
              inline: true,
            },
          );

        embeds.push(labelEmbed);
      }

      if (embeds.length === 1) {
        embeds[0].setDescription(
          "This configuration has no territory assignments yet.",
        );
      }

      for (let i = 0; i < embeds.length; i += 10) {
        const chunk = embeds.slice(i, i + 10);
        await channel.send({ embeds: chunk });
      }

      return res.json({ success: true });
    } catch (error) {
      console.error("[HTTP] Error publishing map:", error);
      return res.status(500).json({ error: "Server error" });
    }
  });

  // TT Selector Configuration Save Endpoint
  app.post("/api/map", mapRateLimiter, async (req: Request, res: Response) => {
    try {
      const sessionToken = req.headers.authorization?.split(" ")[1];
      const mapIdParam = req.query.mapId as string;

      if (!sessionToken)
        return res.status(401).json({ error: "Missing session token" });

      const session = await magicLinkService.validateSession(
        sessionToken,
        "map",
      );
      if (!session)
        return res.status(401).json({ error: "Invalid or expired session" });

      const sqlDb = getKysely();
      const mapId =
        mapIdParam ||
        (session.scope === "map"
          ? session.target_path.split("mapId=")[1]
          : null);
      if (!mapId) return res.status(400).json({ error: "Missing map ID" });

      const isGenericMapOwner =
        session.scope === "map" && session.target_path === "/territories";
      const isSpecificMapOwner =
        session.scope === "map" &&
        session.target_path.includes(`mapId=${mapId}`);

      if (
        session.scope === "map" &&
        !isGenericMapOwner &&
        !isSpecificMapOwner
      ) {
        return res.status(403).json({ error: "Forbidden" });
      }

      // Permission Check
      const existingMap = await sqlDb
        .selectFrom(TABLE_NAMES.MAPS)
        .select(["created_by", "guild_id", "is_public"])
        .where("id", "=", mapId)
        .executeTakeFirst();

      if (!existingMap) {
        return res.status(404).json({ error: "Map not found" });
      }

      const isOwner = existingMap.created_by === session.discord_id;
      const isPublicInGuild =
        existingMap.is_public === 1 &&
        existingMap.guild_id === session.guild_id;

      if (!isOwner && !isPublicInGuild) {
        return res
          .status(403)
          .json({
            error: "Forbidden: You do not have permission to edit this map",
          });
      }

      const { labels } = req.body;

      if (!Array.isArray(labels) || labels.length === 0) {
        console.warn(
          `[HTTP] /api/map - Rejecting save: labels is missing or empty for map ${mapId}`,
        );
        return res.status(400).json({
          error: "Invalid configuration: labels must be a non-empty array",
        });
      }

      await sqlDb.transaction().execute(async (trx) => {
        // Since labels is validated to be non-empty above, we proceed with the wipe-and-replace
        // Delete territories first to avoid FK violation with labels
        await trx
          .deleteFrom(TABLE_NAMES.MAP_TERRITORIES)
          .where("map_id", "=", mapId)
          .execute();

        await trx
          .deleteFrom(TABLE_NAMES.MAP_LABELS)
          .where("map_id", "=", mapId)
          .execute();

        await trx
          .insertInto(TABLE_NAMES.MAP_LABELS)
          .values(
            labels.map(
              (l: {
                id: string;
                text: string;
                color: string;
                enabled: boolean;
              }) => ({
                id: l.id,
                map_id: mapId,
                label_text: l.text,
                color_hex: l.color,
                is_enabled: l.enabled ? 1 : 0,
              }),
            ),
          )
          .execute();

        // Insert territories from each label
        const territoryValues: {
          map_id: string;
          territory_id: string;
          label_id: string;
        }[] = [];

        labels.forEach((l: { id: string; territories: string[] }) => {
          if (l.territories && l.territories.length > 0) {
            l.territories.forEach((tid) => {
              territoryValues.push({
                map_id: mapId as string,
                territory_id: tid,
                label_id: l.id,
              });
            });
          }
        });

        if (territoryValues.length > 0) {
          const chunks = [];
          const chunkSize = 500;
          for (let i = 0; i < territoryValues.length; i += chunkSize) {
            chunks.push(territoryValues.slice(i, i + chunkSize));
          }

          for (const chunk of chunks) {
            await trx
              .insertInto(TABLE_NAMES.MAP_TERRITORIES)
              .values(chunk)
              .execute();
          }
        }

        await trx
          .updateTable(TABLE_NAMES.MAPS)
          .set({ updated_at: new Date().toISOString() })
          .where("id", "=", mapId)
          .execute();

        // Save snapshot for history
        // Only save a new entry if the latest one is older than 5 minutes to avoid bloat
        const latestHistory = await trx
          .selectFrom(TABLE_NAMES.MAP_HISTORY)
          .selectAll()
          .where("map_id", "=", mapId)
          .orderBy("created_at", "desc")
          .executeTakeFirst();

        const fiveMinutesAgo = new Date(
          Date.now() - 5 * 60 * 1000,
        ).toISOString();
        if (
          !latestHistory ||
          (latestHistory.created_at &&
            latestHistory.created_at < fiveMinutesAgo)
        ) {
          let creatorName = "Unknown";
          try {
            const user = await discordClient.users.fetch(session.discord_id);
            creatorName = user.displayName || user.username;
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
          } catch (e) {
            console.warn(
              `[HTTP] Failed to fetch user name for snapshot: ${session.discord_id}`,
            );
          }

          await trx
            .insertInto(TABLE_NAMES.MAP_HISTORY)
            .values({
              id: randomUUID(),
              map_id: mapId,
              snapshot_json: JSON.stringify(labels),
              created_by: session.discord_id,
              created_by_name: creatorName,
              created_at: new Date().toISOString(),
            })
            .execute();
        }

        // Prune history to keep storage bounded and history meaningful.
        const HISTORY_RETENTION_DAYS = 30;
        const HISTORY_MAX_ROWS_PER_MAP = 250;
        const cutoffIso = new Date(
          Date.now() - HISTORY_RETENTION_DAYS * 24 * 60 * 60 * 1000,
        ).toISOString();

        await trx
          .deleteFrom(TABLE_NAMES.MAP_HISTORY)
          .where("map_id", "=", mapId)
          .where("created_at", "<", cutoffIso)
          .execute();

        const remainingHistory = await trx
          .selectFrom(TABLE_NAMES.MAP_HISTORY)
          .select(["id"])
          .where("map_id", "=", mapId)
          .orderBy("created_at", "desc")
          .execute();

        const historyIdsToDelete = remainingHistory
          .slice(HISTORY_MAX_ROWS_PER_MAP)
          .map((row) => row.id)
          .filter(
            (id): id is string => typeof id === "string" && id.length > 0,
          );

        if (historyIdsToDelete.length > 0) {
          await trx
            .deleteFrom(TABLE_NAMES.MAP_HISTORY)
            .where("id", "in", historyIdsToDelete)
            .execute();
        }
      });

      return res.json({ success: true });
    } catch (error) {
      console.error("[HTTP] Error saving map:", error);
      return res.status(500).json({ error: "Server error" });
    }
  });

  // Duplicate Map Endpoint
  app.post(
    "/api/map/duplicate",
    mapRateLimiter,
    async (req: Request, res: Response) => {
      try {
        const token = req.query.token as string;
        const { name } = req.body;

        if (!token) return res.status(401).json({ error: "Missing token" });
        if (!name) return res.status(400).json({ error: "Missing new name" });

        const sqlDb = getKysely();
        const session = await sqlDb
          .selectFrom(TABLE_NAMES.MAP_SESSIONS)
          .selectAll()
          .where("token", "=", token)
          .where("expires_at", ">", new Date().toISOString())
          .executeTakeFirst();

        if (!session) return res.status(401).json({ error: "Invalid session" });

        const oldMapId = session.map_id;
        const newMapId = randomUUID();

        // Get old map metadata
        const oldMap = await sqlDb
          .selectFrom(TABLE_NAMES.MAPS)
          .selectAll()
          .where("id", "=", oldMapId)
          .executeTakeFirst();

        if (!oldMap) return res.status(404).json({ error: "Map not found" });

        await sqlDb.transaction().execute(async (trx) => {
          // Create new map
          await trx
            .insertInto(TABLE_NAMES.MAPS)
            .values({
              id: newMapId,
              guild_id: oldMap.guild_id,
              name: name,
              created_by: oldMap.created_by,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            })
            .execute();

          // Copy labels
          const oldLabels = await trx
            .selectFrom(TABLE_NAMES.MAP_LABELS)
            .selectAll()
            .where("map_id", "=", oldMapId)
            .execute();

          const labelIdMap: Record<string, string> = {};
          if (oldLabels.length > 0) {
            const newLabels = oldLabels.map((ol) => {
              const newId = `label-${randomBytes(8).toString("hex")}`;
              labelIdMap[ol.id] = newId;
              return {
                id: newId,
                map_id: newMapId,
                label_text: ol.label_text,
                color_hex: ol.color_hex,
                is_enabled: ol.is_enabled,
                created_at: new Date().toISOString(),
              };
            });
            await trx
              .insertInto(TABLE_NAMES.MAP_LABELS)
              .values(newLabels)
              .execute();
          }

          // Copy territories
          const oldTerritories = await trx
            .selectFrom(TABLE_NAMES.MAP_TERRITORIES)
            .selectAll()
            .where("map_id", "=", oldMapId)
            .execute();

          if (oldTerritories.length > 0) {
            const newTerritories = oldTerritories.map((ot) => ({
              map_id: newMapId,
              territory_id: ot.territory_id,
              label_id: labelIdMap[ot.label_id] || ot.label_id,
            }));

            for (let i = 0; i < newTerritories.length; i += 500) {
              await trx
                .insertInto(TABLE_NAMES.MAP_TERRITORIES)
                .values(newTerritories.slice(i, i + 500))
                .execute();
            }
          }
        });

        return res.json({ ok: true });
      } catch (error) {
        console.error("[HTTP] Error duplicating map:", error);
        return res.status(500).json({ error: "Server error" });
      }
    },
  );

  const magicLinkService = new MagicLinkService(client);

  // Magic Link Activation Route
  app.get("/api/auth/magic-link", async (req: Request, res: Response) => {
    const token = req.query.token as string;
    const uiUrl = getUiUrl();

    if (!token) {
      return res.redirect(`${uiUrl}/?error=missing_token`);
    }

    try {
      const activation = await magicLinkService.activateToken(token);
      if (!activation) {
        return res.redirect(`${uiUrl}/?error=invalid_token`);
      }

      // Redirect to the target path with the session token
      // The frontend will swap this for a persistent cookie or keep in localStorage
      const redirectUrl = new URL(uiUrl + activation.targetPath);
      redirectUrl.searchParams.set("session", activation.sessionToken);

      res.redirect(redirectUrl.toString());
    } catch (error) {
      console.error("[AUTH] Error activated Magic Link:", error);
      res.redirect(`${uiUrl}/?error=activation_failed`);
    }
  });

  // Session Validation
  app.get("/api/auth/me", async (req: Request, res: Response) => {
    const token = req.headers.authorization?.split(" ")[1];
    if (!token) return res.status(401).json({ error: "Missing session token" });

    try {
      const session = await magicLinkService.validateSession(token);
      if (!session)
        return res.status(401).json({ error: "Invalid or expired session" });

      // Fetch user profile from Discord cache/API (we only need basic info)
      try {
        const user = await client.users.fetch(session.discord_id);
        res.json({
          id: user.id,
          username: user.username,
          avatar: user.avatar,
          global_name: user.globalName,
          scope: session.scope,
        });
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
      } catch (_err) {
        // Fallback to minimal data if fetch fails
        res.json({
          id: session.discord_id,
          username: "Unknown User",
          avatar: null,
          global_name: "Unknown User",
          scope: session.scope,
        });
      }
    } catch (error) {
      console.error("[AUTH] Error validating session:", error);
      return res.status(500).json({ error: "Server error" });
    }
  });

  app.post("/api/auth/sign-out", async (req: Request, res: Response) => {
    const token = req.headers.authorization?.split(" ")[1];
    if (token) {
      await magicLinkService.terminateSession(token);
    }
    return res.json({ success: true });
  });

  // Guild Configuration API
  app.get("/api/config", async (req: Request, res: Response) => {
    const token = req.headers.authorization?.split(" ")[1];
    if (!token) return res.status(401).json({ error: "Missing session token" });

    try {
      const session = await magicLinkService.validateSession(token, "config");
      if (!session || !session.guild_id)
        return res.status(401).json({ error: "Invalid or expired session" });

      const guildId = session.guild_id;

      let guildInfo = {
        name: "Unknown Guild",
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        channels: [] as any[],
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        roles: [] as any[],
      };
      try {
        const guild = await client.guilds.fetch(guildId);
        const channels = await guild.channels.fetch();
        const roles = await guild.roles.fetch();

        guildInfo = {
          name: guild.name,
          channels: Array.from(channels.values())
            .filter((c) => c && c.isTextBased())
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            .map((c: any) => ({ id: c.id, name: c.name })),
          roles: Array.from(roles.values()).map((r) => ({
            id: r.id,
            name: r.name,
          })),
        };
      } catch (err) {
        console.error(`[HTTP] Failed to fetch guild info for ${guildId}:`, err);
      }

      // Get main config
      const config = await db
        .selectFrom(TABLE_NAMES.GUILD_CONFIG)
        .selectAll()
        .where("guild_id", "=", guildId)
        .executeTakeFirst();

      if (!config) {
        // Create default config if missing
        await db
          .insertInto(TABLE_NAMES.GUILD_CONFIG)
          .values({
            guild_id: guildId,
            enabled_modules: JSON.stringify(["admin"]),
            admin_role_ids: JSON.stringify([]),
          })
          .execute();

        return res.json({
          guild_id: guildId,
          enabled_modules: ["admin"],
          admin_role_ids: [],
          api_keys: [],
        });
      }

      // Get API keys (masked)
      const keys = await db
        .selectFrom(TABLE_NAMES.GUILD_API_KEYS)
        .select([
          "id",
          "provided_by",
          "is_primary",
          "invalid_count",
          "created_at",
        ])
        .where("guild_id", "=", guildId)
        .where("deleted_at", "is", null)
        .execute();

      // Resolve provided_by usernames
      const keysWithNames = await Promise.all(
        keys.map(async (key) => {
          try {
            const user = await discordClient.users.fetch(key.provided_by);
            return {
              ...key,
              provided_by_name:
                user?.globalName || user?.username || key.provided_by,
            };
          } catch {
            return { ...key, provided_by_name: key.provided_by };
          }
        }),
      );

      res.json({
        ...config,
        guild_name: guildInfo.name,
        channels: guildInfo.channels,
        roles: guildInfo.roles,
        enabled_modules:
          typeof config.enabled_modules === "string"
            ? JSON.parse(config.enabled_modules)
            : config.enabled_modules,
        admin_role_ids:
          typeof config.admin_role_ids === "string"
            ? JSON.parse(config.admin_role_ids)
            : config.admin_role_ids,
        api_keys: keysWithNames,
      });
    } catch (error) {
      console.error("[HTTP] Error fetching config:", error);
      res.status(500).json({ error: "Server error" });
    }
  });

  app.post("/api/config", async (req: Request, res: Response) => {
    const token = req.headers.authorization?.split(" ")[1];
    if (!token) return res.status(401).json({ error: "Missing session token" });

    try {
      const session = await magicLinkService.validateSession(token, "config");
      if (!session || !session.guild_id)
        return res.status(401).json({ error: "Invalid or expired session" });

      const guildId = session.guild_id;
      const {
        log_channel_id,
        admin_role_ids,
        nickname_template,
        enabled_modules,
        auto_verify,
      } = req.body;

      // Get current config to compare
      const currentConfig = await db
        .selectFrom(TABLE_NAMES.GUILD_CONFIG)
        .selectAll()
        .where("guild_id", "=", guildId)
        .executeTakeFirst();

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const updateData: any = {
        updated_at: new Date().toISOString(),
      };

      const changes: string[] = [];

      if (
        log_channel_id !== undefined &&
        log_channel_id !== currentConfig?.log_channel_id
      ) {
        updateData.log_channel_id = log_channel_id;
        changes.push("Log Channel");
      }

      if (admin_role_ids !== undefined) {
        const newRolesStr = JSON.stringify(admin_role_ids);
        if (newRolesStr !== currentConfig?.admin_role_ids) {
          updateData.admin_role_ids = newRolesStr;
          changes.push("Admin Roles");
        }
      }

      if (
        nickname_template !== undefined &&
        nickname_template !== currentConfig?.nickname_template
      ) {
        updateData.nickname_template = nickname_template;
        changes.push("Nickname Template");
      }

      if (enabled_modules !== undefined) {
        const newModulesStr = JSON.stringify(enabled_modules);
        if (newModulesStr !== currentConfig?.enabled_modules) {
          updateData.enabled_modules = newModulesStr;
          changes.push("Modules");
        }
      }

      if (auto_verify !== undefined) {
        const newVal = auto_verify ? 1 : 0;
        if (newVal !== currentConfig?.auto_verify) {
          updateData.auto_verify = newVal;
          changes.push("Auto-Verify");
        }
      }

      if (changes.length > 0) {
        await db
          .updateTable(TABLE_NAMES.GUILD_CONFIG)
          .set(updateData)
          .where("guild_id", "=", guildId)
          .execute();

        // Log the change
        await logGuildSuccess(
          guildId,
          discordClient,
          "System Configuration Updated",
          `<@${session.discord_id}> updated the guild configuration via Web Dashboard.`,
          [
            {
              name: "Updated Settings",
              value: changes.join(", "),
              inline: false,
            },
          ],
        );
      }

      res.json({ ok: true });
    } catch (error) {
      console.error("[HTTP] Error updating config:", error);
      res.status(500).json({ error: "Server error" });
    }
  });

  app.post("/api/config/api-keys", async (req: Request, res: Response) => {
    const token = req.headers.authorization?.split(" ")[1];
    if (!token) return res.status(401).json({ error: "Missing session token" });

    try {
      const session = await magicLinkService.validateSession(token);
      if (!session || !session.guild_id)
        return res.status(401).json({ error: "Invalid or expired session" });

      const { api_key, is_primary } = req.body;
      if (!api_key)
        return res.status(400).json({ error: "API key is required" });

      // Check current key count
      const existingKeys = await getGuildApiKeys(session.guild_id);
      if (existingKeys.length >= 5) {
        return res
          .status(400)
          .json({ error: "Maximum of 5 API keys per guild" });
      }

      // Verification guard: Fetch key info to ensure it's valid and get the Torn ID
      let keyInfo;
      try {
        keyInfo = await validateTornApiKey(api_key);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } catch (err: any) {
        return res.status(400).json({
          error: `API Key Validation Failed: ${err.message}`,
        });
      }

      const primaryBool = !!is_primary;
      await storeGuildApiKey(
        session.guild_id,
        api_key,
        keyInfo.playerId,
        session.discord_id,
        primaryBool,
      );

      // Log the addition (mask the key)
      const maskedKey = `...${api_key.slice(-4)}`;
      await logGuildSuccess(
        session.guild_id,
        discordClient,
        "API Key Added",
        `<@${session.discord_id}> added a new Torn API key (${maskedKey}) via Web Dashboard.`,
      );

      res.json({ ok: true });
    } catch (error) {
      console.error("[HTTP] Error storing API key:", error);
      res.status(500).json({ error: "Server error" });
    }
  });

  app.delete("/api/config/api-keys", async (req: Request, res: Response) => {
    const token = req.headers.authorization?.split(" ")[1];
    if (!token) return res.status(401).json({ error: "Missing session token" });

    try {
      const session = await magicLinkService.validateSession(token);
      if (!session || !session.guild_id)
        return res.status(401).json({ error: "Invalid or expired session" });

      const { api_key_id } = req.body;
      if (!api_key_id)
        return res.status(400).json({ error: "API key ID is required" });

      const keyRecord = await db
        .selectFrom(TABLE_NAMES.GUILD_API_KEYS)
        .selectAll()
        .where("id", "=", api_key_id)
        .where("guild_id", "=", session.guild_id)
        .executeTakeFirst();

      await db
        .updateTable(TABLE_NAMES.GUILD_API_KEYS)
        .set({ deleted_at: new Date().toISOString() })
        .where("id", "=", api_key_id)
        .where("guild_id", "=", session.guild_id)
        .execute();

      // Log the removal
      if (keyRecord) {
        let ownerLabel = keyRecord.provided_by || "Unknown";
        try {
          const owner = await discordClient.users.fetch(keyRecord.provided_by);
          ownerLabel =
            owner?.globalName || owner?.username || keyRecord.provided_by;
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
        } catch (e) {
          // Fallback to mention if resolution fails
          ownerLabel = `<@${keyRecord.provided_by}>`;
        }

        await logGuildAction(session.guild_id, discordClient, {
          title: "API Key Removed",
          description: `<@${session.discord_id}> removed a Torn API key via Web Dashboard.`,
          color: 0xef4444, // Red
          fields: [
            {
              name: "Owned By",
              value: ownerLabel,
              inline: true,
            },
          ],
        });
      }

      res.json({ ok: true });
    } catch (error) {
      console.error("[HTTP] Error deleting API key:", error);
      res.status(500).json({ error: "Server error" });
    }
  });

  // Start server
  app.listen(port, () => {
    console.log(`[HTTP] Server listening on port ${port}`);
  });

  return app;
}
