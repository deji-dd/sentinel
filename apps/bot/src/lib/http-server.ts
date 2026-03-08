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
} from "./assist-monitoring.js";
import { fetchTornProfileData } from "./torn-api.js";
import { getGuildApiKeys } from "./guild-api-keys.js";

const app = express();
app.use(express.json());

let discordClient: Client;

const ASSIST_PROXY_SECRET_HEADER = "Proxy-Secret-Header";
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
  enemy_health_current?: number;
  enemy_health_max?: number;
  enemy_health_percent?: number;
};

function normalizeFightStatus(
  value: string | undefined,
): "Requester not started fight" | "Ongoing" | "Ended" | null {
  if (!value) {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === "not started" || normalized === "not_started") {
    return "Requester not started fight";
  }

  if (normalized === "ongoing" || normalized === "started") {
    return "Ongoing";
  }

  if (normalized === "ended" || normalized === "finished") {
    return "Ended";
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

  const sentenceCase =
    compact.charAt(0).toUpperCase() + compact.slice(1).toLowerCase();

  const extract = (pattern: RegExp): string | null => {
    const match = sentenceCase.match(pattern);
    if (!match) {
      return null;
    }

    const phrase = (match[0] || "").replace(/\s+/g, " ").trim();
    return phrase || null;
  };

  const orderedPatterns = [
    /you defeated [^.!?\n]+/i,
    /you mugged [^.!?\n]+/i,
    /you hospitalized [^.!?\n]+/i,
    /you arrested [^.!?\n]+/i,
    /you stalemated[^.!?\n]*/i,
    /you lost[^.!?\n]*/i,
    /[^.!?\n]+ took down your opponent/i,
    /[^.!?\n]+ was defeated by [^.!?\n]+/i,
    /[^.!?\n]+ was sent to hospital/i,
    /[^.!?\n]+ was surrounded by police/i,
  ];

  for (const pattern of orderedPatterns) {
    const phrase = extract(pattern);
    if (phrase) {
      return phrase;
    }
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

function getRemainingWindowSeconds(
  timestamp: string | null | undefined,
  windowMs: number,
): number {
  if (!timestamp) {
    return 0;
  }

  const parsed = new Date(timestamp).getTime();
  if (!Number.isFinite(parsed)) {
    return 0;
  }

  const remainingMs = windowMs - (Date.now() - parsed);
  return remainingMs > 0 ? Math.ceil(remainingMs / 1000) : 0;
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
  requesterDiscordId: string,
  fightStatus: string,
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
      { name: "Attackers", value: "Unavailable", inline: true },
      { name: "Enemy HP", value: "Unavailable", inline: true },
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
          .updateTable(TABLE_NAMES.ASSIST_TOKENS)
          .set({
            // Install/download should not start the active-assist lock window.
            last_seen_ip: req.header("X-Assist-Client-IP") || req.ip || null,
            last_seen_user_agent:
              req.header("X-Assist-Client-UA") || req.get("user-agent") || null,
            updated_at: new Date().toISOString(),
          })
          .where("id", "=", token.id)
          .execute();

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

      if (req.method === "POST") {
        const activeLockSeconds = getRemainingWindowSeconds(
          token.last_used_at,
          ASSIST_EMBED_TIMEOUT_MS,
        );
        if (activeLockSeconds > 0) {
          return res.status(409).json({
            error:
              "You already have an active assist alert. Wait for it to end before sending another one.",
            retry_after_seconds: activeLockSeconds,
          });
        }
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

        // Extract attacker count from details
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

        if (match) {
          const newCount = Number.parseInt(match[2], 10);
          if (Number.isFinite(newCount) && newCount !== tracked.attackerCount) {
            upsertEmbedField(updatedEmbed, "Attackers", String(newCount), true);
            tracked.attackerCount = newCount;
            hasChanges = true;
          }
        }

        if (payload.action === "attacker_count_unavailable") {
          const attackersField = updatedEmbed.data.fields?.find(
            (field) => field.name === "Attackers",
          );
          if (attackersField?.value !== "Unavailable") {
            upsertEmbedField(updatedEmbed, "Attackers", "Unavailable", true);
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
            last_seen_ip: req.ip,
            last_seen_user_agent: req.get("user-agent") || null,
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
          const endedStatus = resolveStatusFieldValue(payload) || "Ended";
          upsertEmbedField(endedEmbed, "Status", endedStatus, true);
          await tracked.message.edit({
            embeds: [endedEmbed],
            components: [],
          });
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
        const remainingMs =
          ASSIST_EMBED_TIMEOUT_MS - (Date.now() - activeTracked.lastActivityAt);
        return res.status(409).json({
          error:
            "You already have an active assist alert. Wait for it to end before sending another one.",
          retry_after_seconds: Math.max(1, Math.ceil(remainingMs / 1000)),
        });
      }

      const mention = assistConfig.ping_role_id
        ? `<@&${assistConfig.ping_role_id}>`
        : "";
      const initialFightStatus =
        resolveStatusFieldValue(payload) || "Requester not started fight";
      const embed = buildInitialAssistEmbed(
        payload.target_torn_id,
        token.discord_id,
        initialFightStatus,
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
        attackerCount: null,
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
