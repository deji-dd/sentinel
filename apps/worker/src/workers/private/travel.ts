import { Logger } from "@sentinel/utils";
import { db } from "@sentinel/database";
import { type TornSchema } from "@sentinel/torn-api";
import { tornApiManager, getPersonalKey } from "@sentinel/torn-api-manager";
import { workerEvents } from "../../lib/event-bus.js";
import type { WorkerStartOptions } from "../registry.js";

const WORKER_NAME = "travel_module";
const logger = new Logger(WORKER_NAME);

export const TRAVEL_LOG_IDS = [6000, 4201];

type UserLog = TornSchema<"UserLog">;

export const COUNTRY_NAME_TO_CODE: Record<string, string> = {
  "south africa": "saf",
  "cayman islands": "cay",
  canada: "can",
  hawaii: "haw",
  "united kingdom": "uk",
  argentina: "arg",
  mexico: "mex",
  torn: "torn",
  switzerland: "swi",
  japan: "jap",
  china: "chi",
  uae: "uae",
};

export const TORN_STATIC_AREA_MAP: Record<
  number,
  { countryCode: string; name: string }
> = {
  0: { countryCode: "torn", name: "Torn" },
  1: { countryCode: "mex", name: "Mexico" },
  2: { countryCode: "cay", name: "Cayman Islands" },
  3: { countryCode: "can", name: "Canada" },
  4: { countryCode: "haw", name: "Hawaii" },
  5: { countryCode: "uk", name: "United Kingdom" },
  6: { countryCode: "arg", name: "Argentina" },
  7: { countryCode: "swi", name: "Switzerland" },
  8: { countryCode: "jap", name: "Japan" },
  9: { countryCode: "chi", name: "China" },
  10: { countryCode: "uae", name: "UAE" },
  11: { countryCode: "saf", name: "South Africa" },
};

/**
 * Seeds static travel area mappings into PostgreSQL `TravelAreaMapping`
 * and clears any bad auto-generated fallback records (e.g. `Area 8`).
 */
