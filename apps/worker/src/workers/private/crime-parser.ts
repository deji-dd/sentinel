import { Logger } from "@sentinel/shared";
import { workerEvents } from "../../lib/event-bus.js";
import {
  type TornSchema,
  CrimeLedger,
  sentinelDbEngine,
} from "@sentinel/shared";

const logger = new Logger("crime_parser");

export function startCrimeParser(): void {
  // Listen to new personal logs from the log manager
  workerEvents.on("NEW_PERSONAL_LOG", (log: TornSchema<"UserLog">) => {
    try {
      // Category 136 = Crimes
      if (log.details.category !== "136") return;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data = log.data as any;
      if (!data) return;

      const crimeName = data.crime_action || "Unknown Crime";
      const nerveSpent = parseInt(data.nerve || "0", 10);
      let totalCashValue = 0;

      // Extract rewards and failures from log data
      // For crimes, the result is usually in data.result or we parse cash/items
      // If it's a fail/critical fail, we assume 0 value
      if (data.money && parseInt(data.money, 10) > 0) {
        totalCashValue += parseInt(data.money, 10);
      }

      // Sometimes crimes give items: 'item', 'item2', etc. or it's array?
      // Based on typical Torn log formats, items are stored in data.item etc.
      // We'll parse data.item, data.item2, etc. if they exist
      for (let i = 1; i <= 5; i++) {
        const itemKey = i === 1 ? "item" : `item${i}`;
        const qtyKey = i === 1 ? "item_qty" : `item${i}_qty`;

        if (data[itemKey]) {
          const itemId = parseInt(data[itemKey], 10);
          const qty = parseInt(data[qtyKey] || "1", 10);

          if (!isNaN(itemId)) {
            // TornItems are stored as { id: uuid, data: { id: item_id } }
            // Since Collection.findOne uses the UUID, we must query by the inner data.id
            const rawRow = sentinelDbEngine.db
              .prepare(
                "SELECT data FROM nosql_torn_items WHERE json_extract(data, '$.data.id') = ?",
              )
              .get(itemId) as { data: string };

            if (rawRow && rawRow.data) {
              const itemRef = JSON.parse(rawRow.data);
              if (itemRef && itemRef.data.value) {
                totalCashValue += (itemRef.data.value.market_price || 0) * qty;
              }
            }
          }
        }
      }

      // Is it a failure? We can check if result is fail or critical
      const resultLower = (data.result || "").toLowerCase();
      if (
        resultLower === "fail" ||
        resultLower === "critical" ||
        resultLower.includes("fail") ||
        resultLower.includes("jail") ||
        resultLower.includes("hospital")
      ) {
        // Failing means $0 generated, but nerve was spent
        totalCashValue = 0;
      }

      // Insert incremental record
      CrimeLedger.insertOne({
        id: log.id, // Using log id to prevent duplicate inserts if processed twice
        crime_name: crimeName,
        nerve_spent: nerveSpent,
        total_cash_value: totalCashValue,
        is_baseline: false,
        timestamp: log.timestamp,
      });

      logger.debug(
        `Parsed Crime: ${crimeName} | Nerve: ${nerveSpent} | Value: $${totalCashValue}`,
      );
    } catch (error) {
      logger.error("Error parsing crime log:", error);
    }
  });
}
