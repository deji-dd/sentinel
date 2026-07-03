/* eslint-disable @typescript-eslint/no-explicit-any */
import { getKysely } from "@sentinel/shared/db/sqlite.js";
import { TABLE_NAMES, parseFinanceLedger, TornApiClient } from "@sentinel/shared";
import { getSystemApiKey } from "../lib/api-keys.js";


async function main() {
  process.env.DB_PATH = "data/sentinel-local.db";
  const db = getKysely();

  const apiKey = process.env.TORN_API_KEY || await getSystemApiKey("personal");
  if (!apiKey) {
    console.error("❌ ERROR: No personal API key found in DB or env. Please set TORN_API_KEY.");
    process.exit(1);
  }

  // Load items map
  const items = await db
    .selectFrom(TABLE_NAMES.TORN_ITEMS)
    .select(["item_id", "name", "value", "image", "type"])
    .execute();

  const itemMap = new Map();
  const itemNameMap = new Map();
  for (const item of items) {
    const itemId = Number(item.item_id);
    if (itemId) {
      itemMap.set(itemId, {
        name: item.name || "",
        value: item.value ?? 0,
      });
    }
    if (item.name) {
      itemNameMap.set(item.name.toLowerCase(), {
        item_id: itemId,
        name: item.name,
        value: item.value ?? 0,
      });
    }
  }

  // Load points price
  const marketPrices = await db
    .selectFrom(TABLE_NAMES.MARKET_PRICES)
    .select(["key", "value"])
    .execute();

  const priceMap = new Map();
  for (const row of marketPrices) {
    priceMap.set(row.key, Number(row.value));
  }
  const pointPrice = priceMap.get("points") ?? 31000;

  console.log("🚀 Fetching live financial logs from Torn API...");

  const allLogIds = [
    1103, 1104, 1112, 1113, 1221, 1226, 2020, 2030, 2040, 2060,
    2070, 2080, 2100, 2200, 2210, 2220, 2230, 2240, 2250, 2260,
    2270, 2280, 2290, 2295, 2390, 2510, 2520, 4900, 4905, 4910,
    5010, 5011, 5510, 5511, 5530, 5531, 5532, 5533, 5537, 5720,
    5725, 5730, 5920, 6012, 6201, 6204, 6221, 6222, 6285, 6736,
    6793, 6795, 8155, 8156, 9010, 9015, 9020, 9025
  ];

  const client = new TornApiClient();
  const apiLogs: any[] = [];

  // Chunk log IDs into batches of 10 to satisfy API limits
  const CHUNK_SIZE = 10;
  for (let i = 0; i < allLogIds.length; i += CHUNK_SIZE) {
    const chunk = allLogIds.slice(i, i + CHUNK_SIZE);
    const logFilterStr = chunk.join(",");
    console.log(`- Querying batch ${Math.floor(i / CHUNK_SIZE) + 1} of ${Math.ceil(allLogIds.length / CHUNK_SIZE)} (IDs: ${logFilterStr})...`);

    const response = (await client.get("/user/log" as any, {
      apiKey,
      queryParams: {
        limit: "100",
        log: logFilterStr,
      }
    }).catch(e => {
      console.error(`  ⚠️ API call failed for batch:`, e);
      return null;
    })) as any;

    if (response?.log && Array.isArray(response.log)) {
      apiLogs.push(...response.log);
    }
    // Respect rate limit
    await new Promise(r => setTimeout(r, 200));
  }

  console.log(`\n📦 Fetched ${apiLogs.length} live logs matching our financial categories.`);

  // Map to raw format for the parser
  const parserLogs = apiLogs.map((log: any) => ({
    log_id: String(log.id),
    timestamp: Number(log.timestamp),
    category: String(log.details?.category || log.category || ""),
    title: String(log.details?.title || log.title || ""),
    data: JSON.stringify(log.data || {}),
  }));

  // Parse using shared parser
  console.log("⚡ Parsing live logs with shared finance parser...");
  const parseResult = parseFinanceLedger(parserLogs, itemMap, itemNameMap, pointPrice);

  console.log(`\n🎉 STRESS TEST COMPLETED SUCCESSFULLY!`);
  console.log(`----------------------------------------`);
  console.log(`Total live logs processed:  ${parserLogs.length}`);
  console.log(`Logs matching transactions: ${parseResult.transactions.length}`);
  console.log(`Total Income:               $${parseResult.income.total.toLocaleString()}`);
  console.log(`Total Expense:              $${parseResult.expenses.total.toLocaleString()}`);
  
  if (parseResult.transactions.length > 0) {
    console.log(`\nSample parsed transactions:`);
    parseResult.transactions.slice(0, 10).forEach(t => {
      console.log(`- [${t.type.toUpperCase()}] [${t.category}] ${t.title}: $${t.amount.toLocaleString()} (${t.description})`);
    });
  } else {
    console.log("\n(No live matching financial logs were returned for this API key's recent history)");
  }

  process.exit(0);
}

main().catch(e => {
  console.error("❌ Stress test failed with runtime error:", e);
  process.exit(1);
});
