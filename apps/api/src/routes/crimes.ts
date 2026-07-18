import { FastifyPluginAsync } from "fastify";
import {
  CrimeLedger,
  CrimeLogs,
  CrimeActionMappings,
  UserConfig,
  SystemState,
  SystemStateDocument,
  sentinelDbEngine,
  getCrimeIdFromAction,
  calculateCrimeLogValue,
  TornCrimes,
  TornSchema,
  CrimeLogDocument,
  CrimeActionMappingDocument,
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

      // Fetch from the new CrimeLogs collection
      const logs = CrimeLogs.find({});
      const filtered = logs.filter(
        (l: CrimeLogDocument) => l.timestamp >= startTimestamp && l.crime_id !== 0,
      );
      // Sort descending
      filtered.sort((a: CrimeLogDocument, b: CrimeLogDocument) => b.timestamp - a.timestamp);

      const results = [];
      for (const log of filtered) {
        const crimeData = TornCrimes.findOne(log.crime_id.toString());
        if (!crimeData) continue;

        results.push({
          timestamp: log.timestamp,
          crime_name: crimeData.data.name,
          nerve_spent: log.nerve,
          total_value: log.value,
        });
      }

      return reply.send({ data: results });
    } catch (error: any) {
      fastify.log.error(error);
      return reply.status(500).send({ error: "Failed to fetch recent crimes" });
    }
  });

  fastify.get("/unmapped", async (request, reply) => {
    try {
      // Get all unmapped actions (where crime_id is 0)
      const unmapped = CrimeActionMappings.find({ crime_id: 0 });
      return reply.send({ data: unmapped.map((u: CrimeActionMappingDocument) => u.action) });
    } catch (error: any) {
      fastify.log.error(error);
      return reply.status(500).send({ error: "Failed to fetch unmapped actions" });
    }
  });

  fastify.post("/map", async (request, reply) => {
    try {
      const { action, crime_id } = request.body as { action: string; crime_id: number };
      if (!action || !crime_id) {
        return reply.status(400).send({ error: "action and crime_id are required" });
      }

      const lowerAction = action.toLowerCase().trim();

      // Update mapping
      CrimeActionMappings.update({
        id: lowerAction,
        action: lowerAction,
        crime_id,
      });

      // Update existing logs
      const unmappedLogs = CrimeLogs.find({ action: lowerAction, crime_id: 0 });
      for (const log of unmappedLogs) {
        CrimeLogs.update({
          ...log,
          crime_id,
        });
      }

      return reply.send({ success: true });
    } catch (error: any) {
      fastify.log.error(error);
      return reply.status(500).send({ error: "Failed to map action" });
    }
  });

  fastify.get("/all", async (request, reply) => {
    try {
      const crimes = TornCrimes.findAll();
      const mapped = crimes.map((c) => ({ id: parseInt(c.id), name: c.data.name }));
      mapped.sort((a, b) => a.id - b.id);
      return reply.send({ data: mapped });
    } catch (error: any) {
      fastify.log.error(error);
      return reply.status(500).send({ error: "Failed to fetch all crimes" });
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
      const logs = CrimeLogs.find({});

      // Aggregate baseline + logs
      const aggregated = new Map<number, { name: string; nerve: number; value: number }>();

      for (const base of ledgers) {
        const cid = parseInt(base.id);
        aggregated.set(cid, {
          name: base.crime_name,
          nerve: base.nerve_spent,
          value: base.total_value,
        });
      }

      for (const log of logs) {
        if (log.crime_id === 0) continue;
        const existing = aggregated.get(log.crime_id);
        if (existing) {
          existing.nerve += log.nerve;
          existing.value += log.value;
        } else {
          // If for some reason we have logs but no baseline (shouldn't happen)
          const crimeData = TornCrimes.findOne(log.crime_id.toString());
          if (crimeData) {
            aggregated.set(log.crime_id, {
              name: crimeData.data.name,
              nerve: log.nerve,
              value: log.value,
            });
          }
        }
      }

      const results = Array.from(aggregated.values()).map((item) => ({
        crime_name: item.name,
        total_value: item.value,
        nerve_spent: item.nerve,
        profit_per_nerve:
          item.nerve > 0 ? item.value / item.nerve : 0,
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
