import { FastifyInstance } from "fastify";
import {
  sentinelDbEngine,
  Logger,
  PersonalLogs,
  SystemState,
  tornApi,
  getWorkerApiKey,
} from "@sentinel/shared";
import { sendToWorker } from "../lib/ipc.js";

const logger = new Logger("api_logs_routes");

export async function logsRoutes(fastify: FastifyInstance) {
  /**
   * GET /api/logs/stats
   * Returns current total logs, oldest date, latest synced date, and backfill status.
   */
  fastify.get("/stats", async (_request, reply) => {
    try {
      const db = sentinelDbEngine.db;

      // 1. Total logs count
      const totalStmt = db.prepare(`SELECT COUNT(*) as count FROM nosql_personal_logs`);
      const totalRow = totalStmt.get() as { count: number };
      const totalLogs = totalRow?.count || 0;

      // 2. Oldest timestamp
      const oldestStmt = db.prepare(`
        SELECT MIN(CAST(json_extract(data, '$.timestamp') AS INTEGER)) as oldest
        FROM nosql_personal_logs
      `);
      const oldestRow = oldestStmt.get() as { oldest: number | null };
      const oldestTimestamp = oldestRow?.oldest || null;

      // 3. Latest timestamp
      const latestStmt = db.prepare(`
        SELECT MAX(CAST(json_extract(data, '$.timestamp') AS INTEGER)) as latest
        FROM nosql_personal_logs
      `);
      const latestRow = latestStmt.get() as { latest: number | null };

      const lastCheckedState = SystemState.findOne("log_manager_last_checked") as any;
      const latestSyncedTimestamp = Math.max(
        latestRow?.latest || 0,
        lastCheckedState?.timestamp || 0
      );

      // 4. Backfill progress
      const backfillState = SystemState.findOne("log_manager_backfill_progress") as any;

      // 5. Category Breakdown
      const categoryStmt = db.prepare(`
        SELECT json_extract(data, '$.category') as category, COUNT(*) as count
        FROM nosql_personal_logs
        GROUP BY category
      `);
      const categoryRows = categoryStmt.all() as { category: string; count: number }[];
      const categoriesBreakdown: Record<string, number> = {};
      for (const row of categoryRows) {
        if (row.category) {
          categoriesBreakdown[row.category] = row.count;
        }
      }

      return reply.send({
        totalLogs,
        oldestTimestamp,
        latestSyncedTimestamp,
        backfillStatus: backfillState || { status: "completed", logs_parsed: totalLogs },
        categoriesBreakdown,
      });
    } catch (err: any) {
      logger.error("Failed to retrieve log stats:", err);
      return reply.status(500).send({ error: "Internal Server Error" });
    }
  });

  /**
   * GET /api/logs/daily-history
   * Returns daily log count breakdown over time for historical graph.
   */
  fastify.get("/daily-history", async (request, reply) => {
    try {
      const { days = 30 } = request.query as { days?: number };
      const daysCount = Math.min(Math.max(Number(days) || 30, 7), 365);

      const db = sentinelDbEngine.db;
      const sinceTimestamp = Math.floor(Date.now() / 1000) - daysCount * 86400;

      const stmt = db.prepare(`
        SELECT 
          date(CAST(json_extract(data, '$.timestamp') AS INTEGER), 'unixepoch') as date,
          COUNT(*) as count,
          SUM(CASE WHEN json_extract(data, '$.category') = 'Crime' THEN 1 ELSE 0 END) as crime_count,
          SUM(CASE WHEN json_extract(data, '$.category') = 'Gym' THEN 1 ELSE 0 END) as gym_count,
          SUM(CASE WHEN json_extract(data, '$.category') = 'Stocks' THEN 1 ELSE 0 END) as stock_count,
          SUM(CASE WHEN json_extract(data, '$.category') = 'Travel' THEN 1 ELSE 0 END) as travel_count,
          SUM(CASE WHEN json_extract(data, '$.category') = 'Item' THEN 1 ELSE 0 END) as item_count,
          SUM(CASE WHEN json_extract(data, '$.category') = 'Money' THEN 1 ELSE 0 END) as money_count
        FROM nosql_personal_logs
        WHERE CAST(json_extract(data, '$.timestamp') AS INTEGER) >= ?
        GROUP BY date
        ORDER BY date ASC
      `);

      const rows = stmt.all(sinceTimestamp) as Array<{
        date: string;
        count: number;
        crime_count: number;
        gym_count: number;
        stock_count: number;
        travel_count: number;
        item_count: number;
        money_count: number;
      }>;

      return reply.send({
        days: daysCount,
        history: rows.map((r) => ({
          date: r.date,
          count: r.count,
          crime: r.crime_count,
          gym: r.gym_count,
          stocks: r.stock_count,
          travel: r.travel_count,
          item: r.item_count,
          money: r.money_count,
        })),
      });
    } catch (err: any) {
      logger.error("Failed to retrieve daily log history:", err);
      return reply.status(500).send({ error: "Internal Server Error" });
    }
  });

  /**
   * GET /api/logs/list
   * Paginated list of raw logs with search and category filtering.
   */
  fastify.get("/list", async (request, reply) => {
    try {
      const {
        page = 1,
        pageSize = 20,
        category,
        date,
        search,
      } = request.query as {
        page?: number;
        pageSize?: number;
        category?: string;
        date?: string;
        search?: string;
      };

      const limit = Math.min(Math.max(Number(pageSize) || 20, 1), 100);
      const offset = (Math.max(Number(page) || 1, 1) - 1) * limit;

      const db = sentinelDbEngine.db;
      const conditions: string[] = [];
      const params: any[] = [];

      if (category && category !== "all") {
        conditions.push(`json_extract(data, '$.category') = ?`);
        params.push(category);
      }

      if (date) {
        conditions.push(
          `date(CAST(json_extract(data, '$.timestamp') AS INTEGER), 'unixepoch') = ?`
        );
        params.push(date);
      }

      if (search && search.trim()) {
        conditions.push(
          `(json_extract(data, '$.title') LIKE ? OR id LIKE ? OR data LIKE ?)`
        );
        const searchPattern = `%${search.trim()}%`;
        params.push(searchPattern, searchPattern, searchPattern);
      }

      const whereClause =
        conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

      const countStmt = db.prepare(
        `SELECT COUNT(*) as count FROM nosql_personal_logs ${whereClause}`
      );
      const totalRow = countStmt.get(...params) as { count: number };
      const total = totalRow?.count || 0;

      const queryStmt = db.prepare(`
        SELECT data FROM nosql_personal_logs
        ${whereClause}
        ORDER BY CAST(json_extract(data, '$.timestamp') AS INTEGER) DESC
        LIMIT ? OFFSET ?
      `);

      const rows = queryStmt.all(...params, limit, offset) as { data: string }[];
      const logs = rows.map((r) => JSON.parse(r.data));

      return reply.send({
        logs,
        total,
        page: Number(page) || 1,
        pageSize: limit,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      });
    } catch (err: any) {
      logger.error("Failed to list logs:", err);
      return reply.status(500).send({ error: "Internal Server Error" });
    }
  });

  /**
   * POST /api/logs/resync
   * Re-fetches logs from Torn API for a specific day or date range and dispatches to ledgers.
   */
  fastify.post("/resync", async (request, reply) => {
    try {
      const { date, fromTimestamp, toTimestamp } = request.body as {
        date?: string;
        fromTimestamp?: number;
        toTimestamp?: number;
      };

      let startTs: number;
      let endTs: number;

      if (date) {
        // Parse date e.g. "2026-07-20"
        const [year, month, day] = date.split("-").map(Number);
        if (!year || !month || !day) {
          return reply.status(400).send({ error: "Invalid date format. Expected YYYY-MM-DD" });
        }
        const startDate = new Date(Date.UTC(year, month - 1, day, 0, 0, 0));
        const endDate = new Date(Date.UTC(year, month - 1, day, 23, 59, 59));
        startTs = Math.floor(startDate.getTime() / 1000);
        endTs = Math.floor(endDate.getTime() / 1000);
      } else if (fromTimestamp && toTimestamp) {
        startTs = Number(fromTimestamp);
        endTs = Number(toTimestamp);
      } else {
        return reply.status(400).send({ error: "Provide either date (YYYY-MM-DD) or fromTimestamp/toTimestamp" });
      }

      logger.info(`Re-syncing logs for range ${startTs} to ${endTs} (date: ${date || "custom"})`);

      // 1. Call worker via UDS IPC
      try {
        await sendToWorker(
          JSON.stringify({
            action: "resync_logs",
            data: { from: startTs, to: endTs },
          }) + "\n"
        );
      } catch (ipcErr: any) {
        logger.warn("Worker UDS socket offline, falling back to direct API fetch & dispatch:", ipcErr?.message);
        
        // Fallback: Direct API fetch if worker is not listening
        const apiKey = getWorkerApiKey("personal");
        if (!apiKey) throw new Error("No personal API key found");

        let currentFrom = startTs;
        let fetchedCount = 0;
        let newCount = 0;

        while (currentFrom < endTs) {
          const res = await tornApi.get("/user/log", {
            apiKey,
            queryParams: { from: currentFrom, to: endTs, limit: 100 },
          });

          if (!res.log || res.log.length === 0) break;

          fetchedCount += res.log.length;
          let maxTimestamp = currentFrom;

          for (const log of res.log) {
            maxTimestamp = Math.max(maxTimestamp, log.timestamp);
            const idStr = String(log.id);
            const existing = PersonalLogs.findOne(idStr);
            if (existing) {
              PersonalLogs.update({ ...log, id: idStr });
            } else {
              PersonalLogs.insertOne({ ...log, id: idStr });
              newCount++;
            }
          }

          if (maxTimestamp <= currentFrom) break;
          currentFrom = maxTimestamp + 1;
        }

        return reply.send({
          success: true,
          date: date || null,
          fromTimestamp: startTs,
          toTimestamp: endTs,
          fetchedCount,
          newCount,
        });
      }

      return reply.send({
        success: true,
        date: date || null,
        fromTimestamp: startTs,
        toTimestamp: endTs,
        message: "Log re-sync job dispatched successfully",
      });
    } catch (err: any) {
      logger.error("Failed to resync logs:", err);
      return reply.status(500).send({ error: err.message || "Internal Server Error" });
    }
  });

  /**
   * POST /api/logs/trigger-sync
   * Trigger immediate log manager check
   */
  fastify.post("/trigger-sync", async (_request, reply) => {
    try {
      await sendToWorker(
        JSON.stringify({
          action: "force_run_worker",
          data: { worker_name: "log_manager" },
        }) + "\n"
      );
      return reply.send({ success: true, message: "Log sync worker triggered" });
    } catch (err: any) {
      logger.error("Failed to trigger log sync worker:", err);
      return reply.status(500).send({ error: "Failed to communicate with worker" });
    }
  });
}
