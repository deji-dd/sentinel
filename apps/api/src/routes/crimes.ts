import { FastifyPluginAsync } from "fastify";
import {
  CrimeLedger,
  UserConfig,
  SystemState,
  SystemStateDocument,
  sentinelDbEngine,
  getCrimeIdFromAction,
  calculateCrimeLogValue,
  TornCrimes,
  TornSchema,
} from "@sentinel/shared";

type InitState = Extract<
  SystemStateDocument,
  { timestamp: number; init: boolean }
>;

type CrimeData = {
  crime_action: string;
  nerve: number;
  money_gained?: number;
  items_gained?: Record<string, number>;
};

export const crimesRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get("/recent", async (request, reply) => {
    try {
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      const todayStartTimestamp = Math.floor(todayStart.getTime() / 1000);

      // If crimes was initialized mid-day, only return logs from that point onwards
      const initState = SystemState.findOne<InitState>(
        "crimes_ledger_init_state",
      );
      const initTimestamp = initState?.timestamp ?? 0;
      const startTimestamp = Math.max(todayStartTimestamp, initTimestamp);

      const logs = sentinelDbEngine.db
        .prepare(
          `SELECT data FROM nosql_personal_logs 
         WHERE json_extract(data, '$.details.category') = 'Crimes' 
         AND json_extract(data, '$.timestamp') >= ? 
         ORDER BY json_extract(data, '$.timestamp') DESC`,
        )
        .all(startTimestamp) as { data: string }[];

      const results = [];
      for (const row of logs) {
        const log = JSON.parse(row.data) as TornSchema<"UserLog">;
        const data = log.data as unknown as CrimeData;
        if (!data || !data.crime_action) continue;

        const crimeId = getCrimeIdFromAction(data.crime_action);
        if (crimeId === 0) continue;

        const crimeData = TornCrimes.findOne(crimeId.toString());
        if (!crimeData) continue;

        const totalValue = calculateCrimeLogValue(data);

        results.push({
          timestamp: log.timestamp,
          crime_name: crimeData.data.name,
          nerve_spent: data.nerve || 0,
          total_value: totalValue,
        });
      }

      return reply.send({ data: results });
    } catch (error: any) {
      fastify.log.error(error);
      return reply.status(500).send({ error: "Failed to fetch recent crimes" });
    }
  });

  fastify.get("/", async (request, reply) => {
    try {
      const config = UserConfig.findOne("global");

      if (!config?.crimes_module_enabled) {
        return reply.send({ data: [], module_disabled: true });
      }

      const initState = SystemState.findOne<InitState>(
        "crimes_ledger_init_state",
      );
      if (!initState || !initState.init) {
        return reply.send({ data: [], initializing: true });
      }

      const ledgers = CrimeLedger.findAll();

      const results = ledgers.map((item) => ({
        crime_name: item.crime_name,
        total_value: item.total_value,
        nerve_spent: item.nerve_spent,
        profit_per_nerve:
          item.nerve_spent > 0 ? item.total_value / item.nerve_spent : 0,
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
