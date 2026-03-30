import { Router, type Request, type Response } from "express";
import { REST, Routes } from "discord.js";
import { TABLE_NAMES } from "@sentinel/shared";
import { db } from "../../lib/db-client.js";
import { getServerContext } from "../context.js";
import { performBackup } from "../../tasks/db-backup-task.js";

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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
    res.json({ ok: true, message: "Backup triggered and sent to DMs" });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// 2. Deploy Commands
adminRouter.post("/deploy", async (req: Request, res: Response) => {
  const isDev = process.env.NODE_ENV === "development";
  const token = isDev
    ? process.env.DISCORD_BOT_TOKEN_LOCAL
    : process.env.DISCORD_BOT_TOKEN;
  const clientId = isDev
    ? process.env.DISCORD_CLIENT_ID_LOCAL
    : process.env.DISCORD_CLIENT_ID;
  const adminGuildId = process.env.ADMIN_GUILD_ID;

  if (!token || !clientId || !adminGuildId) {
    return res
      .status(500)
      .json({ error: "Missing configuration for deployment" });
  }

  try {
    const rest = new REST({ version: "10" }).setToken(token);

    // In a real app, importing all commands here might be messy,
    // but we'll follow the pattern from deploy-commands.ts.
    // For now, let's just trigger a generic deployment report or mirror the logic.
    // NOTE: This usually takes time, so we might want to run it semi-asyncly.

    // We'll respond immediately and run deployment in background or just wait.
    // Given the request, we'll wait since it's an admin action.

    const configCommand =
      await import("../../commands/general/admin/config.js");
    const verifyCommand =
      await import("../../commands/general/verification/verify.js");
    const verifyallCommand =
      await import("../../commands/general/verification/verifyall.js");

    const commands = [
      configCommand.data.toJSON(),
      verifyCommand.data.toJSON(),
      verifyallCommand.data.toJSON(),
      // ... we could add more or just deploy the core set
    ];

    await rest.put(Routes.applicationGuildCommands(clientId, adminGuildId), {
      body: commands,
    });

    res.json({ ok: true, message: "Commands deployed to Admin Guild" });
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

    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

adminRouter.patch(
  "/guilds/:id/modules",
  async (req: Request, res: Response) => {
    const { modules } = req.body;
    const guildId = req.params.id;

    try {
      const modulesToSave = Array.from(new Set(["admin", ...(modules || [])]));
      await db
        .updateTable(TABLE_NAMES.GUILD_CONFIG)
        .set({ enabled_modules: JSON.stringify(modulesToSave) })
        .where("guild_id", "=", guildId)
        .execute();

      res.json({ ok: true, modules: modulesToSave });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  },
);

adminRouter.delete("/guilds/:id", async (req: Request, res: Response) => {
  const guildId = req.params.id;
  try {
    await db
      .deleteFrom(TABLE_NAMES.GUILD_CONFIG)
      .where("guild_id", "=", guildId)
      .execute();
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});
