import { FastifyPluginAsync } from "fastify";
import { GymLedger, UserState, TornGyms, TornItems, SystemState, UserConfig, SystemStateDocument } from "@sentinel/shared";

type InitState = Extract<
  SystemStateDocument,
  { timestamp: number; init: boolean; id: "gym_ledger_init_state" }
>;

export const gymRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get("/history", async (request, reply) => {
    try {
      const config = UserConfig.findOne("global");
      if (!config?.gym_module_enabled) {
        return reply.send({ data: [], module_disabled: true });
      }

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
      const config = UserConfig.findOne("global");
      if (!config?.gym_module_enabled) {
        return reply.send({ data: null, module_disabled: true });
      }

      const initState = SystemState.findOne("gym_ledger_init_state") as { init: boolean; timestamp: number } | undefined;
      const isInitializing = !initState || !initState.init;
      const battlestats = UserState.findOne("battlestats");
      const gym_unlocks = UserState.findOne("gym_unlocks");
      const gym_perks = UserState.findOne("gym_perks");
      const bars = UserState.findOne("bars");
      const gym_build_preference = UserState.findOne(
        "gym_build_preference",
      ) || {
        build_type: "balanced",
        high_stat: "defense",
      };
      const booster_perks = UserState.findOne("booster_perks");
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

      return reply.send({
        data: {
          battlestats,
          gym_unlocks,
          gym_perks,
          booster_perks,
          bars,
          gym_build_preference,
          gyms,
          items,
          backfill_progress,
        },
        initializing: isInitializing,
      });
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
