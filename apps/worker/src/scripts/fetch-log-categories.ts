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

  console.log("Fetching logcategories...");
  const categoriesResponse = await tornApi.getRaw<any>("/torn", apiKey, {
    selections: "logcategories",
  });

  const categories = categoriesResponse?.logcategories || {};
  console.log(`Found ${Object.keys(categories).length} categories`);

  const outputPath = path.resolve("./src/scripts/logcategories.json");
  fs.writeFileSync(outputPath, JSON.stringify(categories, null, 2));
  console.log(`Saved log categories to ${outputPath}`);
}

main().catch(console.error);
