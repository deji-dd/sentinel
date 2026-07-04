import { getSystemApiKey } from "../lib/api-keys.js";
import { tornApi } from "../services/torn-client.js";

async function main() {
  const apiKey = await getSystemApiKey("personal");
  if (!apiKey) {
    console.error("No personal API key found");
    return;
  }

  console.log("Fetching category 94 (Trades) logs...");
  const response = await tornApi.get<any>("/user/log", {
    apiKey,
    queryParams: {
      cat: "94",
      limit: "100",
    },
  });

  const logs = response?.log;
  if (!logs) {
    console.log("No logs field in response:", response);
    return;
  }
  
  const logEntries = Array.isArray(logs) ? logs : Object.values(logs);
  const log4441 = logEntries.find(entry => entry.details?.id === 4441);
  const log4446 = logEntries.find(entry => entry.details?.id === 4446);
  console.log("Example 4441 (Trade money incoming):", JSON.stringify(log4441 || null, null, 2));
  console.log("Example 4446 (Trade items incoming):", JSON.stringify(log4446 || null, null, 2));
}

main().catch(console.error);
