import { Logger } from "@sentinel/utils";
import { db } from "@sentinel/database";
import { type TornSchema } from "@sentinel/torn-api";
import { tornApiManager, getPersonalKey } from "@sentinel/torn-api-manager";
import { workerEvents } from "../../lib/event-bus.js";
import { startEventDrivenRunner } from "../../lib/scheduler.js";
import type { WorkerStartOptions } from "../registry.js";

const WORKER_NAME = "personal_state_sync";
const logger = new Logger(WORKER_NAME);

// Cadence: Run every 5 minutes (300 seconds)
const CADENCE_SEC = 300;

export type UserBars = {
  energy: {
    current: number;
    maximum: number;
    increment: number;
    interval: number;
    fullTime: number;
  };
  nerve: {
    current: number;
    maximum: number;
    increment: number;
    interval: number;
    fullTime: number;
  };
  happy: {
    current: number;
    maximum: number;
    increment: number;
    interval: number;
    fullTime: number;
  };
  life: {
    current: number;
    maximum: number;
    increment: number;
    interval: number;
    fullTime: number;
  };
};

export type UserCooldowns = {
  drug: number;
  medical: number;
  booster: number;
};

export type UserBattleStats = {
  strength: number;
  defense: number;
  speed: number;
  dexterity: number;
};

/**
 * Fetches user bars, cooldowns, money, and battlestats every 5 minutes
 * and consolidates them into a single atomic PostgreSQL `live_state` record.
 */
export async function runLiveStateSync(): Promise<void> {
  const finishSync = logger.time();

  try {
    const keyEntry = await getPersonalKey();
    if (!keyEntry) {
      logger.warn("No personal API key found for live state sync. Skipping.");
      return;
    }

    const res = (await tornApiManager.get("/user", {
      apiKey: keyEntry.apiKey,
      userId: keyEntry.userId,
      queryParams: {
        selections: ["bars", "cooldowns", "money", "battlestats"] as any,
      },
    })) as TornSchema<"UserBarsResponse"> &
      TornSchema<"UserCooldownsResponse"> &
      TornSchema<"UserMoneyResponse"> &
      TornSchema<"UserBattleStatsResponse">;

    if (!res.bars || !res.cooldowns || !res.money) {
      throw new Error("Missing bars, cooldowns, or money in Torn API response");
    }

    const bars: UserBars = {
      energy: {
        current: Number(res.bars.energy?.current ?? 0),
        maximum: Number(res.bars.energy?.maximum ?? 0),
        increment: Number(res.bars.energy?.increment ?? 0),
        interval: Number(res.bars.energy?.interval ?? 0),
        fullTime: Number(res.bars.energy?.full_time ?? 0),
      },
      nerve: {
        current: Number(res.bars.nerve?.current ?? 0),
        maximum: Number(res.bars.nerve?.maximum ?? 0),
        increment: Number(res.bars.nerve?.increment ?? 0),
        interval: Number(res.bars.nerve?.interval ?? 0),
        fullTime: Number(res.bars.nerve?.full_time ?? 0),
      },
      happy: {
        current: Number(res.bars.happy?.current ?? 0),
        maximum: Number(res.bars.happy?.maximum ?? 0),
        increment: Number(res.bars.happy?.increment ?? 0),
        interval: Number(res.bars.happy?.interval ?? 0),
        fullTime: Number(res.bars.happy?.full_time ?? 0),
      },
      life: {
        current: Number(res.bars.life?.current ?? 0),
        maximum: Number(res.bars.life?.maximum ?? 0),
        increment: Number(res.bars.life?.increment ?? 0),
        interval: Number(res.bars.life?.interval ?? 0),
        fullTime: Number(res.bars.life?.full_time ?? 0),
      },
    };

    const cooldowns: UserCooldowns = {
      drug: Number(res.cooldowns.drug ?? 0),
      medical: Number(res.cooldowns.medical ?? 0),
      booster: Number(res.cooldowns.booster ?? 0),
    };

    const battlestats: UserBattleStats = {
      strength: Number(
        res.battlestats?.strength?.value ?? res.battlestats?.strength ?? 0,
      ),
      defense: Number(
        res.battlestats?.defense?.value ?? res.battlestats?.defense ?? 0,
      ),
      speed: Number(
        res.battlestats?.speed?.value ?? res.battlestats?.speed ?? 0,
      ),
      dexterity: Number(
        res.battlestats?.dexterity?.value ?? res.battlestats?.dexterity ?? 0,
      ),
    };

    // Commit consolidated live_state into PostgreSQL SystemState in 1 single write
    await db.systemState.upsert({
      where: { id: "live_state" },
      update: {
        data: {
          bars,
          cooldowns,
          money: res.money,
          battlestats,
        },
        updatedAt: new Date(),
      },
      create: {
        id: "live_state",
        data: {
          bars,
          cooldowns,
          money: res.money,
          battlestats,
        },
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });

    workerEvents.emit("live_state_updated");

    finishSync();
  } catch (error) {
    logger.error("Failed to execute live state sync:", error);
  }
}

/**
 * Initializes and starts the live state sync background worker (5-minute cadence).
 */
export function startLiveStateSync(options?: WorkerStartOptions): void {
  startEventDrivenRunner({
    worker: WORKER_NAME,
    defaultCadenceSeconds: CADENCE_SEC,
    initialDelayMs: options?.initialDelayMs,
    handler: runLiveStateSync,
  });
}
