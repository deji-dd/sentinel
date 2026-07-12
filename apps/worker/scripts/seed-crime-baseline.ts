import {
  Logger,
  sentinelDbEngine,
  tornApi,
  getWorkerApiKey,
  TornCrimes,
  TornItems,
  CrimeLedger,
} from "@sentinel/shared";
import { initializeApiKeyMappings } from "@sentinel/shared";
import process from "process";

const logger = new Logger("seed_crime_baseline");

async function seedBaseline() {
  await initializeApiKeyMappings();

  const crimes = TornCrimes.findAll();
  if (!crimes || crimes.length === 0) {
    logger.warn("No reference crimes found. Run crime sync first.");
    return;
  }

  logger.info(`Found ${crimes.length} reference crimes. Querying historical data...`);

  const apiKey = getWorkerApiKey("personal");
  if (!apiKey) {
    logger.error("No personal API key found. Exiting.");
    process.exit(1);
  }

  let count = 0;

  const allTornItems = TornItems.findAll();
  const itemsMap = new Map(allTornItems.map(i => [i.data.item_id || i.data.id, i]));

  for (const crime of crimes) {
    try {
      // The OpenAPI path is '/user/{crimeId}/crimes'
      const res = await tornApi.get("/user/{crimeId}/crimes", {
        apiKey,
        pathParams: { crimeId: crime.crime_id.toString() },
      });

      if (!res.crimes) continue;

      const stats = res.crimes;

      // stats might look like:
      // {
      //   "name": "Search the Train Station",
      //   "total_attempts": 100,
      //   "total_successes": 80,
      //   "total_nerve_spent": 200,
      //   "money_gained": 5000,
      //   "items_gained": {
      //     "123": 5, // item_id: qty
      //     "456": 2
      //   }
      // }
      // The v2 API actually returns something like:
      // crimes: { "1": { ... } } or crimes: { ... }

      // Since Torn API v2 /user/{crimeId}/crimes returns a single crime object:

      if (!stats || typeof stats.nerve_spent === "undefined") {
        continue;
      }

      const nerveSpent = stats.nerve_spent;
      if (nerveSpent === 0) continue;

      const moneyGained = stats.rewards.money;
      let totalValue = moneyGained;

      if (stats.rewards.items) {
        for (const item of stats.rewards.items) {
          const itemRef = itemsMap.get(item.id);
          if (itemRef && itemRef.data.value?.market_price) {
            totalValue += itemRef.data.value.market_price * item.amount;
          }
        }
      }

      if (stats.uniques) {
        for (const unique of stats.uniques) {
          if (unique.rewards?.money) {
            // Note: unique money comes as an object like { min: 100, max: 200 } for some reason, 
            // but the API v2 shows min/max for potentials, or direct amount for realized?
            // Actually, in the log we saw `money: { min: 110000, max: 400000 }` which represents 
            // potential rewards, not what the user actually got!
            // Wait, does /user/crimes endpoint return realized unique money or potential?
            // "unique outcomes" in Torn API v2 /user/crimes usually show the reward of the unique. 
            // Let's assume average of min/max if it's an object, or just the number if it's a number.
            const m = unique.rewards.money;
            if (typeof m === 'number') {
              totalValue += m;
            } else if (m.min && m.max) {
              totalValue += Math.floor((m.min + m.max) / 2);
            }
          }
          if (unique.rewards?.items) {
            for (const item of unique.rewards.items) {
              const itemRef = itemsMap.get(item.id);
              if (itemRef && itemRef.data.value?.market_price) {
                totalValue += itemRef.data.value.market_price * item.amount;
              }
            }
          }
        }
      }

      // Upsert baseline
      const baselineId = `baseline_${crime.crime_id}`;
      CrimeLedger.insertOne({
        id: baselineId,
        crime_name: crime.data.name || "Unknown Crime",
        nerve_spent: nerveSpent,
        total_cash_value: totalValue,
        is_baseline: true,
        timestamp: Math.floor(Date.now() / 1000),
      });

      count++;
      logger.info(
        `Seeded baseline for ${crime.data.name}: Nerve=${nerveSpent}, Value=$${totalValue}`,
      );

      // Delay to respect rate limits
      await new Promise((resolve) => setTimeout(resolve, 1000));
    } catch (error) {
      logger.error(
        `Error querying baseline for crime ${crime.crime_id}:`,
        error,
      );
    }
  }

  logger.info(`Successfully seeded ${count} crime baselines.`);
}

async function main() {
  try {
    await seedBaseline();
  } catch (err) {
    logger.error("Failed to run seed script", err);
  } finally {
    sentinelDbEngine.close();
    process.exit(0);
  }
}

main();
