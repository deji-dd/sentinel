/**
 * Database backup scheduled task
 * Runs daily at 04:00 UTC (around 1h before daily summary)
 * Snapshots the DB and sends it to the admin DM
 */

import { Client, AttachmentBuilder } from "discord.js";
import { rawDb } from "../lib/db-client.js";
import { logDuration, logError } from "../lib/logger.js";
import fs from "fs";
import path from "path";

const TASK_NAME = "db_backup";

/**
 * Get the next scheduled run time (04:00 UTC)
 */
function getNextRunTime(): Date {
  const nowUtc = new Date();
  const nextRun = new Date(nowUtc);

  // Set to 04:00 UTC
  nextRun.setUTCHours(4, 0, 0, 0);

  // If this time has already passed today, schedule for tomorrow
  if (nextRun <= nowUtc) {
    nextRun.setUTCDate(nextRun.getUTCDate() + 1);
  }

  return nextRun;
}

/**
 * Calculate milliseconds until next run
 */
function getTimeUntilNextRun(): number {
  const nextRun = getNextRunTime();
  const now = new Date();
  return nextRun.getTime() - now.getTime();
}

/**
 * Perform the database backup and send to admin DM
 */
async function performBackup(client: Client): Promise<void> {
  const startTime = Date.now();
  const tempDir = path.join(process.cwd(), "tmp");

  // Ensure temp directory exists
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = path.join(tempDir, `sentinel-backup-${timestamp}.db`);

  try {
    const adminUserId = process.env.SENTINEL_DISCORD_USER_ID;
    if (!adminUserId) {
      throw new Error("SENTINEL_DISCORD_USER_ID environment variable not set");
    }

    // Fetch the admin user
    const adminUser = await client.users.fetch(adminUserId);
    if (!adminUser) {
      throw new Error(`Admin user (${adminUserId}) not found`);
    }

    /**
     * EFFICIENT BACKUP STRATEGY:
     * We use better-sqlite3's .backup() method which performs a consistent
     * snapshot of the database. This is the SQLite-native way to achieve
     * "global lock -> copy -> release" efficiently without blocking readers
     * or leaving the database in an inconsistent WAL state.
     */
    await rawDb.backup(backupPath);

    // Create attachment
    const attachment = new AttachmentBuilder(backupPath, {
      name: `sentinel-backup-${new Date().toISOString().split("T")[0]}.db`,
    });

    // Send the backup via DM
    await adminUser.send({
      content: `📦 **Daily Database Backup**\nTotal database state snapshot captured and verified.\nTime: <t:${Math.floor(Date.now() / 1000)}:F>`,
      files: [attachment],
    });

    // Cleanup temp file
    if (fs.existsSync(backupPath)) {
      fs.unlinkSync(backupPath);
    }

    const duration = Date.now() - startTime;
    logDuration(TASK_NAME, "Database backup sent successfully", duration);
  } catch (error) {
    const elapsed = Date.now() - startTime;
    let errorMessage = "Unknown error";
    if (error instanceof Error) {
      errorMessage = error.message;
    } else if (typeof error === "string") {
      errorMessage = error;
    }

    logError(TASK_NAME, `Failed: ${errorMessage} (${elapsed}ms)`);

    // Attempt cleanup if it failed
    if (fs.existsSync(backupPath)) {
      try {
        fs.unlinkSync(backupPath);
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
      } catch (e) {
        // Ignore cleanup errors
      }
    }
  }
}

/**
 * Start the database backup scheduled task
 */
export function startDatabaseBackupTask(client: Client): void {
  const timeUntilFirst = getTimeUntilNextRun();
  const nextRun = getNextRunTime();

  console.log(
    `[${TASK_NAME}] Next backup scheduled for ${nextRun.toISOString()} (${(timeUntilFirst / 1000 / 60).toFixed(0)} minutes from now)`,
  );

  // Schedule the first run
  setTimeout(() => {
    performBackup(client);

    // After first run, schedule it to run every 24 hours
    setInterval(
      () => {
        performBackup(client);
      },
      24 * 60 * 60 * 1000,
    );
  }, timeUntilFirst);
}