export async function seedTravelAreaMappings(): Promise<void> {
  for (const [idStr, info] of Object.entries(TORN_STATIC_AREA_MAP)) {
    const id = Number(idStr);
    await db.travelAreaMapping.upsert({
      where: { id },
      create: {
        id,
        countryCode: info.countryCode,
        name: info.name,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      update: {
        countryCode: info.countryCode,
        name: info.name,
        updatedAt: new Date(),
      },
    });
  }
}

/**
 * Dynamically resolves country name and code from user profile status description.
 * Example status: "Traveling from Torn to South Africa" or "In Mexico"
 */
export function parseCountryFromStatus(
  statusDescription: string,
): { countryCode: string; name: string } | null {
  if (!statusDescription) return null;
  const lower = statusDescription.toLowerCase();

  for (const [countryName, code] of Object.entries(COUNTRY_NAME_TO_CODE)) {
    if (lower.includes(countryName)) {
      const formattedName = countryName
        .split(" ")
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(" ");
      return { countryCode: code, name: formattedName };
    }
  }

  return null;
}

/**
 * Ensures an area ID is mapped in PostgreSQL `TravelAreaMapping`.
 * Checks static map first, and only calls `/user/profile` for live events while user is flying.
 */
export async function ensureAreaMapped(
  areaId: number,
  options?: { isLiveLog?: boolean; preferredName?: string },
): Promise<void> {
  if (!areaId) return;

  // 1. Static map check
  const staticMatch = TORN_STATIC_AREA_MAP[areaId];
  if (staticMatch) {
    const existingStatic = await db.travelAreaMapping.findUnique({
      where: { id: areaId },
    });
    if (existingStatic) {
      if (
        existingStatic.countryCode !== staticMatch.countryCode ||
        existingStatic.name !== staticMatch.name
      ) {
        await db.travelAreaMapping.update({
          where: { id: areaId },
          data: {
            countryCode: staticMatch.countryCode,
            name: staticMatch.name,
            updatedAt: new Date(),
          },
        });
      }
    } else {
      await db.travelAreaMapping.create({
        data: {
          id: areaId,
          countryCode: staticMatch.countryCode,
          name: staticMatch.name,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });
    }
    return;
  }

  // 2. Existing valid mapping check
  const existing = await db.travelAreaMapping.findUnique({
    where: { id: areaId },
  });
  if (existing && !existing.countryCode.startsWith("area_")) return;

  let countryCode = `area_${areaId}`;
  let name = options?.preferredName ?? `Area ${areaId}`;

  // 3. Only attempt live profile status fetch if this is a live log event (not backfill)
  if (options?.isLiveLog) {
    try {
      const keyEntry = await getPersonalKey();
      if (keyEntry) {
        const profileRes = await tornApiManager.get("/user/profile", {
          apiKey: keyEntry.apiKey,
          userId: keyEntry.userId,
        });

        const statusState = profileRes?.profile?.status?.state;
        if (statusState === "Traveling" || statusState === "Abroad") {
          const statusDesc = profileRes?.profile?.status?.description;
          const parsed = parseCountryFromStatus(statusDesc);
          if (parsed) {
            countryCode = parsed.countryCode;
            name = parsed.name;
          }
        }
      }
    } catch (err) {
      logger.warn(
        `Could not resolve area ID ${areaId} via profile status:`,
        err,
      );
    }
  }

  if (existing) {
    await db.travelAreaMapping.update({
      where: { id: areaId },
      data: { countryCode, name, updatedAt: new Date() },
    });
  } else {
    await db.travelAreaMapping.create({
      data: {
        id: areaId,
        countryCode,
        name,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
  }

  logger.info(`Mapped travel area ID ${areaId} -> ${name} (${countryCode})`);
}

/**
 * Parses Log 6000 (Travel Depart) and dynamically resolves destination mappings.
 */
export async function parseTravelDepart(
  log: UserLog,
  isLiveLog = false,
): Promise<void> {
  const data = log?.data || {};
  if (data.origin)
    await ensureAreaMapped(Number(data.origin), { isLiveLog });
  if (data.destination)
    await ensureAreaMapped(Number(data.destination), { isLiveLog });
}

/**
 * Parses Log 4201 (Item Abroad Buy), computes profit vs Torn market price,
 * and records entry into `TravelPurchaseLog` & `LedgerEvent`.
 */
export async function parseItemAbroadBuy(
  log: UserLog,
  isLiveLog = false,
): Promise<boolean> {
  const data = log?.data || {};
  const areaId = Number(data.area || 0);
  const itemId = Number(data.item || 0);
  const quantity = Number(data.quantity || 0);
  const costTotal = Number(data.cost_total || 0);

  if (!areaId || !itemId) return false;

  await ensureAreaMapped(areaId, { isLiveLog });

  const itemRecord = await db.tornItem.findUnique({
    where: { id: String(itemId) },
  });
  const itemData = (itemRecord?.data as any) ?? {};
  const marketPrice = Number(itemData.value?.market_price || 0);
  const marketValue = marketPrice * quantity;
  const profit = marketValue - costTotal;

  const logIdStr = String(log.id);
  const logTimestamp = new Date(log.timestamp * 1000);

  // 1. Record item purchase in TravelPurchaseLog
  await db.travelPurchaseLog.upsert({
    where: { id: logIdStr },
    update: {
      timestamp: logTimestamp,
      destination: areaId,
      itemId,
      quantity,
      costTotal,
      marketValue,
      profit,
      updatedAt: new Date(),
    },
    create: {
      id: logIdStr,
      timestamp: logTimestamp,
      destination: areaId,
      itemId,
      quantity,
      costTotal,
      marketValue,
      profit,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  });

  // 2. Record financial transaction in LedgerEvent
  await db.ledgerEvent.upsert({
    where: { id: `ledger_ev_${logIdStr}` },
    update: {
      logId: logIdStr,
      timestamp: logTimestamp,
      type: "travel_buy",
      categoryId: 7,
      transactionName: "Travel Item Purchase Abroad",
      assetsAffected: [
        {
          assetId: String(itemId),
          quantityChange: quantity,
          costBasisImpact: costTotal,
        },
      ],
      cashFlow: -costTotal,
      realizedPnl: profit,
      rawLog: log,
      updatedAt: new Date(),
    },
    create: {
      id: `ledger_ev_${logIdStr}`,
      logId: logIdStr,
      timestamp: logTimestamp,
      type: "travel_buy",
      categoryId: 7,
      transactionName: "Travel Item Purchase Abroad",
      assetsAffected: [
        {
          assetId: String(itemId),
          quantityChange: quantity,
          costBasisImpact: costTotal,
        },
      ],
      cashFlow: -costTotal,
      realizedPnl: profit,
      rawLog: log,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  });

  logger.info(
    `Tracked travel purchase: item ${itemId} x${quantity} in Area ${areaId} (Profit: +$${profit.toLocaleString()})`,
  );
  return true;
}

/**
 * On-demand query: Aggregate travel profit grouped by destination location.
 */
export async function getTravelProfitByLocation(): Promise<
  Array<{
    destination: number;
    countryCode: string;
    locationName: string;
    totalProfit: number;
    totalQuantity: number;
    totalCost: number;
    totalValue: number;
  }>
> {
  const groups = await db.travelPurchaseLog.groupBy({
    by: ["destination"],
    _sum: { profit: true, quantity: true, costTotal: true, marketValue: true },
  });

  const mappings = await db.travelAreaMapping.findMany();
  const mapById = new Map(mappings.map((m) => [m.id, m]));

  return groups.map((g) => {
    const area = mapById.get(g.destination);
    return {
      destination: g.destination,
      countryCode: area?.countryCode ?? `area_${g.destination}`,
      locationName: area?.name ?? `Area ${g.destination}`,
      totalProfit: g._sum.profit ?? 0,
      totalQuantity: g._sum.quantity ?? 0,
      totalCost: g._sum.costTotal ?? 0,
      totalValue: g._sum.marketValue ?? 0,
    };
  });
}

/**
 * Initializes Travel Ledger:
 * 1. Checks if historical log backfill is completed.
 * 2. Replays travel logs (6000, 4201) from PostgreSQL `PersonalLog`.
 * 3. Updates `travel_ledger_init` status to completed.
 */
async function runTravelLedgerInit(): Promise<void> {
  try {
    logger.info("Initializing Travel Ledger...");
    await seedTravelAreaMappings();

    const backfillRecord = await db.systemState.findUnique({
      where: { id: "log_manager_backfill_progress" },
    });
    const backfillData = backfillRecord?.data as { status: string } | undefined;

    if (backfillData?.status !== "completed") {
      logger.warn(
        "Log backfill is ongoing. Postponing Travel Ledger initialization.",
      );
      return;
    }

    await db.systemState.upsert({
      where: { id: "travel_ledger_init" },
      update: {
        init: false,
        data: { status: "in_progress" },
        updatedAt: new Date(),
      },
      create: {
        id: "travel_ledger_init",
        init: false,
        data: { status: "in_progress" },
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });

    const historicalLogs = await db.personalLog.findMany({
      where: { log: { in: TRAVEL_LOG_IDS } },
      orderBy: { timestamp: "asc" },
    });

    logger.info(
      `Replaying ${historicalLogs.length} historical travel logs into TravelPurchaseLog...`,
    );

    let parsed = 0;
    for (const logRecord of historicalLogs) {
      const rawLog = logRecord.data as unknown as UserLog;
      const logCode = Number(logRecord.log);
      if (logCode === 6000) {
        await parseTravelDepart(rawLog, false);
        parsed++;
      } else if (logCode === 4201) {
        await parseItemAbroadBuy(rawLog, false);
        parsed++;
      }
    }

    await db.systemState.upsert({
      where: { id: "travel_ledger_init" },
      update: {
        init: true,
        data: { status: "completed", logsParsed: parsed },
        updatedAt: new Date(),
      },
      create: {
        id: "travel_ledger_init",
        init: true,
        data: { status: "completed", logsParsed: parsed },
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });

    logger.info(
      `Travel Ledger initialized successfully. Parsed ${parsed} logs.`,
    );
  } catch (err) {
    logger.error("Failed to initialize Travel Ledger:", err);
  }
}

/**
 * Checks and starts travel ledger initialization if required.
 */
async function checkAndInitTravel(): Promise<void> {
  await seedTravelAreaMappings();
  const initState = await db.systemState.findUnique({
    where: { id: "travel_ledger_init" },
  });

  if (!initState || !initState.init) {
    await runTravelLedgerInit();
  }
}

/**
 * Registers travel real-time event listeners.
 */
export function startTravelModule(_options?: WorkerStartOptions): void {
  seedTravelAreaMappings().catch((err) =>
    logger.error("Error seeding travel area mappings:", err),
  );

  checkAndInitTravel().catch((err) =>
    logger.error("Error during travel checkAndInit:", err),
  );

  workerEvents.on("new_log", async (log: UserLog) => {
    const initState = await db.systemState.findUnique({
      where: { id: "travel_ledger_init" },
    });
    if (!initState || !initState.init) {
      return;
    }

    const logCode = Number(log.details?.id);
    if (logCode === 6000) {
      await parseTravelDepart(log, true);
    } else if (logCode === 4201) {
      await parseItemAbroadBuy(log, true);
    }
  });

  workerEvents.on("log_backfill_completed", () => {
    checkAndInitTravel().catch((err) =>
      logger.error("Error running Travel init after backfill:", err),
    );
  });

  logger.info("Travel module registered and listening for travel logs.");
}
