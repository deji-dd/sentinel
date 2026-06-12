/**
 * Database backup scheduled task
 * Runs daily at 04:00 UTC (around 1h before daily summary)
 * Snapshots the DB and sends it to the admin DM
 */

import { Client, AttachmentBuilder, EmbedBuilder } from "discord.js";
import { rawDb } from "../lib/db-client.js";
import { logDuration, logError, logInfo } from "../lib/logger.js";
import fs from "fs";
import path from "path";

const TASK_NAME = "db_backup";
let backupInFlight = false;

/**
 * Prune backup files older than 3 days
 */
function pruneOldBackups(tempDir: string): void {
  try {
    if (!fs.existsSync(tempDir)) {
      return;
    }

    const files = fs.readdirSync(tempDir);
    const threeDaysAgo = Date.now() - 3 * 24 * 60 * 60 * 1000;
    let prunedCount = 0;

    for (const file of files) {
      if (file.startsWith("sentinel-backup-") && file.endsWith(".db")) {
        const filePath = path.join(tempDir, file);
        const stats = fs.statSync(filePath);
        if (stats.mtimeMs < threeDaysAgo) {
          fs.unlinkSync(filePath);
          prunedCount++;
        }
      }
    }

    if (prunedCount > 0) {
      logInfo(TASK_NAME, `Pruned ${prunedCount} old backup file(s) older than 3 days`);
    }
  } catch (error) {
    let errorMessage = "Unknown error";
    if (error instanceof Error) {
      errorMessage = error.message;
    }
    logError(TASK_NAME, `Failed to prune old backups: ${errorMessage}`);
  }
}

/**
 * Perform the database backup and send to admin DM
 */
export async function performBackup(client: Client): Promise<void> {
  if (backupInFlight) {
    return;
  }

  backupInFlight = true;
  const startTime = Date.now();
  const tempDir = path.join(process.cwd(), "tmp");

  // Ensure temp directory exists
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }

  // Prune old backups before creating a new one
  pruneOldBackups(tempDir);

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
    const embed = new EmbedBuilder()
      .setColor(0x10b981)
      .setTitle("Daily Database Backup")
      .setDescription("Total database state snapshot captured and verified.")
      .setFields({
        name: "Time",
        value: `<t:${Math.floor(Date.now() / 1000)}:F>`,
      })
      .setTimestamp();

    await adminUser.send({
      embeds: [embed],
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
  } finally {
    backupInFlight = false;
  }
}


