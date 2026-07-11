import { FastifyInstance } from "fastify";
import { sentinelDbEngine, Logger } from "@sentinel/shared";
import { sendToWorker } from "../lib/ipc.js";

const logger = new Logger("api_ledger_routes");

export default async function ledgerRoutes(fastify: FastifyInstance) {
  fastify.get("/api/ledger/wealth-state", async (request, reply) => {
    try {
      const db = sentinelDbEngine.db;

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
      const txRows = db
        .prepare(
          `
        SELECT data FROM nosql_ledger_events
        ORDER BY timestamp DESC
        LIMIT 100
      `,
        )
        .all() as { data: string }[];

      const recentTransactions = txRows.map((row) => {
        const doc = JSON.parse(row.data);
        const logTitle = doc.raw_log?.details?.title;
        const description = logTitle ? `${logTitle}` : doc.transaction_name;

        const costBasisImpact = (doc.assets_affected || []).reduce(
          (acc: number, cur: any) => acc + (cur.cost_basis_impact || 0),
          0
        );
        const netImpact = (doc.cash_flow || 0) + costBasisImpact;

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
        ORDER BY CAST(json_extract(data, '$.timestamp') AS INTEGER) DESC 
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
        }),
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
}
