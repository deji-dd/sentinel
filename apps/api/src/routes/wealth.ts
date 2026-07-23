import { FastifyInstance } from "fastify";
import {
  UserConfig,
  Logger,
  LedgerEvents,
  CashHistory,
  Assets,
  CompanyDailyProfits,
  SystemState,
  WealthStateResponse,
} from "@sentinel/shared";
import { sendToWorker } from "../lib/ipc.js";

const logger = new Logger("api_wealth");

export async function wealthRoutes(fastify: FastifyInstance) {
  fastify.get("/", async (request, reply) => {
    try {
      const config = UserConfig.findOne("global");
      if (config && !(config as any).wealth_module_enabled) {
        return reply.send({ module_disabled: true });
      }

      const initState = SystemState.findOne("wealth_init") as any;
      if (initState?.data?.status === "in_progress") {
        return reply.send({ module_disabled: false, initializing: true });
      }

      // Fetch Liquid Cash History
      const cashHistory = CashHistory.findAll().sort(
        (a, b) => a.timestamp - b.timestamp,
      );

      // Fetch Recent Transactions
      const recentTransactions = LedgerEvents.findAll()
        .sort((a, b) => b.timestamp - a.timestamp)
        .slice(0, 100); // Last 100

      // Fetch current Liquid Cash
      const currentLiquidCash =
        cashHistory.length > 0
          ? cashHistory[cashHistory.length - 1].liquid_cash
          : 0;

      // Calculate daily yield
      // For simplicity, find the cash difference from yesterday to today, or just sum the past 24h PNL
      const now = Date.now() / 1000;
      const oneDayAgo = now - 86400;

      let dailyYield = 0;
      const recentEvents = LedgerEvents.findAll().filter(
        (e) => e.timestamp >= oneDayAgo,
      );
      for (const ev of recentEvents) {
        dailyYield += (ev.realized_pnl || 0) + (ev.cash_flow || 0);
      }

      // Format historical data for WealthChart
      const historical = cashHistory.map((ch) => ({
        timestamp: ch.timestamp * 1000,
        liquidCash: ch.liquid_cash,
        dailyYield: 0, // This could be populated by comparing adjacent entries
      }));

      // A simple approximation for the chart's daily yield
      for (let i = 1; i < historical.length; i++) {
        historical[i].dailyYield =
          historical[i].liquidCash - historical[i - 1].liquidCash;
      }

      return reply.send({
        module_disabled: false,
        data: {
          liquidCash: currentLiquidCash,
          dailyYield,
          historical,
          recentTransactions,
          actionQueue: [], // For ActionQueueSheet if needed
        },
      });
    } catch (err) {
      logger.error("Error fetching wealth data:", err);
      return reply.status(500).send({ error: "Internal server error" });
    }
  });

  fastify.post("/heal", async (request, reply) => {
    try {
      try {
        await sendToWorker(
          JSON.stringify({
            action: "wealth_heal",
          }) + "\n",
        );
      } catch (e) {
        logger.warn("Worker IPC not connected, heal might fail.");
      }
      return reply.send({
        success: true,
        message: "Ledger healing dispatched to worker.",
      });
    } catch (err) {
      logger.error("Error dispatching heal to worker:", err);
      return reply.status(500).send({ error: "Failed to dispatch heal." });
    }
  });

  fastify.post("/init", async (request, reply) => {
    try {
      try {
        await sendToWorker(
          JSON.stringify({
            action: "wealth_init",
          }) + "\n",
        );
      } catch (e) {
        logger.warn("Worker IPC not connected, init might fail.");
      }
      return reply.send({
        success: true,
        message: "Initialization dispatched to worker.",
      });
    } catch (error: any) {
      logger.error(error);
      return reply
        .status(500)
        .send({ error: "Failed to initialize wealth ledger" });
    }
  });

  fastify.post("/reset-ledger", async (request, reply) => {
    try {
      LedgerEvents.deleteManyBy({});
      CashHistory.deleteManyBy({});
      Assets.deleteManyBy({});
      CompanyDailyProfits.deleteManyBy({});
      return reply.send({ success: true });
    } catch (error) {
      fastify.log.error(error);
      return reply.status(500).send({ error: "Failed to reset wealth ledger" });
    }
  });
}
