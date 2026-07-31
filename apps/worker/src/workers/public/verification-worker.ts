import { Logger } from "@sentinel/utils";
import { db } from "@sentinel/database";
import { startEventDrivenRunner } from "../../lib/scheduler.js";
import {
  runVerificationJob,
  runBulkGuildVerification,
} from "../../lib/verification-engine.js";
import type { WorkerStartOptions } from "../registry.js";

const WORKER_NAME = "verification_worker";
const logger = new Logger(WORKER_NAME);

/**
 * Periodically checks for guilds with `verifyCron` enabled and triggers verification runs.
 */
export async function runVerificationWorker(): Promise<void> {
  const finishLog = logger.time();

  try {
    const guilds = await db.guildConfig.findMany({
      where: {
        verifyCron: true,
        enabledModules: { has: "verification" },
      },
      select: {
        guildId: true,
        verifyCronInterval: true,
        lastVerifyCronAt: true,
      },
    });

    const now = new Date();

    for (const guild of guilds) {
      const intervalMs = (guild.verifyCronInterval || 24) * 60 * 60 * 1000;
      const lastRun = guild.lastVerifyCronAt?.getTime() || 0;

      if (now.getTime() - lastRun >= intervalMs) {
        await db.guildConfig.update({
          where: { guildId: guild.guildId },
          data: { lastVerifyCronAt: now },
        });

        // Execute optimized bulk verification sweep for the guild
        logger.info(`Running optimized bulk cron verification sweep for guild ${guild.guildId}...`);
        const stats = await runBulkGuildVerification(guild.guildId, "cron");
        logger.info(
          `Cron verification completed for guild ${guild.guildId}: ${stats.processed} processed, ${stats.updated} updated, ${stats.errors} errors.`,
        );
      }
    }

    finishLog();
  } catch (error) {
    logger.error("Error running background verification worker:", error);
  }
}

/**
 * Starts the periodic verification worker.
 */
export function startVerificationWorker(options?: WorkerStartOptions): void {
  startEventDrivenRunner({
    worker: WORKER_NAME,
    defaultCadenceSeconds: 3600, // Runs hourly check
    initialDelayMs: options?.initialDelayMs,
    handler: runVerificationWorker,
  });
}
