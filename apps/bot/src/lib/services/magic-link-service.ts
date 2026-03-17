import { rawDb } from "../db-client.js";
import { randomBytes } from "node:crypto";
import { EmbedBuilder, type Client } from "discord.js";

export interface TokenOptions {
  discordId: string;
  guildId: string;
  scope: "map" | "config" | "all";
  targetPath: string;
  ttlMinutes?: number;
}

interface AuthTokenRow {
  token: string;
  discord_id: string;
  guild_id: string;
  scope: string;
  target_path: string;
  is_used: number;
  expires_at: string;
  created_at: string;
}

interface WebSessionRow {
  session_token: string;
  discord_id: string;
  guild_id: string;
  scope: string;
  target_path: string;
  device_id: string | null;
  expires_at: string;
  created_at: string;
}

export class MagicLinkService {
  constructor(private client: Client) {}

  /**
   * Generates a new magic link token
   */
  async createToken(options: TokenOptions): Promise<string> {
    // Check if user is revoked
    const isRevoked = rawDb
      .prepare("SELECT 1 FROM sentinel_revoked_users WHERE discord_id = ?")
      .get(options.discordId);
    if (isRevoked) {
      throw new Error("User is revoked from generating tokens");
    }

    const token = randomBytes(32).toString("hex");
    const expiresAt = new Date(
      Date.now() + (options.ttlMinutes || 15) * 60000,
    ).toISOString();

    rawDb
      .prepare(
        `
      INSERT INTO sentinel_auth_tokens (token, discord_id, guild_id, scope, target_path, expires_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `,
      )
      .run(
        token,
        options.discordId,
        options.guildId,
        options.scope,
        options.targetPath,
        expiresAt,
      );

    this.logActivity(
      `Token generated for <@${options.discordId}> (Scope: ${options.scope}, Path: ${options.targetPath})`,
    );

    return token;
  }

  /**
   * Validates and "burns" a token, returning a session
   */
  async activateToken(token: string) {
    const record = rawDb
      .prepare(
        `
      SELECT * FROM sentinel_auth_tokens 
      WHERE token = ? AND is_used = 0 AND expires_at > ?
    `,
      )
      .get(token, new Date().toISOString()) as AuthTokenRow | undefined;

    if (!record) {
      // Look up who originally owned this token for a useful alert
      const expired = rawDb
        .prepare("SELECT discord_id FROM sentinel_auth_tokens WHERE token = ?")
        .get(token) as { discord_id: string } | undefined;

      const ownerInfo = expired
        ? `Token owner: <@${expired.discord_id}>`
        : "Token not found in database";

      this.alertAbuse(
        `Invalid or already used token activation attempt. ${ownerInfo}`,
      );
      return null;
    }

    // Burn token immediately (Burn-on-read)
    rawDb
      .prepare("UPDATE sentinel_auth_tokens SET is_used = 1 WHERE token = ?")
      .run(token);

    // Create session - Default 15 minutes of initial life
    const sessionToken = randomBytes(48).toString("hex");
    const sessionExpiresAt = new Date(Date.now() + 15 * 60000).toISOString();

    rawDb
      .prepare(
        `
      INSERT INTO sentinel_web_sessions (session_token, discord_id, guild_id, scope, target_path, expires_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `,
      )
      .run(
        sessionToken,
        record.discord_id,
        record.guild_id,
        record.scope,
        record.target_path,
        sessionExpiresAt,
      );

    this.logActivity(
      `Token activated by <@${record.discord_id}> for ${record.target_path}. Session created. (Scope: ${record.scope})`,
    );

    return {
      sessionToken,
      discordId: record.discord_id,
      scope: record.scope,
      targetPath: record.target_path,
    };
  }

  async validateSession(sessionToken: string) {
    const session = rawDb
      .prepare(
        `
      SELECT * FROM sentinel_web_sessions 
      WHERE session_token = ? AND expires_at > ?
    `,
      )
      .get(sessionToken, new Date().toISOString()) as WebSessionRow | undefined;

    if (!session) return null;

    // Sliding window: Extend session by another 15 minutes on activity
    const newExpiresAt = new Date(Date.now() + 15 * 60000).toISOString();
    rawDb
      .prepare(
        "UPDATE sentinel_web_sessions SET expires_at = ? WHERE session_token = ?",
      )
      .run(newExpiresAt, sessionToken);

    // Check if user has been revoked since session started
    const isRevoked = rawDb
      .prepare("SELECT 1 FROM sentinel_revoked_users WHERE discord_id = ?")
      .get(session.discord_id);
    if (isRevoked) {
      this.terminateSession(sessionToken);
      return null;
    }

    return session;
  }

  async terminateSession(sessionToken: string) {
    rawDb
      .prepare("DELETE FROM sentinel_web_sessions WHERE session_token = ?")
      .run(sessionToken);
  }

  async revokeUser(discordId: string, revokedBy: string, reason?: string) {
    rawDb
      .prepare(
        `
      INSERT OR REPLACE INTO sentinel_revoked_users (discord_id, revoked_by, reason)
      VALUES (?, ?, ?)
    `,
      )
      .run(discordId, revokedBy, reason || "No reason provided");

    // Clear all active sessions for this user
    rawDb
      .prepare("DELETE FROM sentinel_web_sessions WHERE discord_id = ?")
      .run(discordId);

    this.alertAbuse(
      `User <@${discordId}> has been REVOKED by <@${revokedBy}>. Reason: ${reason}`,
    );
  }

  private async logActivity(message: string) {
    console.log(`[AUTH] ${message}`);
    // Optional: Send to a log channel
  }

  private async alertAbuse(message: string) {
    console.error(`[AUTH-ABUSE] ${message}`);

    const adminId = process.env.SENTINEL_DISCORD_USER_ID;
    if (!adminId) return;

    try {
      const admin = await this.client.users.fetch(adminId);
      const embed = new EmbedBuilder()
        .setTitle("Auth Security Alert")
        .setDescription(message)
        .setColor(0xff0000)
        .setTimestamp();

      await admin.send({ embeds: [embed] });
    } catch (err) {
      console.error("Failed to send abuse alert to admin", err);
    }
  }
}
