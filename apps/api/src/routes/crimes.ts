import { FastifyPluginAsync } from "fastify";
import { CrimeLedger } from "@sentinel/shared";

export const crimesRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get("/roi", async (request, reply) => {
    try {
      const ledgers = CrimeLedger.findAll();

      // Aggregate data by crime_name
      const aggregated = ledgers.reduce((acc, curr) => {
        if (!acc[curr.crime_name]) {
          acc[curr.crime_name] = {
            crime_name: curr.crime_name,
            total_value: 0,
            nerve_spent: 0,
          };
        }
        acc[curr.crime_name].total_value += curr.total_cash_value;
        acc[curr.crime_name].nerve_spent += curr.nerve_spent;
        return acc;
      }, {} as Record<string, { crime_name: string; total_value: number; nerve_spent: number }>);

      const results = Object.values(aggregated).map((item) => ({
        ...item,
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
