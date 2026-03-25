import { type Request, type Response } from "express";
import { TABLE_NAMES } from "@sentinel/shared";
import { db } from "../../../lib/db-client.js";
import { logPayloadTooLarge } from "../../../lib/assist-monitoring.js";
import { type AssistPayload } from "./assist-support.js";
import { type AssistRouteDeps } from "./assist-types.js";
import {
  handleAssistCreateEvent,
  handleAssistDeleteEvent,
  handleAssistPatchEvent,
} from "./assist-events-lifecycle.js";

export function registerAssistEventsRoute({
  app,
  assistRateLimiter,
  allowedProxyMethods,
  maxPayloadBytes,
  slowDeliveryWarnMs,
  isValidUuid,
  getClientIp,
  getAssistPayloadSizeBytes,
  discordClient,
  ...deps
}: AssistRouteDeps): void {
  app.all(
    "/api/assist-events",
    assistRateLimiter,
    async (req: Request, res: Response) => {
      try {
        if (!allowedProxyMethods.has(req.method)) {
          return res.status(405).json({
            error: "Method not allowed",
            allowed_methods: Array.from(allowedProxyMethods),
          });
        }

        const clientIp = getClientIp(req);
        const clientUA = req.get("user-agent") || null;

        const payloadSize = getAssistPayloadSizeBytes(req);
        if (payloadSize > maxPayloadBytes) {
          logPayloadTooLarge(
            req.path,
            clientIp,
            clientUA,
            payloadSize,
            maxPayloadBytes,
          );
          return res.status(413).json({
            error: "Payload too large",
            max_bytes: maxPayloadBytes,
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

        const clientToServerLagMs = payload.client_sent_at
          ? Date.now() - new Date(payload.client_sent_at).getTime()
          : null;
        if (
          Number.isFinite(clientToServerLagMs) &&
          clientToServerLagMs !== null &&
          clientToServerLagMs >= slowDeliveryWarnMs
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

        const sharedContext = {
          payload,
          token,
          clientIp,
          clientUA,
          deps: {
            app,
            assistRateLimiter,
            allowedProxyMethods,
            maxPayloadBytes,
            slowDeliveryWarnMs,
            isValidUuid,
            getClientIp,
            getAssistPayloadSizeBytes,
            discordClient,
            ...deps,
          } satisfies AssistRouteDeps,
        };

        if (req.method === "PATCH") {
          return handleAssistPatchEvent(sharedContext, res);
        }

        if (req.method === "DELETE") {
          return handleAssistDeleteEvent(sharedContext, res);
        }

        return handleAssistCreateEvent(
          {
            ...sharedContext,
            assistConfig: {
              assist_channel_id: assistConfig.assist_channel_id,
              ping_role_id: assistConfig.ping_role_id,
            },
            sendMessage: (options) => channel.send(options),
          },
          res,
        );
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
}
