import {
  Logger,
  SystemState,
  tornApi,
  getWorkerApiKey,
  TornGyms,
  GymLedger,
  GymBaseline,
  type TornSchema,
  type StatType,
  UserState,
  UserConfig,
  ApiKeyRotator,
  type SystemStateDocument,
} from "@sentinel/shared";
import { workerEvents } from "../../lib/event-bus.js";

const logger = new Logger("gym_worker");

export const STAT_GAIN_LOG_IDS = [
  // Gym Trains
  5300, 5301, 5302, 5303,
  // Stat Enhancers
  2120, 2130, 2140, 2150,
  // Books
  2052, 2053, 2054, 2055,
  // Company Specials
  6526, 6527, 6528, 6529,
  // Job Specials
  6400, 6401, 6402, 6403,
];

let lastBattlestatsSync = 0;

async function syncBattlestats(apiKey: string) {
  try {
    const res = await tornApi.get("/user", {
      apiKey,
      queryParams: { selections: "battlestats" },
    });

    if (res.battlestats) {
      UserState.update({
        id: "battlestats",
        strength: res.battlestats.strength.value,
        defense: res.battlestats.defense.value,
        speed: res.battlestats.speed.value,
        dexterity: res.battlestats.dexterity.value,
        timestamp: Math.floor(Date.now() / 1000),
      });
    }
  } catch (error) {
    logger.error("Failed to sync battlestats", error);
  }
}

export function parseStatGainLog(log: TornSchema<"UserLog">) {
  if (!STAT_GAIN_LOG_IDS.includes(log.details.id)) return;
  if (!log.data) return;

  const data = log.data as Record<string, string | number | undefined>;

  let statType: StatType | null = null;
  let statGained = 0;

  if (data.strength_increased) {
    statType = "strength";
    statGained = Number(data.strength_increased);
  } else if (data.defense_increased) {
    statType = "defense";
    statGained = Number(data.defense_increased);
  } else if (data.speed_increased) {
    statType = "speed";
    statGained = Number(data.speed_increased);
  } else if (data.dexterity_increased) {
    statType = "dexterity";
    statGained = Number(data.dexterity_increased);
  }

  if (!statType) return;

  let source: "gym" | "item" | "book" | "company" | "job" = "gym";
  const cat = log.details.category;
  const title = log.details.title.toLowerCase();

  if (cat === "Gym" || title.includes("gym train")) source = "gym";
  else if (cat === "Item use" || title.includes("item use")) source = "item";
  else if (cat === "Books" || title.includes("book")) source = "book";
  else if (cat === "Company" || title.includes("company special")) source = "company";
  else if (cat === "Job" || title.includes("job special")) source = "job";

  GymLedger.insertOne({
    id: String(log.id),
    timestamp: log.timestamp,
    stat_type: statType,
    source,
    trains: data.trains ? Number(data.trains) : undefined,
    energy_used: data.energy_used ? Number(data.energy_used) : undefined,
    stat_gained: statGained,
  });

  const now = Date.now();
  if (now - lastBattlestatsSync > 60_000) {
    lastBattlestatsSync = now;
    const apiKey = getWorkerApiKey("personal");
    if (apiKey) {
      syncBattlestats(apiKey);
    }
  }
}

