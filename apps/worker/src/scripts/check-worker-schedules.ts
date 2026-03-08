#!/usr/bin/env tsx
/**
 * Diagnostic script to check worker schedule configuration
 * Usage: npx tsx --env-file=.env src/scripts/check-worker-schedules.ts
 */

import { getKysely } from "@sentinel/shared/db/sqlite.js";
import { TABLE_NAMES } from "@sentinel/shared";

async function main() {
  const db = getKysely();

  console.log("\n📊 Worker Schedule Status\n");
  console.log("=".repeat(120));

  const schedules = await db
    .selectFrom(TABLE_NAMES.WORKER_SCHEDULES)
    .innerJoin(
      TABLE_NAMES.WORKERS,
      `${TABLE_NAMES.WORKERS}.id`,
      `${TABLE_NAMES.WORKER_SCHEDULES}.worker_id`,
    )
    .select([
      `${TABLE_NAMES.WORKERS}.name as worker_name`,
      `${TABLE_NAMES.WORKER_SCHEDULES}.enabled`,
      `${TABLE_NAMES.WORKER_SCHEDULES}.cadence_seconds`,
      `${TABLE_NAMES.WORKER_SCHEDULES}.next_run_at`,
      `${TABLE_NAMES.WORKER_SCHEDULES}.last_run_at`,
      `${TABLE_NAMES.WORKER_SCHEDULES}.force_run`,
      `${TABLE_NAMES.WORKER_SCHEDULES}.attempts`,
      `${TABLE_NAMES.WORKER_SCHEDULES}.backoff_until`,
    ])
    .orderBy("worker_name", "asc")
    .execute();

  const now = new Date();

  for (const schedule of schedules) {
    const cadenceHours = schedule.cadence_seconds / 3600;
    const nextRun = new Date(schedule.next_run_at);
    const timeDiff = nextRun.getTime() - now.getTime();
    const isDue = timeDiff <= 0;
    const status = Number(schedule.enabled) ? "✓ Enabled" : "✗ Disabled";

    console.log(`\n${schedule.worker_name}`);
    console.log(`  Status: ${status}`);
    console.log(
      `  Cadence: ${schedule.cadence_seconds}s (${cadenceHours.toFixed(2)}h)`,
    );
    console.log(
      `  Next run: ${schedule.next_run_at} ${isDue ? "(DUE NOW)" : ""}`,
    );
    console.log(`  Last run: ${schedule.last_run_at || "never"}`);
    console.log(`  Force run: ${Number(schedule.force_run) ? "YES" : "no"}`);
    console.log(`  Attempts: ${schedule.attempts}`);
    console.log(`  Backoff until: ${schedule.backoff_until || "none"}`);
  }

  console.log("\n" + "=".repeat(120));
  console.log(`\n✓ Total workers: ${schedules.length}`);
  console.log(
    `✓ Enabled: ${schedules.filter((s) => Number(s.enabled)).length}`,
  );
  console.log(
    `✓ Due now: ${schedules.filter((s) => new Date(s.next_run_at) <= now).length}`,
  );

  // Check for potential issues
  const issues = [];

  // Check for very short cadences (< 10 seconds)
  const shortCadence = schedules.filter((s) => s.cadence_seconds < 10);
  if (shortCadence.length > 0) {
    issues.push(
      `⚠️  ${shortCadence.length} worker(s) with cadence < 10s: ${shortCadence.map((s) => s.worker_name).join(", ")}`,
    );
  }

  // Check for next_run_at far in the future (> 1 month)
  const farFuture = schedules.filter(
    (s) =>
      new Date(s.next_run_at).getTime() >
      now.getTime() + 30 * 24 * 60 * 60 * 1000,
  );
  if (farFuture.length > 0) {
    issues.push(
      `⚠️  ${farFuture.length} worker(s) scheduled > 1 month in future: ${farFuture.map((s) => s.worker_name).join(", ")}`,
    );
  }

  if (issues.length > 0) {
    console.log("\n⚠️  Potential Issues:");
    issues.forEach((issue) => console.log(`   ${issue}`));
  }

  console.log();
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
