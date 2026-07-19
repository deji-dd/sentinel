import { FastifyInstance } from "fastify";
import { sentinelDbEngine, Logger, getItemValue, UserConfig, SystemState } from "@sentinel/shared";
import { sendToWorker } from "../lib/ipc.js";

const logger = new Logger("api_ledger_routes");

export default async function ledgerRoutes(fastify: FastifyInstance) {
  fastify.get("/api/ledger/wealth-state", async (request, reply) => {
    try {
      const db = sentinelDbEngine.db;

      const config = UserConfig.findOne("global");
      if (config && !(config as any).wealth_module_enabled) {
        return reply.send({ module_disabled: true });
      }

      const initState = SystemState.findOne("wealth_init") as any;
      if (initState?.data?.status === "in_progress") {
        return reply.send({ module_disabled: false, initializing: true });
      }

      // 1. Get Action Queue
      const queueStmt = db.prepare(`
        SELECT data FROM nosql_ledger_events 
        WHERE status = 'pending_review'
      `);
      const queueRows = queueStmt.all() as { data: string }[];
      const actionQueue = queueRows.map((r) => {
        const doc = JSON.parse(r.data);
        return {
          id: doc.id,
          type: doc.transaction_name,
          description: `Action required for ${doc.type} at ${new Date(doc.timestamp).toLocaleString()}`,
          timestamp: doc.timestamp,
        };
      });

      // 2. Query Recent Transactions
      const startOfDayUTC = new Date();
      startOfDayUTC.setUTCHours(0, 0, 0, 0);
      const startTimestamp = Math.floor(startOfDayUTC.getTime() / 1000);

      const txRows = db
        .prepare(
          `
        SELECT data FROM nosql_ledger_events
        WHERE timestamp >= ?
        ORDER BY timestamp DESC
      `
        )
        .all(startTimestamp) as { data: string }[];

      const recentTransactions = txRows.map((row) => {
        const doc = JSON.parse(row.data);
        const logTitle = doc.raw_log?.details?.title;
        const description = logTitle ? `${logTitle}` : doc.transaction_name;

        const marketValueImpact = (doc.assets_affected || []).reduce(
          (acc: number, cur: any) => {
            const val = getItemValue(cur.asset_id.toString());
            // If it's a known item, use its dynamic market value.
            // If it's an equity/property/company (val === 0), fall back to the recorded cost_basis_impact.
            const impact = val > 0 
              ? (cur.quantity_change * val) 
              : (cur.cost_basis_impact || 0);
            return acc + impact;
          },
          0
        );
        const hasAssets = doc.assets_affected && doc.assets_affected.length > 0;
        const netImpact = (doc.cash_flow || 0) + marketValueImpact + (!hasAssets && (doc.cash_flow || 0) === 0 ? (doc.realized_pnl || 0) : 0);

        return {
          id: doc.id || doc.log_id || Math.random().toString(),
          timestamp: doc.timestamp,
          category: doc.type,
          description: description,
          amount: netImpact,
          cashFlow: doc.cash_flow || 0,
        };
      });

      // 3. Liquid Cash & Historical Yields
      const historyRows = db
        .prepare(
          `
        SELECT data FROM nosql_cash_history 
        ORDER BY timestamp DESC 
        LIMIT 31
      `,
        )
        .all() as { data: string }[];

      const snapshots = historyRows.map((r) => JSON.parse(r.data));

      let liquidCash = 0;
      let dailyYield = 0;
      const historical: {
        timestamp: number;
        netWorth: number;
        dailyYield: number;
        liquidCash: number;
      }[] = [];

      if (snapshots.length > 0) {
        liquidCash = snapshots[0].liquid_cash;

        if (snapshots.length > 1) {
          dailyYield = snapshots[0].liquid_cash - snapshots[1].liquid_cash;
        }

        for (let i = 0; i < Math.min(snapshots.length, 30); i++) {
          const current = snapshots[i];
          const previous = snapshots[i + 1]; // Might be undefined

          const yieldForDay = previous
            ? current.liquid_cash - previous.liquid_cash
            : 0;

          historical.push({
            timestamp: current.timestamp * 1000,
            netWorth: current.liquid_cash,
            dailyYield: yieldForDay,
            liquidCash: current.liquid_cash,
          });
        }

        // Reverse to get chronological order for the chart
        historical.reverse();
      }

      return reply.send({
        liquidCash,
        dailyYield,
        recentTransactions,
        historical,
        actionQueue,
      });
    } catch (err) {
      logger.error("Failed to retrieve wealth state:", err);
      return reply.status(500).send({ error: "Internal Server Error" });
    }
  });

  fastify.post("/api/ledger/resolve-action", async (request, reply) => {
    try {
      const { transaction_id, manual_cash_value } = request.body as any;

      if (!transaction_id || manual_cash_value === undefined) {
        return reply.status(400).send({ error: "Missing required fields" });
      }

      const db = sentinelDbEngine.db;

      // Atomic SQLite transaction
      const updateTx = db.transaction(() => {
        const stmt = db.prepare(
          `SELECT data FROM nosql_ledger_events WHERE id = ?`,
        );
        const row = stmt.get(transaction_id) as { data: string } | undefined;

        if (!row) throw new Error("Transaction not found");

        const doc = JSON.parse(row.data);

        // Remove pending review status and inject cash value
        delete doc.status;
        doc.cash_flow = Number(manual_cash_value);

        const updateStmt = db.prepare(
          `UPDATE nosql_ledger_events SET data = ? WHERE id = ?`,
        );
        updateStmt.run(JSON.stringify(doc), transaction_id);
      });

      updateTx();

      // Trigger background recalculation via IPC
      sendToWorker(
        JSON.stringify({
          action: "RECALCULATE_MAC",
          payload: { transactionId: transaction_id },
        }) + "\n"
      ).catch((err) => {
        logger.error("Failed to send RECALCULATE_MAC to worker:", err);
      });

      return reply.send({ success: true });
    } catch (err: any) {
      logger.error("Failed to resolve action:", err);
      if (err.message === "Transaction not found") {
        return reply.status(404).send({ error: err.message });
      }
      return reply.status(500).send({ error: "Internal Server Error" });
    }
  });

  fastify.post("/api/ledger/reinit", async (request, reply) => {
    try {
      const { ledger } = request.body as { ledger: "gym" | "items" | "crimes" | "war" };
      
      const { SystemState } = await import("@sentinel/shared");
      
      if (ledger === "gym") {
        SystemState.delete("gym_ledger_init_state");
      } else if (ledger === "items") {
        SystemState.delete("items_ledger_init_state");
      } else if (ledger === "crimes") {
        SystemState.delete("crimes_ledger_init_state");
      } else if (ledger === "war") {
        SystemState.delete("war_ledger_init_state");
      } else {
        return reply.status(400).send({ error: "Invalid ledger type" });
      }

      sendToWorker(
        JSON.stringify({
          action: "reinit_ledger",
          data: { ledger },
        }) + "\n"
      ).catch((err) => {
        logger.error("Failed to send REINIT_LEDGER to worker:", err);
      });

      logger.info(`Requested re-initialization of ${ledger} ledger`);
      return reply.send({ success: true });
    } catch (err: any) {
      logger.error("Failed to re-initialize ledger:", err);
      return reply.status(500).send({ error: "Internal Server Error" });
    }
  });
}
