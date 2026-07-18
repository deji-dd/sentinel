import { FastifyPluginAsync } from "fastify";
import { TravelDestinations, TornItems, UserConfig, TravelAreaMap, TravelUnmappedAreas, TravelLedger, PersonalLogs, UserState } from "@sentinel/shared";

export const travelRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get("/", async (request, reply) => {
    try {
      const config = UserConfig.findOne("global");
      // Use config?.travel_module_enabled when we add it, but for now we'll just check if it exists
      if (config && !(config as any).travel_module_enabled) {
        return reply.send({ module_disabled: true });
      }

      const destinations = TravelDestinations.findAll();

      const enhancedDestinations = destinations.map((dest) => {
        const stocks = dest.stocks.map((stock) => {
          const item = TornItems.findOne(String(stock.id));
          const market_price = item?.data.value.market_price || 0;

          let depletion_rate = 0;
          if (stock.history && stock.history.length >= 2) {
            const oldest = stock.history[0];
            const newest = stock.history[stock.history.length - 1];
            const deltaQty = oldest.quantity - newest.quantity;
            const deltaMins = (newest.timestamp - oldest.timestamp) / 60;

            if (deltaMins > 0 && deltaQty > 0) {
              depletion_rate = deltaQty / deltaMins;
            }
          }

          return {
            ...stock,
            type: item?.data.type || "Unknown",
            market_price,
            depletion_rate,
            data_points: stock.history?.length || 0,
          };
        });

        const mappedArea = TravelAreaMap.findAll().find(m => m.yataCode === dest.id);
        const tracked_profit = mappedArea ? (TravelLedger.findOne(mappedArea.id)?.tracked_profit || 0) : 0;

        return {
          ...dest,
          stocks,
          tracked_profit
        };
      });

      const liveState = UserState.findOne("live_state");

      return reply.send({
        module_disabled: false,
        data: enhancedDestinations,
        live_state: liveState || null
      });
    } catch (error: any) {
      fastify.log.error(error);
      return reply.status(500).send({ error: "Failed to fetch travel data" });
    }
  });

  fastify.get("/unmapped", async (request, reply) => {
    try {
      const unmapped = TravelUnmappedAreas.findAll();
      return reply.send(unmapped);
    } catch (error) {
      fastify.log.error(error);
      return reply.status(500).send({ error: "Failed to fetch unmapped areas" });
    }
  });

  fastify.post("/map", async (request, reply) => {
    try {
      const { areaId, yataCode } = request.body as { areaId: string; yataCode: string };
      
      TravelAreaMap.insertOne({ id: areaId, yataCode });
      TravelUnmappedAreas.deleteManyBy({ id: areaId });
      
      return reply.send({ success: true });
    } catch (error) {
      fastify.log.error(error);
      return reply.status(500).send({ error: "Failed to map area" });
    }
  });

  fastify.post("/reset-ledger", async (request, reply) => {
    try {
      // Clear ledger and any logs associated so they don't get reparsed if we re-sync
      TravelLedger.deleteManyBy({});
      return reply.send({ success: true });
    } catch (error) {
      fastify.log.error(error);
      return reply.status(500).send({ error: "Failed to reset ledger" });
    }
  });
};
