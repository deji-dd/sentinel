import { FastifyInstance } from "fastify";
import { db } from "@sentinel/database";
import {
  Logger,
  getCrimeIdFromAction,
  extractCrimeDataPayload,
  calculateCrimeLogValue,
} from "@sentinel/utils";

const logger = new Logger("CrimesRoutes");

interface CrimesAnalyticsQuery {
  days?: string;
}

interface CrimesLogsQuery {
  date?: string;
  crimeId?: string;
  search?: string;
  page?: string;
  limit?: string;
}

interface CategorizeBody {
  action: string;
  targetCrimeId: number;
}

/**
 * Dynamically fetches Crime Names map from PostgreSQL `torn_crimes` table.
 */
export async function getCrimeNamesMap(): Promise<Record<number, string>> {
  const map: Record<number, string> = { 0: "Uncategorized" };
  try {
    const tornCrimes = await db.tornCrime.findMany();
    for (const c of tornCrimes) {
      const idNum = parseInt(c.id, 10);
      if (!isNaN(idNum)) {
        map[idNum] = c.name || `Crime #${idNum}`;
      }
    }
  } catch (err) {
    logger.error("Failed to load crime names from db.tornCrime:", err);
  }
  return map;
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
 * Registers Fastify API routes for crimes analytics, categorizations, and logs.
 */
export async function crimesRoutes(fastify: FastifyInstance): Promise<void> {
  /**
   * GET /crimes/analytics
   * Aggregates overall analytics, daily averages, profit per nerve, top crimes, and distributions.
   */
  fastify.get("/crimes/analytics", async (request, reply) => {
    try {
      const query = request.query as CrimesAnalyticsQuery;
      const daysParam = query.days !== undefined ? parseInt(query.days, 10) : 0; // Default to 0 (All Time) if not specified
      const isAllTime = daysParam <= 0;
      const daysCount = isAllTime ? 0 : Math.min(Math.max(daysParam, 1), 365);
      const crimeNamesMap = await getCrimeNamesMap();

      const now = new Date();
      let whereClause: any = {};
      let startDate: Date;

      if (!isAllTime) {
        startDate = new Date(
          Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - daysCount + 1)
        );
        whereClause.timestamp = { gte: startDate };
      } else {
        const oldestLog = await db.crimeLog.findFirst({
          orderBy: { timestamp: "asc" },
          select: { timestamp: true },
        });
        startDate = oldestLog ? new Date(oldestLog.timestamp) : now;
      }

      // Fetch logs within date range
      const logs = await db.crimeLog.findMany({
        where: whereClause,
        select: {
          id: true,
          crimeId: true,
          action: true,
          nerve: true,
          value: true,
          timestamp: true,
        },
        orderBy: {
          timestamp: "asc",
        },
      });

      let totalProfit = 0;
      let totalNerve = 0;
      let uncategorizedCount = 0;

      // Grouping maps
      const crimeStatsMap = new Map<
        number,
        { crimeId: number; crimeName: string; totalProfit: number; totalNerve: number; count: number }
      >();

      const knownIds = Object.keys(crimeNamesMap).map(Number);
      for (const i of knownIds) {
        crimeStatsMap.set(i, {
          crimeId: i,
          crimeName: crimeNamesMap[i] || `Crime #${i}`,
          totalProfit: 0,
          totalNerve: 0,
          count: 0,
        });
      }

      const dailyMap = new Map<string, { count: number; profit: number; nerve: number }>();
      const current = new Date(startDate.getTime());
      while (current <= now) {
        const dateKey = formatDateUTC(current);
        dailyMap.set(dateKey, { count: 0, profit: 0, nerve: 0 });
        current.setUTCDate(current.getUTCDate() + 1);
      }

      for (const log of logs) {
        totalProfit += log.value;
        totalNerve += log.nerve;

        if (log.crimeId === 0) {
          uncategorizedCount++;
        }

        // Aggregate per crime category
        const cStat = crimeStatsMap.get(log.crimeId) || {
          crimeId: log.crimeId,
          crimeName: crimeNamesMap[log.crimeId] || `Crime #${log.crimeId}`,
          totalProfit: 0,
          totalNerve: 0,
          count: 0,
        };
        cStat.totalProfit += log.value;
        cStat.totalNerve += log.nerve;
        cStat.count += 1;
        crimeStatsMap.set(log.crimeId, cStat);

        // Aggregate daily
        const dateKey = formatDateUTC(log.timestamp);
        const dStat = dailyMap.get(dateKey) || { count: 0, profit: 0, nerve: 0 };
        dStat.count += 1;
        dStat.profit += log.value;
        dStat.nerve += log.nerve;
        dailyMap.set(dateKey, dStat);
      }

      const daysActual = Math.max(1, dailyMap.size);
      const avgDailyProfit = Math.round(totalProfit / daysActual);
      const profitPerNerve = totalNerve > 0 ? Number((totalProfit / totalNerve).toFixed(2)) : 0;

      const categoryList = Array.from(crimeStatsMap.values()).map((c) => {
        const pPerNerve = c.totalNerve > 0 ? Number((c.totalProfit / c.totalNerve).toFixed(2)) : 0;
        const profitPercentage = totalProfit !== 0 ? Number(((c.totalProfit / Math.max(1, Math.abs(totalProfit))) * 100).toFixed(1)) : 0;
        return {
          ...c,
          profitPerNerve: pPerNerve,
          profitPercentage,
        };
      });

      // Find top crimes
      const activeCrimes = categoryList.filter((c) => c.count > 0 && c.crimeId !== 0);

      const mostProfitableRaw = [...activeCrimes].sort((a, b) => b.totalProfit - a.totalProfit)[0] || null;
      const mostProfitablePerNerve = [...activeCrimes].sort((a, b) => b.profitPerNerve - a.profitPerNerve)[0] || null;

      // Distribution array sorted by profit descending
      const distributionByProfit = [...categoryList].sort((a, b) => b.totalProfit - a.totalProfit);
      const distributionByEfficiency = [...categoryList].sort((a, b) => b.profitPerNerve - a.profitPerNerve);

      const dailyTimeline = Array.from(dailyMap.entries()).map(([date, data]) => ({
        date,
        count: data.count,
        profit: data.profit,
        nerve: data.nerve,
        profitPerNerve: data.nerve > 0 ? Number((data.profit / data.nerve).toFixed(2)) : 0,
      }));

      return reply.send({
        success: true,
        days: daysCount,
        overall: {
          totalProfit,
          totalNerve,
          totalLogs: logs.length,
          avgDailyProfit,
          profitPerNerve,
          uncategorizedCount,
        },
        mostProfitableRaw,
        mostProfitablePerNerve,
        distributionByProfit,
        distributionByEfficiency,
        dailyTimeline,
      });
    } catch (error) {
      logger.error("Error in GET /crimes/analytics:", error);
      return reply.status(500).send({ error: "InternalServerError", message: String(error) });
    }
  });

  /**
   * GET /crimes/categories
   * Returns crime categories with distinct actions mapped under each category.
   */
  fastify.get("/crimes/categories", async (_request, reply) => {
    try {
      const crimeNamesMap = await getCrimeNamesMap();
      const mappings = await db.crimeActionMapping.findMany();
      const customMappingSet = new Map<string, number>(mappings.map((m) => [m.id.toLowerCase(), m.crimeId]));

      // Group all crime logs by crimeId and action
      const actionGroups = await db.crimeLog.groupBy({
        by: ["crimeId", "action"],
        _sum: { nerve: true, value: true },
        _count: { _all: true },
      });

      const categoriesMap = new Map<
        number,
        {
          crimeId: number;
          crimeName: string;
          totalProfit: number;
          totalNerve: number;
          totalLogs: number;
          actions: Array<{
            action: string;
            count: number;
            totalNerve: number;
            totalProfit: number;
            profitPerNerve: number;
            isCustomMapped: boolean;
          }>;
        }
      >();

      const knownIds = Object.keys(crimeNamesMap).map(Number);
      for (const i of knownIds) {
        categoriesMap.set(i, {
          crimeId: i,
          crimeName: crimeNamesMap[i] || `Crime #${i}`,
          totalProfit: 0,
          totalNerve: 0,
          totalLogs: 0,
          actions: [],
        });
      }

      for (const group of actionGroups) {
        const cId = group.crimeId;
        const actionStr = group.action;
        const count = group._count._all;
        const totalNerve = group._sum.nerve ?? 0;
        const totalProfit = group._sum.value ?? 0;
        const profitPerNerve = totalNerve > 0 ? Number((totalProfit / totalNerve).toFixed(2)) : 0;
        const isCustomMapped = customMappingSet.has(actionStr.toLowerCase().trim());

        const cat = categoriesMap.get(cId) || {
          crimeId: cId,
          crimeName: crimeNamesMap[cId] || `Crime #${cId}`,
          totalProfit: 0,
          totalNerve: 0,
          totalLogs: 0,
          actions: [],
        };

        cat.totalProfit += totalProfit;
        cat.totalNerve += totalNerve;
        cat.totalLogs += count;
        cat.actions.push({
          action: actionStr,
          count,
          totalNerve,
          totalProfit,
          profitPerNerve,
          isCustomMapped,
        });

        categoriesMap.set(cId, cat);
      }

      const result = Array.from(categoriesMap.values()).map((cat) => {
        cat.actions.sort((a, b) => b.count - a.count);
        return cat;
      });

      return reply.send({
        success: true,
        categories: result,
      });
    } catch (error) {
      logger.error("Error in GET /crimes/categories:", error);
      return reply.status(500).send({ error: "InternalServerError", message: String(error) });
    }
  });

  /**
   * GET /crimes/logs
   * Paginated list of crime logs with optional date, crimeId, and search filters.
   */
  fastify.get("/crimes/logs", async (request, reply) => {
    try {
      const query = request.query as CrimesLogsQuery;
      const page = Math.max(1, parseInt(query.page || "1", 10));
      const limit = Math.min(Math.max(parseInt(query.limit || "50", 10), 1), 200);
      const skip = (page - 1) * limit;
      const crimeNamesMap = await getCrimeNamesMap();

      const where: any = {};

      if (query.date) {
        const startOfDay = new Date(`${query.date}T00:00:00.000Z`);
        const endOfDay = new Date(`${query.date}T23:59:59.999Z`);
        where.timestamp = {
          gte: startOfDay,
          lte: endOfDay,
        };
      }

      if (query.crimeId !== undefined && query.crimeId !== "") {
        where.crimeId = parseInt(query.crimeId, 10);
      }

      if (query.search) {
        where.action = {
          contains: query.search.trim(),
          mode: "insensitive",
        };
      }

      const [logs, total] = await Promise.all([
        db.crimeLog.findMany({
          where,
          orderBy: { timestamp: "desc" },
          skip,
          take: limit,
        }),
        db.crimeLog.count({ where }),
      ]);

      const formattedLogs = logs.map((log) => ({
        ...log,
        crimeName: crimeNamesMap[log.crimeId] || `Crime #${log.crimeId}`,
      }));

      return reply.send({
        success: true,
        logs: formattedLogs,
        pagination: {
          total,
          page,
          limit,
          totalPages: Math.ceil(total / limit),
        },
      });
    } catch (error) {
      logger.error("Error in GET /crimes/logs:", error);
      return reply.status(500).send({ error: "InternalServerError", message: String(error) });
    }
  });

  /**
   * POST /crimes/categorize
   * Manually maps an action string to a target crimeId and updates matching logs.
   */
  fastify.post("/crimes/categorize", async (request, reply) => {
    try {
      const body = request.body as CategorizeBody;
      if (!body || !body.action || body.targetCrimeId === undefined) {
        return reply.status(400).send({
          error: "BadRequest",
          message: "Action and targetCrimeId parameters are required.",
        });
      }

      const cleanAction = body.action.trim();
      const actionKey = cleanAction.toLowerCase();
      const targetCrimeId = Number(body.targetCrimeId);

      const crimeNamesMap = await getCrimeNamesMap();

      if (isNaN(targetCrimeId) || targetCrimeId < 0) {
        return reply.status(400).send({
          error: "BadRequest",
          message: "targetCrimeId must be a non-negative integer.",
        });
      }

      // Upsert into CrimeActionMapping
      await db.crimeActionMapping.upsert({
        where: { id: actionKey },
        update: {
          crimeId: targetCrimeId,
          updatedAt: new Date(),
        },
        create: {
          id: actionKey,
          crimeId: targetCrimeId,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });

      // Update matching records in CrimeLog (case-insensitive)
      const updateResult = await db.crimeLog.updateMany({
        where: {
          action: {
            equals: cleanAction,
            mode: "insensitive",
          },
        },
        data: {
          crimeId: targetCrimeId,
          updatedAt: new Date(),
        },
      });

      logger.info(
        `Categorized action "${cleanAction}" -> Crime #${targetCrimeId} (${crimeNamesMap[targetCrimeId] || `Crime #${targetCrimeId}`}). Updated ${updateResult.count} crime logs.`
      );

      return reply.send({
        success: true,
        action: cleanAction,
        targetCrimeId,
        targetCrimeName: crimeNamesMap[targetCrimeId] || `Crime #${targetCrimeId}`,
        updatedLogsCount: updateResult.count,
      });
    } catch (error) {
      logger.error("Error in POST /crimes/categorize:", error);
      return reply.status(500).send({ error: "InternalServerError", message: String(error) });
    }
  });

  /**
   * POST /crimes/init
   * Replays all historical personal crime logs into CrimeLog table using centralized utility functions.
   */
  fastify.post("/crimes/init", async (_request, reply) => {
    try {
      const CRIME_LOG_IDS = [
        9010, 9015, 9020, 9025, 9027, 9030, 9050, 9051, 9052, 9053, 9055, 9056,
        9060, 9065, 9070, 9071, 9072, 9073, 9150, 9154, 9155, 9158, 9160, 9163,
        9165, 9190, 9191,
      ];

      const [historicalLogs, customMappings] = await Promise.all([
        db.personalLog.findMany({
          where: { log: { in: CRIME_LOG_IDS } },
          orderBy: { timestamp: "asc" },
        }),
        db.crimeActionMapping.findMany(),
      ]);

      const customMappingMap = new Map<string, number>(
        customMappings.map((m) => [m.id.toLowerCase(), m.crimeId])
      );

      logger.info(`Replaying ${historicalLogs.length} historical crime logs into CrimeLog...`);

      let parsedCount = 0;
      const chunkSize = 200;
      for (let i = 0; i < historicalLogs.length; i += chunkSize) {
        const chunk = historicalLogs.slice(i, i + chunkSize);

        await db.$transaction(
          chunk.map((pLog) => {
            const { action, nerve, innerData } = extractCrimeDataPayload(pLog.data);
            const actionKey = action.toLowerCase();
            const crimeId = customMappingMap.has(actionKey)
              ? customMappingMap.get(actionKey)!
              : getCrimeIdFromAction(action);

            const logValue = calculateCrimeLogValue(innerData);

            return db.crimeLog.upsert({
              where: { id: pLog.id },
              update: {
                crimeId,
                action,
                nerve,
                value: logValue,
                timestamp: pLog.timestamp,
                updatedAt: new Date(),
              },
              create: {
                id: pLog.id,
                crimeId,
                action,
                nerve,
                value: logValue,
                timestamp: pLog.timestamp,
                createdAt: new Date(),
                updatedAt: new Date(),
              },
            });
          })
        );

        parsedCount += chunk.length;
      }

      await db.systemState.upsert({
        where: { id: "crimes_ledger_init" },
        update: { init: true, data: { status: "completed" }, updatedAt: new Date() },
        create: { id: "crimes_ledger_init", init: true, data: { status: "completed" }, createdAt: new Date(), updatedAt: new Date() },
      });

      return reply.send({
        success: true,
        message: `Crimes Ledger initialized successfully! Replayed ${parsedCount} logs.`,
        replayedCount: parsedCount,
      });
    } catch (error) {
      logger.error("Error in POST /crimes/init:", error);
      return reply.status(500).send({ error: "InternalServerError", message: String(error) });
    }
  });
}
