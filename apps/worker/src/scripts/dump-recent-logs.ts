/* eslint-disable @typescript-eslint/no-explicit-any */
import { getSystemApiKey } from "../lib/api-keys.js";
import { tornApi } from "../services/torn-client.js";
import * as fs from "fs";
import * as path from "path";

async function main() {
  const apiKey = await getSystemApiKey("personal");
  if (!apiKey) {
    console.error("No personal API key found");
    return;
  }

  console.log("Fetching recent logs...");
  const response = await tornApi.getRaw<any>("/user", apiKey, {
    selections: "log",
    limit: 100,
  });

  const logs = response?.log || [];
  console.log(`Found ${logs.length} log entries`);

  const outputPath = path.resolve("./src/scripts/recent-logs.json");
  fs.writeFileSync(outputPath, JSON.stringify(logs, null, 2));
  console.log(`Saved logs to ${outputPath}`);
}

main().catch(console.error);
