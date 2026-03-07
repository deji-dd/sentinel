#!/usr/bin/env tsx
/// <reference types="node" />
/**
 * CLI utility to trigger a worker immediately by setting force_run = true.
 * Usage: pnpm worker:trigger <worker_name>
 * Examples:
 *   pnpm worker:trigger market_trends_worker
 *   pnpm worker:trigger travel_data_worker
 */

import { getDB } from "@sentinel/shared/db/sqlite.js";

const workerName = process.argv[2];

if (!workerName) {
  console.error("Usage: pnpm worker:trigger <worker_name>");
  console.error("Examples:");
  console.error("  pnpm worker:trigger market_trends_worker");
  console.error("  pnpm worker:trigger travel_data_worker");
  process.exit(1);
}

async function main() {
  console.log(`Triggering ${workerName}...`);
  const db = getDB();

  // Look up worker ID by name
  const worker = db
    .prepare(`SELECT id FROM sentinel_workers WHERE name = ? LIMIT 1`)
    .get(workerName) as { id: string } | undefined;

  if (!worker) {
    console.error(`❌ Worker not found: ${workerName}`);
    process.exit(1);
  }

  // Trigger the worker
  const result = db
    .prepare(`UPDATE sentinel_worker_schedules SET force_run = 1 WHERE worker_id = ?`)
    .run(worker.id);

  if (result.changes === 0) {
    console.error(`❌ Failed to trigger worker: schedule row not found`);
    process.exit(1);
  }

  console.log(
    "✅ Worker triggered. Will run on next scheduler poll (within 5s).",
  );
  process.exit(0);
}

main();
