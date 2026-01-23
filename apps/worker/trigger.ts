#!/usr/bin/env tsx
/// <reference types="node" />
/**
 * CLI utility to trigger a worker immediately by setting force_run = true.
 * Usage: pnpm worker:trigger <worker>
 * Examples:
 *   pnpm worker:trigger market_trends_worker
 *   pnpm worker:trigger travel_data_worker
 */

import { triggerWorkerNow } from "./src/lib/supabase-helpers.js";

const worker = process.argv[2];

if (!worker) {
  console.error("Usage: pnpm worker:trigger <worker>");
  console.error("Examples:");
  console.error("  pnpm worker:trigger market_trends_worker");
  console.error("  pnpm worker:trigger travel_data_worker");
  process.exit(1);
}

console.log(`Triggering ${worker}...`);

triggerWorkerNow(worker)
  .then(() => {
    console.log(
      "✅ Worker triggered. Will run on next scheduler poll (within 5s).",
    );
    process.exit(0);
  })
  .catch((error) => {
    console.error("❌ Failed to trigger worker:", error);
    process.exit(1);
  });
