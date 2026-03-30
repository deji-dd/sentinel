/**
 * Daily stats summary scheduled task
 * Runs at 00:05 TCT (05:05 UTC) every day to send a summary embed to the admin user
 */

import { Client } from "discord.js";
import { buildDailySummaryEmbed } from "../utils/daily-summary-embed.js";
import { logDuration, logError } from "../lib/logger.js";

const TASK_NAME = "daily_summary";
let summaryInFlight = false;

/**
 * Get the next scheduled run time (00:05 TCT / 05:05 UTC)
 */
function getNextRunTime(): Date {
  const nowUtc = new Date();
  const nextRun = new Date(nowUtc);

  // Set to 05:05 UTC (00:05 TCT)
  nextRun.setUTCHours(5, 5, 0, 0);

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
 * Send the daily summary to the admin user
 */
async function sendDailySummary(client: Client): Promise<void> {
  if (summaryInFlight) {
    return;
  }

  summaryInFlight = true;
  const startTime = Date.now();

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

    // Build the embed
    const embed = await buildDailySummaryEmbed();

    // Send the embed via DM
    await adminUser.send({ embeds: [embed] });

    const duration = Date.now() - startTime;
    logDuration(TASK_NAME, "Daily summary sent successfully", duration);
  } catch (error) {
    const elapsed = Date.now() - startTime;
    let errorMessage = "Unknown error";
    if (error instanceof Error) {
      errorMessage = error.message;
    } else if (typeof error === "string") {
      errorMessage = error;
    }
    const duration =
      elapsed < 1000 ? `${elapsed}ms` : `${(elapsed / 1000).toFixed(2)}s`;
    logError(TASK_NAME, `Failed: ${errorMessage} (${duration})`);
  } finally {
    summaryInFlight = false;
  }
}

/**
 * Start the daily summary scheduled task
 */
export function startDailySummaryTask(client: Client): void {
  const timeUntilFirst = getTimeUntilNextRun();
  const nextRun = getNextRunTime();

  console.log(
    `[${TASK_NAME}] Next summary scheduled for ${nextRun.toISOString()} (${(timeUntilFirst / 1000 / 60).toFixed(0)} minutes from now)`,
  );

  // Schedule the first run
  setTimeout(() => {
    sendDailySummary(client);

    // After first run, schedule it to run every 24 hours
    setInterval(
      () => {
        sendDailySummary(client);
      },
      24 * 60 * 60 * 1000,
    );
  }, timeUntilFirst);
}
