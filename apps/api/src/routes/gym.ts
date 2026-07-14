import { FastifyPluginAsync } from "fastify";
import { GymLedger, UserState, TornGyms, TornItems } from "@sentinel/shared";

export const gymRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get("/history", async (request, reply) => {
    try {
      const ledgers = GymLedger.findAll();

      // Return the full historical series of gym logs.
      // Ordered by timestamp ascending
      ledgers.sort((a, b) => a.timestamp - b.timestamp);

      return reply.send({ data: ledgers });
    } catch (error: any) {
      fastify.log.error(error);
      return reply.status(500).send({ error: "Failed to fetch gym ledger" });
    }
  });

  fastify.get("/state", async (request, reply) => {
    try {
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
        },
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
