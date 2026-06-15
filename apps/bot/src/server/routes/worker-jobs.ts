import { Router, type Request, type Response } from "express";
import { type Client } from "discord.js";
import { performBackup } from "../../tasks/db-backup-task.js";
import { performDailySummary } from "../../tasks/daily-summary-task.js";
import { performTokenCleanup } from "../../tasks/token-cleanup-task.js";
import { performReviveMaintenance } from "../../commands/general/admin/handlers/revive.js";
import { GuildSyncScheduler } from "../../lib/verification-sync.js";
import { runWarTrackerGuildSync } from "../../lib/war-tracker.js";
import { runMercenaryTrackerGuildSync } from "../../lib/mercenary-tracker.js";
import { isDev } from "../../lib/bot-config.js";

type WorkerJobRequest = {
  workerName?: string;
  metadata?: {
    guildId?: string;
    [key: string]: unknown;
  } | null;
};

const workerJobRouter = Router();

function getBridgeSecret(): string | null {
  return (
    process.env.WORKER_BRIDGE_SECRET ||
    process.env.BOT_WORKER_BRIDGE_SECRET ||
    (isDev ? "dev-secret-bridge-token" : null)
  );
}

function ensureBridgeAuth(req: Request, res: Response): boolean {
  const expectedSecret = getBridgeSecret();
  if (!expectedSecret) {
    res.status(500).json({ error: "Worker bridge secret is not configured" });
    return false;
  }

  const token =
    req.headers.authorization?.split(" ")[1] ||
    req.header("x-worker-bridge-secret");
  if (token !== expectedSecret) {
    res.status(401).json({ error: "Unauthorized" });
    return false;
  }

  return true;
}

async function runGuildSyncOnce(
  client: Client,
  guildId: string,
): Promise<void> {
  const scheduler = new GuildSyncScheduler(client);
  await scheduler.runGuildOnce(guildId);
}

async function runWarTrackerOnce(
  client: Client,
  guildId: string,
): Promise<void> {
  await runWarTrackerGuildSync(client, guildId);
}

async function runMercenaryTrackerOnce(
  client: Client,
  guildId: string,
): Promise<void> {
  await runMercenaryTrackerGuildSync(client, guildId);
}

workerJobRouter.post("/execute", async (req: Request, res: Response) => {
  if (!ensureBridgeAuth(req, res)) {
    return;
  }

  const { discordClient } = req.app.locals as { discordClient?: Client };
  if (!discordClient) {
    res.status(500).json({ error: "Discord client unavailable" });
    return;
  }

  const body = req.body as WorkerJobRequest;
  const workerName = body.workerName?.trim();
  if (!workerName) {
    res.status(400).json({ error: "Missing workerName" });
    return;
  }

  const guildId = body.metadata?.guildId;

  try {
    if (workerName === "bot:daily_summary") {
      await performDailySummary(discordClient);
    } else if (workerName === "bot:db_backup") {
      await performBackup(discordClient);
    } else if (workerName === "bot:token_cleanup") {
      await performTokenCleanup();
    } else if (workerName === "bot:revive_maintenance") {
      await performReviveMaintenance(discordClient);
    } else if (workerName.startsWith("bot:auto_verify:")) {
      if (!guildId) {
        res.status(400).json({ error: "Missing guildId metadata" });
        return;
      }
      await runGuildSyncOnce(discordClient, guildId);
    } else if (workerName.startsWith("bot:war_tracker:")) {
      if (!guildId) {
        res.status(400).json({ error: "Missing guildId metadata" });
        return;
      }
      await runWarTrackerOnce(discordClient, guildId);
    } else if (workerName.startsWith("bot:mercenary_tracker:")) {
      if (!guildId) {
        res.status(400).json({ error: "Missing guildId metadata" });
        return;
      }
      await runMercenaryTrackerOnce(discordClient, guildId);
    } else {
      res.status(404).json({ error: `Unknown worker job '${workerName}'` });
      return;
    }

    res.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: message });
  }
});

export { workerJobRouter };
