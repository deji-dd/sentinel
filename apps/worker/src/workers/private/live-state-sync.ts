import {
  getWorkerApiKey,
  Logger,
  TornSchema,
  UserState,
  tornApi,
} from "@sentinel/shared";
import { startEventDrivenRunner } from "../../lib/scheduler.js";

const WORKER_NAME = "live_state_sync";
const CADENCE_SEC = 60 * 5; // 5 minutes

export async function runLiveStateSync() {
  const logger = new Logger(WORKER_NAME);

  try {
    const finishSync = logger.time();
    const apiKey = getWorkerApiKey("personal");
    if (!apiKey) throw new Error("No personal API key found");

    const res = await tornApi.get<
      TornSchema<"UserBarsResponse"> & TornSchema<"UserCooldownsResponse"> & TornSchema<"UserMoneyResponse">
    >("/user", {
      apiKey,
      queryParams: { selections: "bars,cooldowns,money" },
    });

    if (!res.bars || !res.cooldowns || !res.money) {
      throw new Error("Missing bars, cooldowns, or money in response");
    }

    UserState.update({
      id: "live_state",
      bars: {
        energy: {
          current: res.bars.energy.current || 0,
          maximum: res.bars.energy.maximum || 0,
          increment: res.bars.energy.increment || 0,
          interval: res.bars.energy.interval || 0,
          full_time: res.bars.energy.full_time || 0,
        },
        nerve: {
          current: res.bars.nerve.current || 0,
          maximum: res.bars.nerve.maximum || 0,
          increment: res.bars.nerve.increment || 0,
          interval: res.bars.nerve.interval || 0,
          full_time: res.bars.nerve.full_time || 0,
        },
        happy: {
          current: res.bars.happy.current || 0,
          maximum: res.bars.happy.maximum || 0,
          increment: res.bars.happy.increment || 0,
          interval: res.bars.happy.interval || 0,
          full_time: res.bars.happy.full_time || 0,
        },
        life: {
          current: res.bars.life.current || 0,
          maximum: res.bars.life.maximum || 0,
          increment: res.bars.life.increment || 0,
          interval: res.bars.life.interval || 0,
          full_time: res.bars.life.full_time || 0,
        },
      },
      cooldowns: {
        drug: res.cooldowns.drug,
        medical: res.cooldowns.medical,
        booster: res.cooldowns.booster,
      },
      money: {
        wallet: res.money.wallet || 0,
      },
      timestamp: Math.floor(Date.now() / 1000),
    });

    logger.info(
      `Live state synced. E:${res.bars.energy.current} N:${res.bars.nerve.current}`,
    );
    finishSync();
  } catch (error) {
    logger.error("Live state sync failed", error);
  }
}

export function startLiveStateSync() {
  startEventDrivenRunner({
    worker: WORKER_NAME,
    handler: runLiveStateSync,
    defaultCadenceSeconds: CADENCE_SEC,
  });
}
