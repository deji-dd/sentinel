#!/usr/bin/env tsx
import { tornApi } from "@sentinel/shared";

/**
 * Diagnostic CLI tool to test Torn API endpoints dynamically.
 * Usage: pnpm tsx apps/worker/src/scripts/test-api.ts /user/basic
 */
async function run() {
  // 1. Parse the path from the command line arguments
  const path = process.argv[2];
  if (!path) {
    console.error("❌ Error: You must provide an API path.");
    console.error("💡 Example: pnpm tsx test-api.ts /torn/items");
    process.exit(1);
  }

  // 2. Grab the personal key directly from the environment (bypassing the DB)
  const apiKey = process.env.TORN_API_KEY || process.env.SENTINEL_API_KEY;
  if (!apiKey) {
    console.error(
      "❌ Error: TORN_API_KEY or SENTINEL_API_KEY is missing from your .env file.",
    );
    process.exit(1);
  }

  console.log(`\n📡 Fetching data from: ${path}`);
  console.log("=".repeat(50));

  try {
    const startTime = performance.now();

    // 3. Execute the request
    const response = await tornApi.get(path, { apiKey });

    const duration = (performance.now() - startTime).toFixed(2);

    // 4. Print the raw data to the terminal
    // Using console.dir with depth: null ensures deeply nested objects aren't hidden behind [Object] tags
    console.dir(response, { depth: null, colors: true });

    console.log("\n" + "=".repeat(50));
    console.log(`✅ Success! Request completed in ${duration}ms\n`);
  } catch (error) {
    console.log("\n" + "=".repeat(50));
    console.error("❌ API Request Failed:");
    console.error(error instanceof Error ? error.message : String(error));
    console.log("\n");
    process.exit(1);
  }
}

run();
