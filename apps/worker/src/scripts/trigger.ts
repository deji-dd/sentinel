#!/usr/bin/env tsx

/**
 * CLI utility to trigger a worker immediately by setting force_run = true.
 * Usage: pnpm worker:trigger <worker_name>
 * Examples:
 * pnpm worker:trigger sync_items
 * pnpm worker:trigger system_maintenance
 */

import { WorkerSchedules } from "@sentinel/shared";

const workerName = process.argv[2];

if (!workerName) {
  console.error("Usage: pnpm worker:trigger <worker_name>");
  console.error("Examples:");
  console.error("  pnpm worker:trigger sync_items");
  console.error("  pnpm worker:trigger system_maintenance");
  process.exit(1);
}

function triggerWorker() {
  console.log(`Triggering ${workerName}...`);

  // 1. O(1) Memory-mapped NoSQL lookup.
  // In the new architecture, the worker's name IS the document ID.
  const schedule = WorkerSchedules.findOne(workerName);

  if (!schedule) {
    console.error(`❌ Worker schedule not found for: ${workerName}`);
    console.log(
      "💡 Tip: Ensure the worker has booted up at least once so it can initialize its schedule document.",
    );
    process.exit(1);
  }

  // 2. Mutate the RAM object
  schedule.force_run = true;

  // 3. Upsert back to the NoSQL engine
  WorkerSchedules.insertOne(schedule);

  console.log(`[${workerName}] triggered successfully.`);
  process.exit(0);
}

triggerWorker();
