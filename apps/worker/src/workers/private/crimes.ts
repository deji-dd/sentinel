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
  UserConfig,
  SystemStateDocument,
  getCrimeIdFromAction,
  calculateCrimeLogValue,
} from "@sentinel/shared";
import { workerEvents } from "../../lib/event-bus.js";

const logger = new Logger("crimes_module");

type InitState = Extract<
  SystemStateDocument,
  { timestamp: number; init: boolean }
>;
type CrimeData = {
  crime_action: string;
  nerve: number;
  money_gained?: number;
  items_gained?: Record<string, number>;
};

async function runCrimesLedgerInit() {
  try {
    logger.info("Initializing Crimes Ledger...");
    SystemState.update({
      id: "crimes_ledger_init_state",
      init: false,
      timestamp: Math.floor(Date.now() / 1000),
    });

    // Drop table prior to init as requested
    CrimeLedger.deleteManyBy({});

    const crimes = TornCrimes.findAll();
    const apiKey = getWorkerApiKey("personal");
    const rotator = new ApiKeyRotator([apiKey as string]);

    await rotator.processSequential(
      crimes,
      async (crime, key) => {
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
      },
      1000,
    );

    SystemState.update({
      id: "crimes_ledger_init_state",
      init: true,
      timestamp: Math.floor(Date.now() / 1000),
    });

    logger.info("Crimes Ledger initialized successfully.");
  } catch (error) {
    logger.error("Failed to initialize Crimes Ledger:", error);
  }
}

function parseCrimes(log: TornSchema<"UserLog">): void {
  try {
    const data = log.data as unknown as CrimeData;
    if (!data.crime_action) return;

    const crimeId = getCrimeIdFromAction(data.crime_action);
    if (crimeId === 0) return;

    const base = CrimeLedger.findOne(crimeId.toString());
    if (!base) return;

    const crimeData = TornCrimes.findOne(crimeId.toString());
    if (!crimeData) return;

    const oldNerve = base.nerve_spent;
    const oldTotalValue = base.total_value;

    const currentNerveSpent = data.nerve;
    let currentTotalValue = calculateCrimeLogValue(data);

    CrimeLedger.update({
      id: crimeId.toString(),
      crime_name: crimeData.data.name,
      nerve_spent: currentNerveSpent + oldNerve,
      total_value: currentTotalValue + oldTotalValue,
    });

    logger.info("Processed crime log.");
  } catch (error) {
    logger.error("Error parsing crime log:", error);
  }
}

export function startCrimesModule(): void {
  // Sync on boot
  checkSettingsAndInit();

  workerEvents.on("settings_updated", () => {
    checkSettingsAndInit();
  });

  workerEvents.on("new_log", (log) => {
    const config = UserConfig.findOne("global");
    if (config?.crimes_module_enabled) {
      const logCategory = log.details?.category;
      if (logCategory === "Crimes") {
        const initState = SystemState.findOne<InitState>(
          "crimes_ledger_init_state",
        );
        // Ensure we don't process logs that were already covered by the backfill
        if (initState?.timestamp && log.timestamp <= initState.timestamp) {
          return;
        }
        parseCrimes(log);
      }
    }
  });
}

function checkSettingsAndInit() {
  const config = UserConfig.findOne("global");
  if (config?.crimes_module_enabled) {
    const initState = SystemState.findOne<InitState>(
      "crimes_ledger_init_state",
    );
    if (!initState || !initState.init) {
      runCrimesLedgerInit();
    }
  } else {
    // If explicitly disabled, wipe the data and initialization state
    CrimeLedger.deleteManyBy({});
    SystemState.delete("crimes_ledger_init_state");
  }
}
