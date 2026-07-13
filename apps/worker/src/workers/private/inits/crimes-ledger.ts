import {
  CrimeLedger,
  getItemValue,
  getWorkerApiKey,
  Logger,
  SystemState,
  tornApi,
  TornCrimes,
  TornSchema,
  ApiKeyRotator,
} from "@sentinel/shared";

const logger = new Logger("crimes_ledger_init");

export async function runCrimesLedgerInit() {
  try {
    const finishSync = logger.time();
    CrimeLedger.deleteManyBy({});

    const crimes = TornCrimes.findAll();
    const apiKey = getWorkerApiKey("personal");

    const rotator = new ApiKeyRotator([apiKey as string]);

    await rotator.processSequential(crimes, async (crime, key) => {
      try {
        const res = (await tornApi.get("/user/{crimeId}/crimes", {
          apiKey: key,
          pathParams: { crimeId: crime.id.toString() },
        })) as TornSchema<"UserCrimesResponse">;

        const stats = res.crimes;
        const nerveSpent = stats.nerve_spent;
        let totalValue = stats.rewards.money;

        if (stats.rewards.items) {
          for (const item of stats.rewards.items) {
            totalValue += getItemValue(item.id.toString()) * item.amount;
          }
        }

        if (stats.uniques) {
          for (const unique of stats.uniques) {
            if (unique.rewards.money) {
              const m = unique.rewards.money;
              if (typeof m === "number") {
                totalValue += m;
              } else if (m.min && m.max) {
                totalValue += Math.floor((m.min + m.max) / 2);
              }
            }
            if (unique.rewards.items) {
              for (const item of unique.rewards.items) {
                totalValue += getItemValue(item.id.toString()) * item.amount;
              }
            }
          }
        }

        CrimeLedger.insertOne({
          id: crime.id.toString(),
          crime_name: crime.data.name,
          nerve_spent: nerveSpent,
          total_value: totalValue,
        });
      } catch (e) {
        logger.error(`Error fetching crime ${crime.id}:`, e);
      }
    }, 1000);

    SystemState.update({
      id: "crimes_ledger_init_state",
      init: true,
      timestamp: Math.floor(Date.now() / 1000),
    });

    finishSync();
  } catch (error) {
    logger.error("Failed to initialize Crimes Ledger:", error);
  }
}
