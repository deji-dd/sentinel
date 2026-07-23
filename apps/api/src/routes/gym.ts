import { FastifyPluginAsync } from "fastify";
import {
  GymLedger,
  UserState,
  TornGyms,
  TornItems,
  SystemState,
  SystemStateDocument,
  GymHistoryResponse,
  GymStateResponse,
  LogBackfillProgressPayload,
  BattlestatsDoc,
  GymUnlocksDoc,
  GymPerksDoc,
  BoosterPerksDoc,
  BarsDoc,
  UpdateGymBuildPreferencePayload,
} from "@sentinel/shared";

type InitState = Extract<
  SystemStateDocument,
  { timestamp: number; init: boolean; id: "gym_ledger_init_state" }
>;

export const gymRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get("/history", async (request, reply) => {
    try {
      const ledgers = GymLedger.findAll();
      ledgers.sort((a, b) => a.timestamp - b.timestamp);

      const initState = SystemState.findOne("gym_ledger_init_state") as { init: boolean; timestamp: number } | undefined;
      let effectiveInitTimestamp = initState?.timestamp;

      if (!initState || !initState.init) {
        const backfillState = SystemState.findOne("gym_ledger_backfill_progress") as { timestamp: number } | undefined;
        if (!effectiveInitTimestamp && backfillState) {
          effectiveInitTimestamp = backfillState.timestamp;
        }
        return reply.send({ data: ledgers, initializing: true, initTimestamp: effectiveInitTimestamp });
      }

      // Return the full historical series of gym logs.
      // Ordered by timestamp ascending
      ledgers.sort((a, b) => a.timestamp - b.timestamp);

      return reply.send({ data: ledgers, initTimestamp: effectiveInitTimestamp });
    } catch (error: any) {
      fastify.log.error(error);
      return reply.status(500).send({ error: "Failed to fetch gym ledger" });
    }
  });

  fastify.get("/state", async (request, reply) => {
    try {

      const initState = SystemState.findOne("gym_ledger_init_state") as { init: boolean; timestamp: number } | undefined;
      const isInitializing = !initState || !initState.init;
      const battlestats = UserState.findOne<BattlestatsDoc>("battlestats");
      const gym_unlocks = UserState.findOne<GymUnlocksDoc>("gym_unlocks");
      const gym_perks = UserState.findOne<GymPerksDoc>("gym_perks");
      const bars = UserState.findOne<BarsDoc>("bars");
      const gym_build_preference = UserState.findOne(
        "gym_build_preference",
      ) || {
        build_type: "balanced",
        high_stat: "defense",
      };
      const booster_perks = UserState.findOne<BoosterPerksDoc>("booster_perks");
      const gyms = TornGyms.findAll();
      const backfill_progress = SystemState.findOne("gym_ledger_backfill_progress");

      const allItems = TornItems.findAll().map((i) => i.data);
      const items = allItems.filter(
        (i) =>
          i.type === "Energy Drink" ||
          (i.name && i.name.includes("Feathery Hotel Coupon")) ||
          (i.name &&
            ["Skateboard", "Parachute", "Boxing Gloves", "Dumbbells"].includes(
              i.name,
            )),
      );

      const response: GymStateResponse = {
        data: {
          battlestats,
          gym_unlocks,
          gym_perks,
          booster_perks,
          bars,
          gym_build_preference: gym_build_preference as {
            build_type: "balanced" | "one_stat" | "two_stats";
            high_stat: "strength" | "defense" | "speed" | "dexterity";
          },
          gyms,
          items,
        },
        initializing: isInitializing,
      };
      return reply.send(response);
    } catch (error: any) {
      fastify.log.error(error);
      return reply.status(500).send({ error: "Failed to fetch gym state" });
    }
  });

  fastify.post("/build-preference", async (request, reply) => {
    try {
      const body = request.body as any;

      UserState.insertOne({
        id: "gym_build_preference",
        build_type: body.build_type || "balanced",
        high_stat: body.high_stat || "defense",
      });

      return reply.send({ success: true });
    } catch (error: any) {
      fastify.log.error(error);
      return reply
        .status(500)
        .send({ error: "Failed to update build preference" });
    }
  });
};
