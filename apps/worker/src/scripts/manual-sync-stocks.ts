import { syncTornStocks } from "../workers/torn-stocks.js";
import { syncCrimesData } from "../workers/torn-crimes.js";
import { initializeApiKeyMappings } from "../services/torn-client.js";
import { initializeRateLimitCache } from "../lib/rate-limit-tracker-per-user.js";

async function main() {
  console.log("Initializing API key mappings...");
  await initializeApiKeyMappings("all");
  await initializeRateLimitCache();

  console.log("Running manual sync of stocks, points market, and property values...");
  await syncTornStocks();

  console.log("Running manual sync of crimes and subcrime definitions...");
  await syncCrimesData();

  console.log("Manual sync completed successfully!");
  process.exit(0);
}

main().catch((err) => {
  console.error("Manual sync failed:", err);
  process.exit(1);
});
