import { TornSchema } from "@sentinel/shared";
import {
  GymLedger,
  StatType,
  UserState,
  tornApi,
  getWorkerApiKey,
  Logger,
} from "@sentinel/shared";

let lastBattlestatsSync = 0;

async function syncBattlestats() {
  const logger = new Logger("gym_parser");
  const finishSync = logger.time();

  const apiKey = getWorkerApiKey("personal");
  if (!apiKey) return;

  try {
    const res = await tornApi.get("/user", {
      apiKey,
      queryParams: { selections: "battlestats" },
    });

    if (res.battlestats) {
      UserState.insertOne({
        id: "battlestats",
        strength: res.battlestats.strength.value,
        defense: res.battlestats.defense.value,
        speed: res.battlestats.speed.value,
        dexterity: res.battlestats.dexterity.value,
        timestamp: Math.floor(Date.now() / 1000),
      });
    }
    finishSync();
  } catch (error) {
    logger.error("Failed to sync battlestats", error);
  }
}

export function parseGym(log: TornSchema<"UserLog">) {
  if (![5300, 5301, 5302, 5303, 5310].includes(log.details.id)) return;
  if (!log.data) return;

  const data = log.data as Record<
    string,
    {
      trains: number;
      energy_used: number;
      strength_increased?: number;
      defense_increased?: number;
      speed_increased?: number;
      dexterity_increased?: number;
    }
  >;

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

  GymLedger.insertOne({
    id: String(log.id),
    timestamp: log.timestamp,
    stat_type: statType,
    trains: Number(data.trains || 0),
    energy_used: Number(data.energy_used || 0),
    stat_gained: statGained,
  });

  const now = Date.now();
  // Throttle to once per 60 seconds across rapid sequential logs
  if (now - lastBattlestatsSync > 60_000) {
    lastBattlestatsSync = now;
    syncBattlestats();
  }
}