export async function runGymLedgerInit() {
  try {
    const finishSync = logger.time();

    const apiKey = getWorkerApiKey("personal");
    if (!apiKey) throw new Error("No personal API key found");

    const existingProgress = SystemState.findOne("gym_ledger_backfill_progress") as Extract<SystemStateDocument, { id: "gym_ledger_backfill_progress" }> | undefined;
    const isResuming = existingProgress && existingProgress.status === "in_progress" && existingProgress.active_chunks && existingProgress.active_chunks.length > 0;

    if (!isResuming) {
      // 1. Clear Ledgers
      GymLedger.deleteManyBy({});
      GymBaseline.deleteManyBy({});

      // 2. Fetch Static Gym Data
      try {
        const res = await tornApi.get("/torn", {
          apiKey,
          queryParams: { selections: "gyms" },
        });

        if (res.gyms) {
          TornGyms.deleteManyBy({});
          const gymsToInsert = [];
          for (const [id, gym] of Object.entries(res.gyms)) {
            // @ts-ignore
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
          if (gymsToInsert.length > 0) TornGyms.insertMany(gymsToInsert);
        }
      } catch (e) {
        logger.error("Failed to fetch static gyms data:", e);
      }

      // 3. Fetch PersonalStats Baseline
      const res = await tornApi.get<TornSchema<"UserPersonalStatsFull">>(
        "/user/personalstats",
        {
          apiKey,
          queryParams: { cat: "battle_stats" },
        },
      );

      if (!res.personalstats) throw new Error("Failed to fetch personalstats");

      GymBaseline.insertOne({
        id: "baseline",
        timestamp: Math.floor(Date.now() / 1000),
        strength: res.personalstats.battle_stats.strength || 0,
        defense: res.personalstats.battle_stats.defense || 0,
        speed: res.personalstats.battle_stats.speed || 0,
        dexterity: res.personalstats.battle_stats.dexterity || 0,
      });

      // Reset backfill progress
      SystemState.update({
        id: "gym_ledger_backfill_progress",
        timestamp: Math.floor(Date.now() / 1000),
        status: "in_progress",
        logs_parsed: 0,
        oldest_timestamp_reached: null,
        active_chunks: null,
      });
    }

    // 4. Background History Backfill
    runBackgroundLogBackfill(apiKey, isResuming ? existingProgress : undefined).catch((e) => {
      logger.error("Background backfill failed", e);
      SystemState.update({
        id: "gym_ledger_backfill_progress",
        timestamp: Math.floor(Date.now() / 1000),
        status: "error",
        error: e.message,
      });
    });

    finishSync();
  } catch (error) {
    logger.error("Failed to initialize Gym Ledger:", error);
  }
}

async function runBackgroundLogBackfill(apiKey: string, resumeData?: Extract<SystemStateDocument, { id: "gym_ledger_backfill_progress" }>) {
  if (resumeData) {
    logger.info(`Resuming background historical backfill. Already parsed: ${resumeData.logs_parsed}`);
  } else {
    logger.info("Starting background historical backfill for Gym Ledger");
  }

  let totalParsed = resumeData?.logs_parsed || 0;
  let overallOldestTimestamp: number | undefined = resumeData?.oldest_timestamp_reached ?? undefined;

  let activeChunks: { logSelection: string; currentTo: number | undefined }[] = [];
  
  if (resumeData?.active_chunks) {
    activeChunks = resumeData.active_chunks;
  } else {
    // Torn API limits 'log' parameter to 10 items max
    for (let i = 0; i < STAT_GAIN_LOG_IDS.length; i += 10) {
      activeChunks.push({
        logSelection: STAT_GAIN_LOG_IDS.slice(i, i + 10).join(","),
        currentTo: undefined,
      });
    }
  }

  const rotator = new ApiKeyRotator([apiKey]);

  while (activeChunks.length > 0) {
    const nextChunks: typeof activeChunks = [];

    await rotator.processSequential(
      activeChunks,
      async (chunk, key) => {
        try {
          const queryParams: Record<string, string | number> = {
            selections: "log",
            log: chunk.logSelection,
          };

          if (chunk.currentTo) {
            queryParams.to = chunk.currentTo;
          }

          const res = await tornApi.get<{
            log?: Record<string, TornSchema<"UserLog">>;
          }>("/user", {
            apiKey: key,
            queryParams,
          });

          if (!res.log || Object.keys(res.log).length === 0) {
            return; // Done with this chunk
          }

          const logs = Object.values(res.log);

          if (logs.length === 0) {
            return; // Done
          }

          let oldestInBatch = Date.now() / 1000;
          for (const log of logs) {
            parseStatGainLog(log);
            totalParsed++;
            if (log.timestamp < oldestInBatch) {
              oldestInBatch = log.timestamp;
            }
          }

          if (
            !overallOldestTimestamp ||
            oldestInBatch < overallOldestTimestamp
          ) {
            overallOldestTimestamp = oldestInBatch;
          }

          // Push to nextChunks to fetch the next page in the next cycle
          nextChunks.push({
            logSelection: chunk.logSelection,
            currentTo: oldestInBatch,
          });
        } catch (error) {
          logger.error(
            `Error during background backfill at to=${chunk.currentTo}`,
            error,
          );
          throw error;
        }
      },
      1000,
    );

    activeChunks = nextChunks;

    // Update progress in DB for the UI to read and for resumption
    SystemState.update({
      id: "gym_ledger_backfill_progress",
      timestamp: Math.floor(Date.now() / 1000),
      status: "in_progress",
      logs_parsed: totalParsed,
      oldest_timestamp_reached: overallOldestTimestamp,
      active_chunks: activeChunks,
    });

    logger.info(`Backfill progress: Parsed ${totalParsed} logs, reached timestamp ${overallOldestTimestamp}, ${activeChunks.length} active chunks remaining.`);
  }

  SystemState.update({
    id: "gym_ledger_backfill_progress",
    timestamp: Math.floor(Date.now() / 1000),
    status: "completed",
    logs_parsed: totalParsed,
    oldest_timestamp_reached: overallOldestTimestamp,
    active_chunks: [],
  });

  // Finish completely
  SystemState.update({
    id: "gym_ledger_init_state",
    init: true,
    timestamp: Math.floor(Date.now() / 1000),
  });

  logger.info(
    `Completed historical backfill. Parsed ${totalParsed} stat gain logs.`,
  );
}

export function startGymModule(): void {
  checkSettingsAndInit();

  workerEvents.on("settings_updated", () => {
    checkSettingsAndInit();
  });
}

function checkSettingsAndInit() {
  const config = UserConfig.findOne("global");
  if (config?.gym_module_enabled) {
    const initState = SystemState.findOne("gym_ledger_init_state") as
      | { init: boolean }
      | undefined;
    if (!initState || !initState.init) {
      runGymLedgerInit().catch((e) => logger.error("Gym Init Failed", e));
    }
  } else {
    // If explicitly disabled, wipe the data and initialization state
    GymLedger.deleteManyBy({});
    GymBaseline.deleteManyBy({});
    SystemState.delete("gym_ledger_init_state");
    SystemState.delete("gym_ledger_backfill_progress");
  }
}
