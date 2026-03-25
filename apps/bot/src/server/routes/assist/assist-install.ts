import { type Request, type Response } from "express";
import { TABLE_NAMES } from "@sentinel/shared";
import { db } from "../../../lib/db-client.js";
import { buildAssistUserscript } from "../../../lib/assist-userscript.js";
import {
  generateAssistEventAuthToken,
  verifyLinkSignature,
} from "../../../lib/assist-link-signing.js";
import { logRateLimitHit } from "../../../lib/assist-monitoring.js";
import { type AssistRouteDeps } from "./assist-types.js";

export function registerAssistInstallRoute({
  app,
  assistRateLimiter,
  ipRateLimiter,
  port,
  isValidUuid,
  getClientIp,
}: AssistRouteDeps): void {
  app.get(
    "/install/:fileName",
    assistRateLimiter,
    async (req: Request, res: Response) => {
      try {
        const clientIp = getClientIp(req);
        const clientUA = req.get("user-agent") || null;

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
            last_seen_ip: clientIp,
            last_seen_user_agent: clientUA,
            updated_at: new Date().toISOString(),
          })
          .where("id", "=", token.id)
          .execute();

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
}
