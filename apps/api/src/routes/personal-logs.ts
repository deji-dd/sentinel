import { FastifyInstance } from "fastify";
import { db } from "@sentinel/database";
import { Logger } from "@sentinel/utils";
import { sendIpcRequest } from "../lib/ipc-client.js";

const logger = new Logger("PersonalLogsRoutes");

interface AnalyticsQuery {
  days?: string;
}

interface PersonalLogsQuery {
  date?: string;
  category?: string;
  search?: string;
  page?: string;
  limit?: string;
}

interface ResyncBody {
  from?: string | number;
  to?: string | number;
}

/**
 * Formats a Date object to YYYY-MM-DD string in UTC.
 */
function formatDateUTC(d: Date): string {
  const year = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Registers Fastify API routes for personal logs analytics, viewing, and worker re-sync.
 */
export async function personalLogRoutes(fastify: FastifyInstance): Promise<void> {
  // GET /personal-logs/analytics
  fastify.get("/personal-logs/analytics", async (request, reply) => {
    try {
      const query = request.query as AnalyticsQuery;
      const daysCount = Math.min(Math.max(parseInt(query.days || "30", 10), 1), 365);

      const now = new Date();
      const startDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - daysCount + 1));

      const logs = await db.personalLog.findMany({
        where: {
          timestamp: {
            gte: startDate,
          },
        },
        select: {
          id: true,
          category: true,
          timestamp: true,
        },
        orderBy: {
          timestamp: "asc",
        },
      });

      // Build daily map for all dates in range
      const dailyMap = new Map<string, { count: number; categories: Record<string, number> }>();
      const current = new Date(startDate.getTime());
      while (current <= now) {
        const dateKey = formatDateUTC(current);
        dailyMap.set(dateKey, { count: 0, categories: {} });
        current.setUTCDate(current.getUTCDate() + 1);
      }

      for (const log of logs) {
        const dateKey = formatDateUTC(log.timestamp);
        let item = dailyMap.get(dateKey);
        if (!item) {
          item = { count: 0, categories: {} };
          dailyMap.set(dateKey, item);
        }
        item.count++;
        const cat = log.category || "uncategorized";
        item.categories[cat] = (item.categories[cat] || 0) + 1;
      }

      const summary = Array.from(dailyMap.entries()).map(([date, data]) => ({
        date,
        count: data.count,
        categories: data.categories,
      }));

      // Overall database stats
      const [totalLogsCount, oldestLog, newestLog, backfillRecord] = await Promise.all([
        db.personalLog.count(),
        db.personalLog.findFirst({ orderBy: { timestamp: "asc" }, select: { timestamp: true } }),
        db.personalLog.findFirst({ orderBy: { timestamp: "desc" }, select: { timestamp: true } }),
        db.systemState.findUnique({ where: { id: "log_manager_backfill_progress" } }),
      ]);

      const backfillData = backfillRecord?.data as any;

      return reply.send({
        status: "ok",
        timeframeDays: daysCount,
        summary,
        stats: {
          totalLogs: totalLogsCount,
          oldestLogDate: oldestLog ? formatDateUTC(oldestLog.timestamp) : null,
          newestLogDate: newestLog ? formatDateUTC(newestLog.timestamp) : null,
          backfillStatus: backfillData?.status || "completed",
          logsParsedInBackfill: backfillData?.logsParsed || 0,
        },
      });
    } catch (err) {
      logger.error("Failed to fetch personal logs analytics:", err);
      return reply.status(500).send({
        error: "InternalServerError",
        message: "Failed to load personal logs analytics data",
      });
    }
  });

  // GET /personal-logs
  fastify.get("/personal-logs", async (request, reply) => {
    try {
      const query = request.query as PersonalLogsQuery;
      const todayStr = formatDateUTC(new Date());
      const dateStr = query.date && /^\d{4}-\d{2}-\d{2}$/.test(query.date) ? query.date : todayStr;

      const page = Math.max(parseInt(query.page || "1", 10), 1);
      const limit = Math.min(Math.max(parseInt(query.limit || "50", 10), 1), 200);
      const skip = (page - 1) * limit;

      const startOfDay = new Date(`${dateStr}T00:00:00.000Z`);
      const endOfDay = new Date(`${dateStr}T23:59:59.999Z`);

      const whereClause: any = {
        timestamp: {
          gte: startOfDay,
          lte: endOfDay,
        },
      };

      if (query.category && query.category !== "all") {
        whereClause.category = { equals: query.category, mode: "insensitive" };
      }

      if (query.search && query.search.trim() !== "") {
        const term = query.search.trim();
        whereClause.OR = [
          { title: { contains: term, mode: "insensitive" } },
          { id: { contains: term } },
        ];
      }

      const [logs, total, availableCategories] = await Promise.all([
        db.personalLog.findMany({
          where: whereClause,
          orderBy: { timestamp: "desc" },
          skip,
          take: limit,
        }),
        db.personalLog.count({ where: whereClause }),
        db.personalLog.findMany({
          distinct: ["category"],
          select: { category: true },
          where: { category: { not: null } },
        }),
      ]);

      const categories = availableCategories
        .map((c) => c.category)
        .filter((c): c is string => Boolean(c));

      return reply.send({
        date: dateStr,
        logs,
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit) || 1,
        categories,
      });
    } catch (err) {
      logger.error("Failed to fetch personal logs by date:", err);
      return reply.status(500).send({
        error: "InternalServerError",
        message: "Failed to load personal logs",
      });
    }
  });

  // POST /personal-logs/resync
  fastify.post("/personal-logs/resync", async (request, reply) => {
    try {
      const body = (request.body as ResyncBody) || {};

      let fromTs: number;
      let toTs: number;

      if (typeof body.from === "number") {
        fromTs = body.from;
      } else if (typeof body.from === "string" && !isNaN(Number(body.from))) {
        fromTs = Number(body.from);
      } else if (typeof body.from === "string") {
        fromTs = Math.floor(new Date(body.from).getTime() / 1000);
      } else {
        // Default to past 7 days
        fromTs = Math.floor(Date.now() / 1000) - 7 * 86400;
      }

      if (typeof body.to === "number") {
        toTs = body.to;
      } else if (typeof body.to === "string" && !isNaN(Number(body.to))) {
        toTs = Number(body.to);
      } else if (typeof body.to === "string") {
        toTs = Math.floor(new Date(body.to).getTime() / 1000);
      } else {
        // Default to now
        toTs = Math.floor(Date.now() / 1000);
      }

      if (isNaN(fromTs) || isNaN(toTs) || fromTs >= toTs) {
        return reply.status(400).send({
          error: "BadRequest",
          message: "Invalid time range specified. 'from' timestamp must be less than 'to' timestamp.",
        });
      }

      logger.info(`Requesting personal log re-sync over IPC for range: ${fromTs} to ${toTs}`);

      const ipcResult = await sendIpcRequest<{
        success: boolean;
        fetched?: number;
        newLogs?: number;
        error?: string;
      }>("resync_personal_logs", { from: fromTs, to: toTs }, 60000, "worker");

      if (!ipcResult.success) {
        return reply.status(500).send({
          error: "WorkerError",
          message: ipcResult.error || "Background worker failed to execute log re-sync",
        });
      }

      return reply.send({
        status: "ok",
        message: `Successfully re-synced personal logs. Fetched ${ipcResult.fetched || 0} items, ${ipcResult.newLogs || 0} updated.`,
        fetched: ipcResult.fetched || 0,
        newLogs: ipcResult.newLogs || 0,
        timeframe: { from: fromTs, to: toTs },
      });
    } catch (err) {
      logger.error("Failed to execute personal log re-sync:", err);
      return reply.status(500).send({
        error: "InternalServerError",
        message: err instanceof Error ? err.message : "Failed to execute worker re-sync",
      });
    }
  });
}
