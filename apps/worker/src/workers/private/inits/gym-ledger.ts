import {
  Logger,
  SystemState,
  PersonalLogs,
  tornApi,
  getWorkerApiKey,
  TornGyms,
  GymLedger,
} from "@sentinel/shared";
import { parseGym } from "../parsers/gym.js";

const logger = new Logger("gym_ledger_init");

export async function runGymLedgerInit() {
  try {
    const finishSync = logger.time();
    GymLedger.deleteManyBy({});

    const apiKey = getWorkerApiKey("personal");
    if (apiKey) {
      try {
        const res = await tornApi.get("/torn", {
          apiKey,
          queryParams: { selections: "gyms" },
        });

        if (res.gyms) {
          TornGyms.deleteManyBy({});
          const gymsToInsert = [];
          for (const [id, gym] of Object.entries(res.gyms)) {
            const gymData = gym as {
              name: string;
              stage: number;
              cost: number;
              energy: number;
              strength: number;
              speed: number;
              defense: number;
              dexterity: number;
              note: string;
            };

            gymsToInsert.push({
              id,
              name: gymData.name,
              stage: gymData.stage,
              cost: gymData.cost,
              energy: gymData.energy,
              strength: gymData.strength,
              speed: gymData.speed,
              defense: gymData.defense,
              dexterity: gymData.dexterity,
              note: gymData.note,
            });
          }
          if (gymsToInsert.length > 0) {
            TornGyms.insertMany(gymsToInsert);
            logger.info(`Successfully synced ${gymsToInsert.length} gyms`);
          }
        }
      } catch (e) {
        logger.error("Failed to fetch static gyms data:", e);
      }
    }

    const allLogs = PersonalLogs.findAll();
    const gymLogs = allLogs.filter((log) =>
      [5300, 5301, 5302, 5303, 5310].includes(log.details.id),
    );

    let parsedCount = 0;
    for (const log of gymLogs) {
      parseGym(log);
      parsedCount++;
    }

    logger.info(`Successfully parsed ${parsedCount} historical gym logs`);

    SystemState.update({
      id: "gym_ledger_init_state",
      init: true,
      timestamp: Math.floor(Date.now() / 1000),
    });

    finishSync();
  } catch (error) {
    logger.error("Failed to initialize Gym Ledger:", error);
  }
}
