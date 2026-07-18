import type { FastifyPluginAsync } from "fastify";
import {
  UserConfig,
  SystemState,
  SystemStateDocument,
  TornStocks,
  UserStocks,
  StockLedger,
  TornItems,
  TornProperties,
} from "@sentinel/shared";

export const stocksRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get("/history", async (request, reply) => {
    const config = UserConfig.findOne("global");
    if (!config?.stocks_module_enabled) {
      return reply.send({ module_disabled: true });
    }

    const initState = SystemState.findOne("stock_ledger_init_state") as
      | { init: boolean }
      | undefined;
    const progress = SystemState.findOne("stock_ledger_backfill_progress") as
      | Extract<SystemStateDocument, { id: "stock_ledger_backfill_progress" }>
      | undefined;

    const isInitializing = !initState || !initState.init;

    const data = StockLedger.findAll();
    data.sort((a, b) => b.timestamp - a.timestamp); // descending

    let initTimestamp: number | undefined;
    if (isInitializing && progress?.oldest_timestamp_reached) {
      initTimestamp = progress.oldest_timestamp_reached;
    }

    return reply.send({
      module_disabled: false,
      initializing: isInitializing,
      initTimestamp,
      data,
    });
  });

  fastify.get("/state", async (request, reply) => {
    const config = UserConfig.findOne("global");
    if (!config?.stocks_module_enabled) {
      return reply.send({ module_disabled: true });
    }

    const tornStocks = TornStocks.findAll();
    const allItems = TornItems.findAll();
    const allProperties = TornProperties.findAll();

    const enhancedTornStocks = tornStocks.map(s => {
      // deep clone so we don't mutate the db cache object
      const stock = JSON.parse(JSON.stringify(s));
      let apr = 0;
      let dividendValue = 0;
      let dividendType = stock.bonus.passive ? "Passive" : "Unknown";

      if (!stock.bonus.passive) {
        const desc = stock.bonus.description || "";
        const itemMatch = desc.match(/(\d+)x\s+(.+)/i);
        const cashMatch = desc.match(/\$([\d,]+)/);
        const pointMatch = desc.match(/(\d+)\s+points/i);
        const randomPropertyMatch = desc.match(/Random Property/i);

        if (cashMatch) {
          dividendType = "Cash";
          dividendValue = parseInt(cashMatch[1].replace(/,/g, ""), 10);
        } else if (pointMatch) {
          dividendType = "Points";
          const pointItem = allItems.find(i => i.data.name === "Point");
          const qty = parseInt(pointMatch[1], 10);
          dividendValue = qty * ((pointItem?.data as any)?.value?.market_price || 45000);
        } else if (randomPropertyMatch) {
          dividendType = "Property";
          const targetProps = allProperties.filter(p => Number(p.id) >= 1 && Number(p.id) <= 13);
          if (targetProps.length > 0) {
            const sum = targetProps.reduce((acc, p) => acc + p.data.cost, 0);
            dividendValue = sum / targetProps.length;
          } else {
            dividendValue = 60600000;
          }
        } else if (itemMatch) {
          const qty = parseInt(itemMatch[1], 10);
          const itemName = itemMatch[2].trim();
          const item = allItems.find(i => i.data.name.toLowerCase() === itemName.toLowerCase());
          
          if (item) {
            dividendType = "Item";
            dividendValue = qty * ((item.data as any).value?.market_price || 0);
          } else if (itemName.includes("energy") || itemName.includes("happiness") || itemName.includes("nerve")) {
            dividendType = "Resource";
          } else {
            dividendType = "Item";
          }
        }

        if (dividendValue > 0 && stock.bonus.frequency > 0 && stock.bonus.requirement > 0 && stock.market?.price > 0) {
          const annualValue = (365 / stock.bonus.frequency) * dividendValue;
          const blockCost = stock.bonus.requirement * stock.market.price;
          apr = (annualValue / blockCost) * 100;
        }
      }

      return {
        ...stock,
        calculated_apr: apr,
        calculated_dividend_value: dividendValue,
        dividend_type: dividendType,
      };
    });

    const userStocks = UserStocks.findAll();
    const progress = SystemState.findOne("stock_ledger_backfill_progress");

    return reply.send({
      module_disabled: false,
      data: {
        torn_stocks: enhancedTornStocks,
        user_stocks: userStocks,
        backfill_progress: progress,
      },
    });
  });
};
