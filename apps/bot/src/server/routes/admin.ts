/* eslint-disable @typescript-eslint/no-explicit-any */
import { Router, type Request, type Response } from "express";
import { TABLE_NAMES } from "@sentinel/shared";
import { db } from "../../lib/db-client.js";
import { getServerContext } from "../context.js";
import { performBackup } from "../../tasks/db-backup-task.js";
import { syncAllGuildCronSchedules } from "../../lib/cron-schedule-registry.js";
import { getPersonalTrainingRecommendations } from "@sentinel/shared/training-recommendations.js";

export const adminRouter = Router();

// Middleware to ensure user is the bot owner
async function ensureBotOwner(req: Request, res: Response, next: Function) {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return res.status(401).json({ error: "Missing session token" });

  const { magicLinkService } = getServerContext(req);
  const botOwnerId = process.env.SENTINEL_DISCORD_USER_ID;

  try {
    const session = await magicLinkService.validateSession(token, "admin");
    if (!session || session.discord_id !== botOwnerId) {
      return res.status(403).json({ error: "Forbidden: Bot owner only" });
    }
     
    (req as any).session = session;
    next();
  } catch {
    res.status(401).json({ error: "Unauthorized" });
  }
}

adminRouter.use(ensureBotOwner);

// 1. Bot Backups
adminRouter.post("/backups", async (req: Request, res: Response) => {
  const { discordClient } = getServerContext(req);
  try {
    await performBackup(discordClient);

    // Log the backup action
    const { sendAdminSystemLog } = await import("../../lib/admin-logger.js");
    await sendAdminSystemLog(
      discordClient,
      "info",
      `Owner <@${(req as any).session.discord_id}> triggered a manual database backup.`
    ).catch(() => {});

    res.json({ ok: true, message: "Backup triggered and sent to DMs" });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// 2. Deploy Commands
adminRouter.post("/deploy", async (req: Request, res: Response) => {
  try {
    const { deployAllGuildCommands } = await import("../../lib/deploy-commands-helper.js");
    const result = await deployAllGuildCommands();

    // Log the deploy action
    const { sendAdminSystemLog } = await import("../../lib/admin-logger.js");
    await sendAdminSystemLog(
      getServerContext(req).discordClient,
      "info",
      `Owner <@${(req as any).session.discord_id}> triggered a command deployment across all guilds (Success: ${result.success}, Failed: ${result.failure}).`
    ).catch(() => {});

    res.json({ ok: true, message: `Commands deployed to ${result.success} guilds. (Failed: ${result.failure})` });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// 3. Guild & Module Management
adminRouter.get("/guilds", async (req: Request, res: Response) => {
  const { discordClient } = getServerContext(req);
  try {
    const configs = await db
      .selectFrom(TABLE_NAMES.GUILD_CONFIG)
      .selectAll()
      .execute();

    const guilds = configs.map((config) => {
      const guild = discordClient.guilds.cache.get(config.guild_id);
      return {
        id: config.guild_id,
        name: guild?.name || `Unknown (${config.guild_id})`,
        icon: guild?.iconURL(),
        enabled_modules:
          typeof config.enabled_modules === "string"
            ? JSON.parse(config.enabled_modules)
            : config.enabled_modules || [],
        initialized_at: config.created_at,
      };
    });

    res.json(guilds);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

adminRouter.get("/unconfigured-guilds", async (req: Request, res: Response) => {
  const { discordClient } = getServerContext(req);
  try {
    const configuredGuilds = await db
      .selectFrom(TABLE_NAMES.GUILD_CONFIG)
      .select(["guild_id"])
      .execute();

    const configuredIds = new Set(configuredGuilds.map((c) => c.guild_id));
    const unconfigured = discordClient.guilds.cache
      .filter((g) => !configuredIds.has(g.id))
      .map((g) => ({
        id: g.id,
        name: g.name,
        icon: g.iconURL(),
      }));

    res.json(unconfigured);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

adminRouter.post("/guilds", async (req: Request, res: Response) => {
  const { guildId } = req.body;
  if (!guildId) return res.status(400).json({ error: "Missing guildId" });

  try {
    await db
      .insertInto(TABLE_NAMES.GUILD_CONFIG)
      .values({
        guild_id: guildId,
        enabled_modules: JSON.stringify(["admin"]),
        admin_role_ids: JSON.stringify([]),
        verified_role_ids: JSON.stringify([]),
      })
      .execute();

    try {
      await db
        .insertInto(TABLE_NAMES.GUILD_SYNC_JOBS)
        .values({
          guild_id: guildId,
          next_sync_at: new Date().toISOString(),
        })
        .execute();
    } catch {
      // Ignore sync job creation failures
    }

    // Deploy commands for the new guild immediately
    const { deployGuildCommands } = await import("../../lib/deploy-commands-helper.js");
    await deployGuildCommands(guildId);

    // Log the new guild config initialization
    const { sendAdminSystemLog } = await import("../../lib/admin-logger.js");
    await sendAdminSystemLog(
      getServerContext(req).discordClient,
      "info",
      `Owner <@${(req as any).session.discord_id}> initialized guild config for server ID: ${guildId}`
    ).catch(() => {});

    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

adminRouter.patch(
  "/guilds/:id/modules",
  async (req: Request, res: Response) => {
    const { modules } = req.body;
    const guildId = req.params.id as string;
    const { discordClient } = getServerContext(req);

    try {
      const modulesToSave = Array.from(new Set(["admin", ...(modules || [])]));
      await db
        .updateTable(TABLE_NAMES.GUILD_CONFIG)
        .set({ enabled_modules: JSON.stringify(modulesToSave) })
        .where("guild_id", "=", guildId)
        .execute();

      await syncAllGuildCronSchedules(guildId, discordClient);

      // Redeploy commands for the guild since its modules changed
      const { deployGuildCommands } = await import("../../lib/deploy-commands-helper.js");
      await deployGuildCommands(guildId);

      // Log module update action
      const { sendAdminSystemLog } = await import("../../lib/admin-logger.js");
      await sendAdminSystemLog(
        discordClient,
        "info",
        `Owner <@${(req as any).session.discord_id}> updated modules for guild ID: ${guildId} to: [${modulesToSave.join(", ")}]`
      ).catch(() => {});

      res.json({ ok: true, modules: modulesToSave });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  },
);

adminRouter.delete("/guilds/:id", async (req: Request, res: Response) => {
  const guildId = req.params.id as string;
  const { discordClient } = getServerContext(req);
  try {
    await db
      .deleteFrom(TABLE_NAMES.GUILD_CONFIG)
      .where("guild_id", "=", guildId)
      .execute();

    await syncAllGuildCronSchedules(guildId, discordClient);

    // Log deletion action
    const { sendAdminSystemLog } = await import("../../lib/admin-logger.js");
    await sendAdminSystemLog(
      discordClient,
      "info",
      `Owner <@${(req as any).session.discord_id}> deleted config for guild ID: ${guildId}`
    ).catch(() => {});

    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// 4. Fetch Admin Guild Channels (for logging/alerts config dropdown)
adminRouter.get("/channels", async (req: Request, res: Response) => {
  const { discordClient } = getServerContext(req);
  const adminGuildId = process.env.ADMIN_GUILD_ID;

  if (!adminGuildId) {
    return res.status(500).json({ error: "ADMIN_GUILD_ID not configured" });
  }

  try {
    const guild = discordClient.guilds.cache.get(adminGuildId) || await discordClient.guilds.fetch(adminGuildId);
    if (!guild) {
      return res.status(404).json({ error: "Admin Guild not found" });
    }

    const channels = await guild.channels.fetch();
    const textChannels = Array.from(channels.values())
      .filter((c): c is any => c !== null && c.isTextBased())
      .map((c) => ({
        id: c.id,
        name: c.name,
      }));

    res.json(textChannels);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});// 5. Force Sync Gym Logs
adminRouter.post("/sync-gym", async (req: Request, res: Response) => {
  try {
    console.log("[AdminRouter] Manual historical gym logs sync triggered by owner via API");

    const worker = await db
      .selectFrom(TABLE_NAMES.WORKERS)
      .select("id")
      .where("name", "=", "torn_gyms_worker")
      .limit(1)
      .executeTakeFirst();

    if (!worker) {
      console.warn("[AdminRouter] Gym worker not registered yet in sentinel_workers table.");
      return res.status(404).json({ error: "Gym worker not registered yet" });
    }

    await db
      .updateTable(TABLE_NAMES.WORKER_SCHEDULES)
      .set({ force_run: 1 })
      .where("worker_id", "=", worker.id)
      .execute();

    console.log(`[AdminRouter] Set force_run = 1 in database for worker_id: ${worker.id}`);

    // Log force-sync action
    const { sendAdminSystemLog } = await import("../../lib/admin-logger.js");
    await sendAdminSystemLog(
      getServerContext(req).discordClient,
      "info",
      `Owner <@${(req as any).session.discord_id}> triggered manual historical gym sync queue.`
    ).catch((err) => {
      console.error("[AdminRouter] Failed to send admin system log to Discord:", err);
    });

    res.json({ ok: true, message: "Sync worker triggered successfully" });
  } catch (error) {
    console.error("[AdminRouter] Error triggering manual historical gym logs sync:", error);
    res.status(500).json({ error: (error as Error).message });
  }
});

// 6. Scaffold Server-Sent Events (SSE) live energy dashboard stream
adminRouter.get("/live-energy", async (req: Request, res: Response) => {
  // Set headers for Server-Sent Events (SSE)
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders(); // Establish SSE stream

  // Send initial handshake / event
  const sendEvent = (data: any) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  sendEvent({ status: "connected", message: "Energy stream established" });

  // Poll database every 5 seconds for the latest energy data & recommendations
  const intervalId = setInterval(async () => {
    try {
      const userId = process.env.SENTINEL_USER_ID;
      if (!userId) {
        sendEvent({ error: "SENTINEL_USER_ID not configured" });
        return;
      }

      // Fetch latest snapshot
      const userSnapshot = await db
        .selectFrom(TABLE_NAMES.USER_SNAPSHOTS)
        .select(["energy_current", "energy_maximum", "happy_current", "happy_maximum"])
        .orderBy("created_at", "desc")
        .limit(1)
        .executeTakeFirst();

      if (!userSnapshot) {
        sendEvent({ error: "No energy snapshots available" });
        return;
      }

      // Fetch training recommendations
      let apiKey = process.env.TORN_API_KEY || process.env.SENTINEL_API_KEY;
      try {
        const keyRow = await db
          .selectFrom(TABLE_NAMES.SYSTEM_API_KEYS)
          .select("api_key_encrypted")
          .where("key_type", "=", "personal")
          .where("is_primary", "=", 1)
          .where("deleted_at", "is", null)
          .executeTakeFirst();
        
        if (keyRow?.api_key_encrypted && process.env.ENCRYPTION_KEY) {
          const { decryptApiKey } = await import("@sentinel/shared");
          apiKey = decryptApiKey(keyRow.api_key_encrypted, process.env.ENCRYPTION_KEY);
        }
      } catch (err) {
        console.error("[live-energy] Failed to fetch/decrypt personal API key:", err);
      }

      const recs = await getPersonalTrainingRecommendations(db, String(userId), apiKey);

      sendEvent({
        timestamp: new Date().toISOString(),
        energy: {
          current: userSnapshot.energy_current,
          maximum: userSnapshot.energy_maximum,
          percent: Math.round((Number(userSnapshot.energy_current) / Number(userSnapshot.energy_maximum)) * 100),
        },
        happy: {
          current: userSnapshot.happy_current,
          maximum: userSnapshot.happy_maximum,
        },
        recommendation: {
          stat: recs.stat,
          statKey: recs.statKey,
          text: recs.text,
          gymRecommendation: recs.gymRecommendation,
        },
      });
    } catch {
      sendEvent({ error: "Error compiling dashboard stats" });
    }
  }, 5000);

  req.on("close", () => {
    clearInterval(intervalId);
    res.end();
  });
});
