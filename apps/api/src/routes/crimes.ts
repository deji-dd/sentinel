import { FastifyPluginAsync } from "fastify";
import { CrimeLedger } from "@sentinel/shared";

export const crimesRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get("/roi", async (request, reply) => {
    try {
      const ledgers = CrimeLedger.findAll();

      const results = ledgers.map((item) => ({
        crime_name: item.crime_name,
        total_value: item.total_value,
        nerve_spent: item.nerve_spent,
        profit_per_nerve: item.nerve_spent > 0 ? item.total_value / item.nerve_spent : 0,
      }));

      // Sort by highest profit per nerve
      results.sort((a, b) => b.profit_per_nerve - a.profit_per_nerve);

      return reply.send({ data: results });
    } catch (error: any) {
      fastify.log.error(error);
      return reply.status(500).send({ error: "Failed to fetch crime ROI" });
    }
  });
};
