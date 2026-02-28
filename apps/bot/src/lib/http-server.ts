import express, { type Request, type Response } from "express";
import { type Client } from "discord.js";

const app = express();
app.use(express.json());

let discordClient: Client;

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

  // Start server
  app.listen(port, () => {
    console.log(`[HTTP] Server listening on port ${port}`);
  });

  return app;
}
