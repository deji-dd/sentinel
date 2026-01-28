#!/usr/bin/env tsx
/// <reference types="node" />
/**
 * CLI utility to trigger a worker immediately by setting force_run = true.
 * Usage: pnpm worker:trigger <worker_name>
 * Examples:
 *   pnpm worker:trigger market_trends_worker
 *   pnpm worker:trigger travel_data_worker
 */

import { createClient } from "@supabase/supabase-js";

// Use local Supabase in development, cloud in production
const isDev = process.env.NODE_ENV === "development";
const SUPABASE_URL = isDev
  ? process.env.SUPABASE_URL_LOCAL || "http://127.0.0.1:54321"
  : process.env.SUPABASE_URL;
const SUPABASE_KEY = isDev
  ? process.env.SUPABASE_SERVICE_ROLE_KEY_LOCAL
  : process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error(
    `Error: Missing Supabase credentials for ${isDev ? "local" : "cloud"} environment`,
  );
  console.error(
    isDev
      ? "Required: SUPABASE_URL_LOCAL and SUPABASE_SERVICE_ROLE_KEY_LOCAL"
      : "Required: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY",
  );
  process.exit(1);
}

console.log(
  `[Trigger] Using ${isDev ? "local" : "cloud"} Supabase: ${SUPABASE_URL}`,
);

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

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

  // Look up worker ID by name
  const { data: worker, error: lookupError } = await supabase
    .from("sentinel_workers")
    .select("id")
    .eq("name", workerName)
    .single();

  if (lookupError || !worker) {
    console.error(
      `❌ Worker not found: ${workerName}. Error: ${lookupError?.message || "Unknown error"}`,
    );
    process.exit(1);
  }

  // Trigger the worker
  const { error } = await supabase
    .from("sentinel_worker_schedules")
    .update({ force_run: true })
    .eq("worker_id", worker.id);

  if (error) {
    console.error(`❌ Failed to trigger worker: ${error.message}`);
    process.exit(1);
  }

  console.log(
    "✅ Worker triggered. Will run on next scheduler poll (within 5s).",
  );
  process.exit(0);
}

main();
