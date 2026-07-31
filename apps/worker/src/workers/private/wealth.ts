import { Logger } from "@sentinel/utils";
import { db } from "@sentinel/database";
import { type TornSchema } from "@sentinel/torn-api";
import { workerEvents } from "../../lib/event-bus.js";
import type { WorkerStartOptions } from "../registry.js";

const WORKER_NAME = "wealth_module";
const logger = new Logger(WORKER_NAME);

type UserLog = TornSchema<"UserLog">;

let cachedAnchorTimestamp: number | null = null;

async function getAnchorTimestamp(): Promise<number | null> {
  if (cachedAnchorTimestamp) return cachedAnchorTimestamp;

  const state = await db.systemState.findUnique({
    where: { id: "wealth_ledger_init" },
  });

  if (state && state.init) {
    cachedAnchorTimestamp = Math.floor(state.createdAt.getTime() / 1000);
    return cachedAnchorTimestamp;
  }

  return null;
}

async function isLogValidForWealth(logTimestamp: number): Promise<boolean> {
  const anchor = await getAnchorTimestamp();
  if (!anchor) return false;
  if (logTimestamp < anchor) return false;
  return true;
}

function extractItemsFromLogData(data: Record<string, any>): { id: string | number; qty: number; uid?: number | null }[] {
  const items: { id: string | number; qty: number; uid?: number | null }[] = [];
  if (!data) return items;

  if (data.items && Array.isArray(data.items)) {
    for (const it of data.items) {
      if (it && (it.id || it.item)) {
        items.push({
          id: it.id || it.item,
          qty: Number(it.quantity || it.qty || it.amount || 1),
          uid: it.uid ? Number(it.uid) : null,
        });
      }
    }
  } else if (data.item && Array.isArray(data.item)) {
    for (const it of data.item) {
      if (it && (it.id || it.item)) {
        items.push({
          id: it.id || it.item,
          qty: Number(it.quantity || it.qty || it.amount || 1),
          uid: it.uid ? Number(it.uid) : null,
        });
      }
    }
  } else if (data.item && typeof data.item === "object") {
    for (const [itemId, qty] of Object.entries(data.item)) {
      items.push({ id: itemId, qty: Number(qty || 1) });
    }
  } else if (typeof data.item === "number") {
    items.push({ id: data.item, qty: Number(data.quantity || 1) });
  }

  if (data.points && typeof data.points === "number") {
    items.push({ id: "points", qty: data.points });
  }

  return items;
}

// --- Museum Sets for Transformation Sinks ---
const MUSEUM_SETS: Record<string, number[]> = {
  "Plushie Set": [186, 187, 215, 258, 261, 266, 268, 269, 273, 274, 281, 384, 618],
  "Flower Set": [260, 263, 264, 267, 271, 272, 276, 277, 282, 385, 617],
  "Medieval Coins": [770, 771, 772],
  "Quran Script": [773, 774],
  "Senet Board": [775, 776, 777],
  "Shabti Sculpture": [778, 779, 780],
  Amulet: [781, 782, 783],
};

export const EQUITY_LOG_IDS = [5510, 5511, 5927, 5928, 5920, 5900, 6280, 6300, 6284, 6285, 6290, 6291, 6292];
export const FACTION_LOG_IDS = [6746, 6747, 6728];
export const STORAGE_TRANSFER_LOG_IDS = [1222, 1223, 1302, 1303, 1403, 1110, 1111, 4447, 4448, 5000, 5001, 4300];
export const ZERO_COST_LOG_IDS = [7011, 8374, 8375, 8377, 8378, 1404, 5575];

/**
 * 1. Barter Trade Parser (4430)
 */
export async function parseBarterTrade(log: UserLog): Promise<void> {
  if (!(await isLogValidForWealth(log.timestamp))) return;

  const data = (log.data as Record<string, any>) || {};
  const tradeId = data.parsed_trade_id || data.trade_id;
  if (!tradeId) return;

  const tradeLogs = await db.personalLog.findMany({
    where: { data: { path: ["parsed_trade_id"], equals: tradeId } },
  });

  let outgoingMoney = 0;
  let incomingMoney = 0;
  const outgoingItems: { id: string | number; qty: number; uid?: number | null }[] = [];
  const incomingItems: { id: string | number; qty: number; uid?: number | null }[] = [];

  let requiresManualReview = false;
  let reviewReason = "";

  for (const tlog of tradeLogs) {
    const tData = (tlog.data as Record<string, any>) || {};
    const tId = Number(tlog.log);

    if (tId === 4440) outgoingMoney += Number(tData.money || 0);
    if (tId === 4441) incomingMoney += Number(tData.money || 0);

    if (tId === 4445) outgoingItems.push(...extractItemsFromLogData(tData));
    if (tId === 4446) incomingItems.push(...extractItemsFromLogData(tData));

    if ([4450, 4451, 4475, 4476].includes(tId)) {
      requiresManualReview = true;
      reviewReason = `Log ID ${tId}`;
    }
  }

  const logIdStr = String(log.id);
  const logTimestamp = new Date(log.timestamp * 1000);

  if (requiresManualReview) {
    logger.warn(`Barter ${tradeId} flagged for manual review (${reviewReason}).`);
    await db.ledgerEvent.upsert({
      where: { id: `ledger_ev_${logIdStr}` },
      update: { updatedAt: new Date() },
      create: {
        id: `ledger_ev_${logIdStr}`,
        logId: logIdStr,
        timestamp: logTimestamp,
        type: "barter",
        categoryId: 6,
        transactionName: "Barter Trade (MANUAL REVIEW REQUIRED)",
        assetsAffected: [],
        cashFlow: 0,
        realizedPnl: 0,
        rawLog: log as unknown as object,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    return;
  }

  let totalOutgoingCostBasis = outgoingMoney;
  const assetsAffected: { assetId: string; quantityChange: number; costBasisImpact: number }[] = [];

  for (const item of outgoingItems) {
    const isUid = !!(item.uid && typeof item.uid !== "boolean");
    const assetKey = isUid ? `uid_${item.uid}` : `item_${item.id}_inventory`;

    const existingAsset = await db.asset.findUnique({ where: { id: assetKey } });
    if (existingAsset) {
      const mac = existingAsset.movingAverageCost;
      const burnedCost = mac * item.qty;
      totalOutgoingCostBasis += burnedCost;

      const newQty = Math.max(0, existingAsset.quantity - item.qty);
      const newCostBasis = newQty * mac;

      await db.asset.update({
        where: { id: assetKey },
        data: {
          quantity: newQty,
          totalCostBasis: newCostBasis,
          lastUpdated: new Date(),
          updatedAt: new Date(),
        },
      });

      assetsAffected.push({
        assetId: String(item.id),
        quantityChange: -item.qty,
        costBasisImpact: -burnedCost,
      });
    }
  }

  let totalSystemValue = 0;
  const itemRecords = await db.tornItem.findMany();
  const itemMap = new Map(itemRecords.map((i) => [i.id, ((i.data as Record<string, any>)?.value?.market_price || 0) as number]));

  const incomingWeighted = incomingItems.map((item) => {
    let sysVal = 0;
    if (String(item.id) === "points") {
      sysVal = 30000;
    } else {
      sysVal = itemMap.get(String(item.id)) || 0;
    }
    const itemTotalValue = sysVal * item.qty;
    totalSystemValue += itemTotalValue;
    return { ...item, sysVal, itemTotalValue };
  });

  for (const item of incomingWeighted) {
    const weight = totalSystemValue > 0 ? item.itemTotalValue / totalSystemValue : 1 / incomingWeighted.length;
    const assignedCostBasis = totalOutgoingCostBasis * weight;

    const isUid = !!(item.uid && typeof item.uid !== "boolean");
    const assetKey = isUid ? `uid_${item.uid}` : `item_${item.id}_inventory`;

    const existingAsset = await db.asset.findUnique({ where: { id: assetKey } });
    if (existingAsset) {
      const newQty = existingAsset.quantity + item.qty;
      const newCostBasis = existingAsset.totalCostBasis + assignedCostBasis;
      const newMac = newQty > 0 ? newCostBasis / newQty : 0;

      await db.asset.update({
        where: { id: assetKey },
        data: {
          quantity: newQty,
          totalCostBasis: newCostBasis,
          movingAverageCost: newMac,
          lastUpdated: new Date(),
          updatedAt: new Date(),
        },
      });
    } else {
      const mac = item.qty > 0 ? assignedCostBasis / item.qty : 0;
      await db.asset.create({
        data: {
          id: assetKey,
          type: String(item.id) === "points" ? "point" : "item",
          assetId: String(item.id),
          quantity: item.qty,
          movingAverageCost: mac,
          totalCostBasis: assignedCostBasis,
          location: "inventory",
          owner: "personal",
          origin: "barter",
          realizedPnl: 0,
          lastUpdated: new Date(),
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });
    }

    assetsAffected.push({
      assetId: String(item.id),
      quantityChange: item.qty,
      costBasisImpact: assignedCostBasis,
    });
  }

  const netCashFlow = incomingMoney - outgoingMoney;

  if (assetsAffected.length > 0 || netCashFlow !== 0) {
    await db.ledgerEvent.upsert({
      where: { id: `ledger_ev_${logIdStr}` },
      update: {
        assetsAffected: assetsAffected as unknown as object,
        cashFlow: netCashFlow,
        updatedAt: new Date(),
      },
      create: {
        id: `ledger_ev_${logIdStr}`,
        logId: logIdStr,
        timestamp: logTimestamp,
        type: "barter",
        categoryId: 6,
        transactionName: "Barter Trade",
        assetsAffected: assetsAffected as unknown as object,
        cashFlow: netCashFlow,
        realizedPnl: 0,
        rawLog: log as unknown as object,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
  }
}

/**
 * 2. Equities, Properties & Companies Parser
 */
export async function parseEquityProperty(log: UserLog): Promise<void> {
  if (!(await isLogValidForWealth(log.timestamp))) return;

  const logId = Number(log.details.id);
  const data = (log.data as Record<string, any>) || {};

  const isBuy = [5510, 5927, 6280].includes(logId);
  const isSell = [5511, 5928, 6300].includes(logId);
  const isUpkeep = [5920, 5900, 6290, 6291, 6292].includes(logId);
  const isTransfer = [6284, 6285].includes(logId);

  let assetType = "item";
  let assetId = "";
  let qty = 1;
  let cost = 0;

  if ([5510, 5511].includes(logId)) {
    assetType = "stock";
    assetId = `stock_${data.stock}`;
    qty = Number(data.amount || 1);
    const fees = Number(data.fees || 0);
    cost = isSell ? Number(data.worth || 0) - fees : Number(data.worth || 0);
  } else if ([5927, 5928, 5920, 5900].includes(logId)) {
    assetType = "property";
    assetId = `property_${data.property || data.property_id}`;
    qty = 1;
    cost = Number(data.cost || data.upkeep_paid || 0);
  } else {
    assetType = "company";
    assetId = `company_${data.company}`;
    qty = 1;
    cost = Number(data.cost || data.deposited || data.withdrawn || data.sale_value || 0);
  }

  if (!assetId || assetId.includes("undefined")) return;

  let cashFlow = 0;
  let realizedPnl = 0;
  const assetsAffected: { assetId: string; quantityChange: number; costBasisImpact: number }[] = [];

  if (isUpkeep) {
    cashFlow -= cost;
    realizedPnl -= cost;
  } else if (isTransfer) {
    cashFlow = logId === 6285 ? cost : -cost;
    assetsAffected.push({ assetId, quantityChange: 0, costBasisImpact: -cashFlow });
  } else if (isBuy) {
    cashFlow -= cost;
    const existing = await db.asset.findUnique({ where: { id: assetId } });
    if (existing) {
      const newQty = existing.quantity + qty;
      const newCostBasis = existing.totalCostBasis + cost;
      const newMac = newQty > 0 ? newCostBasis / newQty : 0;
      await db.asset.update({
        where: { id: assetId },
        data: { quantity: newQty, totalCostBasis: newCostBasis, movingAverageCost: newMac, lastUpdated: new Date(), updatedAt: new Date() },
      });
    } else {
      const mac = qty > 0 ? cost / qty : 0;
      await db.asset.create({
        data: {
          id: assetId,
          type: assetType,
          assetId,
          quantity: qty,
          movingAverageCost: mac,
          totalCostBasis: cost,
          location: "portfolio",
          owner: "personal",
          origin: "purchase",
          realizedPnl: 0,
          lastUpdated: new Date(),
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });
    }
    assetsAffected.push({ assetId, quantityChange: qty, costBasisImpact: cost });
  } else if (isSell) {
    cashFlow += cost;
    const existing = await db.asset.findUnique({ where: { id: assetId } });
    const mac = existing?.movingAverageCost ?? 0;
    const profit = cost - mac * qty;
    realizedPnl += profit;

    if (existing) {
      const newQty = Math.max(0, existing.quantity - qty);
      const newCostBasis = newQty * mac;
      await db.asset.update({
        where: { id: assetId },
        data: { quantity: newQty, totalCostBasis: newCostBasis, realizedPnl: existing.realizedPnl + profit, lastUpdated: new Date(), updatedAt: new Date() },
      });
    }
    assetsAffected.push({ assetId, quantityChange: -qty, costBasisImpact: -(mac * qty) });
  }

  const logIdStr = String(log.id);
  const logTimestamp = new Date(log.timestamp * 1000);

  await db.ledgerEvent.upsert({
    where: { id: `ledger_ev_${logIdStr}` },
    update: { assetsAffected: assetsAffected as unknown as object, cashFlow, realizedPnl, updatedAt: new Date() },
    create: {
      id: `ledger_ev_${logIdStr}`,
      logId: logIdStr,
      timestamp: logTimestamp,
      type: isBuy ? "purchase" : isSell ? "sale" : "loss",
      categoryId: 9,
      transactionName: "Equity/Property Transaction",
      assetsAffected: assetsAffected as unknown as object,
      cashFlow,
      realizedPnl,
      rawLog: log as unknown as object,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  });
}

/**
 * 3. Faction Loans & Deposits Parser
 */
export async function parseFactionLiability(log: UserLog): Promise<void> {
  if (!(await isLogValidForWealth(log.timestamp))) return;

  const logId = Number(log.details.id);
  const data = (log.data as Record<string, any>) || {};
  const items = extractItemsFromLogData(data);
  const assetsAffected: { assetId: string; uid?: number | string; quantityChange: number; costBasisImpact: number }[] = [];

  for (const item of items) {
    const isUid = !!(item.uid && typeof item.uid !== "boolean");
    const assetKey = isUid ? `uid_${item.uid}` : `item_${item.id}_faction`;

    if (logId === 6746) {
      // Loan receive
      const existing = await db.asset.findUnique({ where: { id: assetKey } });
      if (existing) {
        await db.asset.update({
          where: { id: assetKey },
          data: { quantity: existing.quantity + item.qty, lastUpdated: new Date(), updatedAt: new Date() },
        });
      } else {
        await db.asset.create({
          data: {
            id: assetKey,
            type: "item",
            assetId: String(item.id),
            quantity: item.qty,
            movingAverageCost: 0,
            totalCostBasis: 0,
            location: "inventory",
            owner: "faction",
            origin: "faction_loan",
            realizedPnl: 0,
            lastUpdated: new Date(),
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        });
      }
      assetsAffected.push({ assetId: String(item.id), uid: item.uid || undefined, quantityChange: item.qty, costBasisImpact: 0 });
    } else if (logId === 6747 || logId === 6728) {
      // Loan return or deposit
      const existing = await db.asset.findUnique({ where: { id: assetKey } });
      if (existing) {
        const newQty = Math.max(0, existing.quantity - item.qty);
        await db.asset.update({
          where: { id: assetKey },
          data: { quantity: newQty, lastUpdated: new Date(), updatedAt: new Date() },
        });
      }
      assetsAffected.push({ assetId: String(item.id), uid: item.uid || undefined, quantityChange: -item.qty, costBasisImpact: 0 });
    }
  }

  const logIdStr = String(log.id);
  const logTimestamp = new Date(log.timestamp * 1000);

  if (assetsAffected.length > 0) {
    await db.ledgerEvent.upsert({
      where: { id: `ledger_ev_${logIdStr}` },
      update: { assetsAffected: assetsAffected as unknown as object, updatedAt: new Date() },
      create: {
        id: `ledger_ev_${logIdStr}`,
        logId: logIdStr,
        timestamp: logTimestamp,
        type: logId === 6746 ? "injection" : "sink",
        categoryId: 7,
        transactionName: logId === 6746 ? "Faction Loan Received" : "Faction Item Returned/Deposited",
        assetsAffected: assetsAffected as unknown as object,
        cashFlow: 0,
        realizedPnl: 0,
        rawLog: log as unknown as object,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
  }
}

/**
 * 4. Storage Transfers Parser (moving items between inventory, bazaar, display cabinet, escrow)
 */
export async function parseStorageTransfer(log: UserLog): Promise<void> {
  if (!(await isLogValidForWealth(log.timestamp))) return;

  const logId = Number(log.details.id);
  const data = (log.data as Record<string, any>) || {};
  const items = extractItemsFromLogData(data);
  if (items.length === 0) return;

  let targetLocation = "inventory";
  if ([1222].includes(logId)) targetLocation = "bazaar";
  else if ([1302].includes(logId)) targetLocation = "display";
  else if ([1403, 1110, 4447, 5000, 4300].includes(logId)) targetLocation = "escrow";

  const assetsAffected: { assetId: string; uid?: number | string; quantityChange: number; costBasisImpact: number }[] = [];

  for (const item of items) {
    const isUid = !!(item.uid && typeof item.uid !== "boolean");
    const assetKey = isUid ? `uid_${item.uid}` : `item_${item.id}_${targetLocation}`;

    const existing = await db.asset.findUnique({ where: { id: assetKey } });
    if (existing) {
      await db.asset.update({
        where: { id: assetKey },
        data: { location: targetLocation, lastUpdated: new Date(), updatedAt: new Date() },
      });
    }

    assetsAffected.push({ assetId: String(item.id), uid: item.uid || undefined, quantityChange: 0, costBasisImpact: 0 });
  }

  const logIdStr = String(log.id);
  const logTimestamp = new Date(log.timestamp * 1000);

  await db.ledgerEvent.upsert({
    where: { id: `ledger_ev_${logIdStr}` },
    update: { assetsAffected: assetsAffected as unknown as object, updatedAt: new Date() },
    create: {
      id: `ledger_ev_${logIdStr}`,
      logId: logIdStr,
      timestamp: logTimestamp,
      type: "storage_transfer",
      categoryId: 3,
      transactionName: "Asset Storage Transfer",
      assetsAffected: assetsAffected as unknown as object,
      cashFlow: 0,
      realizedPnl: 0,
      rawLog: log as unknown as object,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  });
}

/**
 * 5. Zero-Cost Asset Injections Parser (free drops from crimes, spin, events)
 */
export async function parseZeroCostInjection(log: UserLog): Promise<void> {
  if (!(await isLogValidForWealth(log.timestamp))) return;

  const data = (log.data as Record<string, any>) || {};
  const gainedItems = extractItemsFromLogData(data);

  let cashFlow = 0;
  let realizedPnl = 0;
  if (data.money) {
    cashFlow += Number(data.money);
    realizedPnl += Number(data.money);
  }

  const assetsAffected: { assetId: string; uid?: number | string; quantityChange: number; costBasisImpact: number }[] = [];

  for (const item of gainedItems) {
    const isUid = !!(item.uid && typeof item.uid !== "boolean");
    const assetKey = isUid ? `uid_${item.uid}` : `item_${item.id}_inventory`;

    const existing = await db.asset.findUnique({ where: { id: assetKey } });
    if (existing) {
      const newQty = existing.quantity + item.qty;
      const newMac = newQty > 0 ? existing.totalCostBasis / newQty : 0;
      await db.asset.update({
        where: { id: assetKey },
        data: { quantity: newQty, movingAverageCost: newMac, lastUpdated: new Date(), updatedAt: new Date() },
      });
    } else {
      await db.asset.create({
        data: {
          id: assetKey,
          type: String(item.id) === "points" ? "point" : "item",
          assetId: String(item.id),
          quantity: item.qty,
          movingAverageCost: 0,
          totalCostBasis: 0,
          location: "inventory",
          owner: "personal",
          origin: "zero_cost_injection",
          realizedPnl: 0,
          lastUpdated: new Date(),
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });
    }

    assetsAffected.push({ assetId: String(item.id), uid: item.uid || undefined, quantityChange: item.qty, costBasisImpact: 0 });
  }

  const logIdStr = String(log.id);
  const logTimestamp = new Date(log.timestamp * 1000);

  if (assetsAffected.length > 0 || cashFlow !== 0) {
    await db.ledgerEvent.upsert({
      where: { id: `ledger_ev_${logIdStr}` },
      update: { assetsAffected: assetsAffected as unknown as object, cashFlow, realizedPnl, updatedAt: new Date() },
      create: {
        id: `ledger_ev_${logIdStr}`,
        logId: logIdStr,
        timestamp: logTimestamp,
        type: "injection",
        categoryId: 4,
        transactionName: "Free Asset Acquisition",
        assetsAffected: assetsAffected as unknown as object,
        cashFlow,
        realizedPnl,
        rawLog: log as unknown as object,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
  }
}

/**
 * 6. Standard Cash Transactions (Bazaar buys/sells, item market buys, vault transfers, bounties)
 */
export async function parseStandardCash(log: UserLog): Promise<void> {
  if (!(await isLogValidForWealth(log.timestamp))) return;

  const logId = Number(log.details.id);
  const data = (log.data as Record<string, any>) || {};

  const purchaseIds = [1112, 1225, 4200, 4201, 5010, 4320];
  const saleIds = [1226, 1113, 4210, 4220, 5011, 4322];

  const purchase = purchaseIds.includes(logId);
  const sale = saleIds.includes(logId);
  if (!purchase && !sale) return;

  let items = data.items || [];
  if (items.length === 0 && data.item) {
    if (Array.isArray(data.item)) {
      items = data.item;
    } else if (typeof data.item === "number") {
      items = [{ id: data.item, uid: null, qty: data.quantity || 1 }];
    }
  }

  let cashFlow = 0;
  let realizedPnl = 0;
  const assetsAffected: { assetId: string; uid?: number | string; quantityChange: number; costBasisImpact: number }[] = [];

  for (const item of items) {
    const id = item.id;
    const qty = Number(item.qty || 1);

    let totalCost = Number(data.final_price ?? data.cost_total ?? data.total_value ?? 0);
    let priceEach = Number(data.cost_each ?? data.value_each ?? 0);

    if (totalCost === 0 && priceEach > 0) totalCost = priceEach * qty;
    if (priceEach === 0 && totalCost > 0) priceEach = totalCost / qty;

    const isUid = !!(item.uid && typeof item.uid !== "boolean");
    const assetKey = isUid ? `uid_${item.uid}` : `item_${id}_inventory`;

    let assetDoc = await db.asset.findUnique({ where: { id: assetKey } });

    if (purchase) {
      cashFlow -= totalCost;
      if (assetDoc) {
        const newQty = assetDoc.quantity + qty;
        const newCostBasis = assetDoc.totalCostBasis + totalCost;
        const newMac = newQty > 0 ? newCostBasis / newQty : 0;

        await db.asset.update({
          where: { id: assetKey },
          data: {
            quantity: newQty,
            totalCostBasis: newCostBasis,
            movingAverageCost: newMac,
            lastUpdated: new Date(),
            updatedAt: new Date(),
          },
        });
      } else {
        const mac = qty > 0 ? totalCost / qty : 0;
        await db.asset.create({
          data: {
            id: assetKey,
            type: "item",
            assetId: String(id),
            quantity: qty,
            movingAverageCost: mac,
            totalCostBasis: totalCost,
            location: "inventory",
            owner: "personal",
            origin: "purchase",
            realizedPnl: 0,
            lastUpdated: new Date(),
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        });
      }

      assetsAffected.push({
        assetId: String(id),
        uid: item.uid || undefined,
        quantityChange: qty,
        costBasisImpact: totalCost,
      });
    } else if (sale) {
      cashFlow += totalCost;
      const mac = assetDoc?.movingAverageCost ?? 0;
      const profit = (priceEach - mac) * qty;
      realizedPnl += profit;

      if (assetDoc) {
        const newQty = Math.max(0, assetDoc.quantity - qty);
        const newCostBasis = newQty * mac;

        await db.asset.update({
          where: { id: assetKey },
          data: {
            quantity: newQty,
            totalCostBasis: newCostBasis,
            realizedPnl: assetDoc.realizedPnl + profit,
            lastUpdated: new Date(),
            updatedAt: new Date(),
          },
        });
      }

      assetsAffected.push({
        assetId: String(id),
        uid: item.uid || undefined,
        quantityChange: -qty,
        costBasisImpact: -(mac * qty),
      });
    }
  }

  const logIdStr = String(log.id);
  const logTimestamp = new Date(log.timestamp * 1000);

  if (assetsAffected.length > 0 || cashFlow !== 0 || realizedPnl !== 0) {
    await db.ledgerEvent.upsert({
      where: { id: `ledger_ev_${logIdStr}` },
      update: {
        assetsAffected: assetsAffected as unknown as object,
        cashFlow,
        realizedPnl,
        updatedAt: new Date(),
      },
      create: {
        id: `ledger_ev_${logIdStr}`,
        logId: logIdStr,
        timestamp: logTimestamp,
        type: purchase ? "purchase" : "sale",
        categoryId: 5,
        transactionName: purchase ? "Item Purchase" : "Item Sale",
        assetsAffected: assetsAffected as unknown as object,
        cashFlow,
        realizedPnl,
        rawLog: log as unknown as object,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
  }
}

/**
 * 7. Transformation Sinks (Item use, booster packs, museum sets, crimes, drug consumption)
 */
export async function parseTransformationSink(log: UserLog): Promise<void> {
  if (!(await isLogValidForWealth(log.timestamp))) return;

  const data = (log.data as Record<string, any>) || {};
  const logId = Number(log.details.id);
  const category = String(log.details.category || "");

  let cashFlow = 0;
  let realizedPnl = 0;
  const assetsAffected: { assetId: string; uid?: number | string; quantityChange: number; costBasisImpact: number }[] = [];

  const burnAsset = async (id: string | number, qty: number, uid?: number | null): Promise<number> => {
    const isUid = !!(uid && typeof uid !== "boolean");
    const assetKey = isUid ? `uid_${uid}` : `item_${id}_inventory`;

    const existing = await db.asset.findUnique({ where: { id: assetKey } });
    const mac = existing?.movingAverageCost ?? 0;
    const burnedCost = mac * qty;

    if (existing) {
      const newQty = Math.max(0, existing.quantity - qty);
      const newCostBasis = newQty * mac;
      await db.asset.update({
        where: { id: assetKey },
        data: {
          quantity: newQty,
          totalCostBasis: newCostBasis,
          realizedPnl: existing.realizedPnl - burnedCost,
          lastUpdated: new Date(),
          updatedAt: new Date(),
        },
      });
    }

    assetsAffected.push({
      assetId: String(id),
      uid: uid || undefined,
      quantityChange: -qty,
      costBasisImpact: -burnedCost,
    });

    return burnedCost;
  };

  let totalLoss = 0;
  if (typeof data.item === "number") {
    totalLoss += await burnAsset(data.item, 1);
  }

  if (data.items_lost && typeof data.items_lost === "object") {
    for (const [k, v] of Object.entries(data.items_lost)) {
      totalLoss += await burnAsset(parseInt(k, 10), typeof v === "number" ? v : 1);
    }
  }

  if (data.money_lost) {
    cashFlow -= Number(data.money_lost);
    realizedPnl -= Number(data.money_lost);
  }

  if (data.money_gained) {
    cashFlow += Number(data.money_gained);
    realizedPnl += Number(data.money_gained);
  }

  const logIdStr = String(log.id);
  const logTimestamp = new Date(log.timestamp * 1000);

  if (assetsAffected.length > 0 || cashFlow !== 0 || realizedPnl !== 0) {
    await db.ledgerEvent.upsert({
      where: { id: `ledger_ev_${logIdStr}` },
      update: {
        assetsAffected: assetsAffected as unknown as object,
        cashFlow,
        realizedPnl,
        updatedAt: new Date(),
      },
      create: {
        id: `ledger_ev_${logIdStr}`,
        logId: logIdStr,
        timestamp: logTimestamp,
        type: realizedPnl > 0 ? "injection" : "sink",
        categoryId: 5,
        transactionName: category === "Crimes" ? "Crime Outcome" : "Transformation Sink",
        assetsAffected: assetsAffected as unknown as object,
        cashFlow,
        realizedPnl,
        rawLog: log as unknown as object,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
  }
}

/**
 * 8. Company Profit / Employee Wage Log Parsers
 */
export async function parseCompanyProfitLog(log: UserLog): Promise<void> {
  if (!(await isLogValidForWealth(log.timestamp))) return;

  const now = new Date();
  const startOfDayUtc = Math.floor(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) / 1000,
  );

  if (log.timestamp < startOfDayUtc) return;

  workerEvents.emit("company_pay_received");
}

export async function parseEmployeeProfitLog(log: UserLog): Promise<void> {
  if (!(await isLogValidForWealth(log.timestamp))) return;

  const data = (log.data as Record<string, any>) || {};
  const pay = Number(data.pay || 0);
  if (pay <= 0) return;

  const logIdStr = String(log.id);
  const logTimestamp = new Date(log.timestamp * 1000);

  await db.ledgerEvent.upsert({
    where: { id: `ledger_ev_${logIdStr}` },
    update: {
      cashFlow: pay,
      realizedPnl: pay,
      updatedAt: new Date(),
    },
    create: {
      id: `ledger_ev_${logIdStr}`,
      logId: logIdStr,
      timestamp: logTimestamp,
      type: "injection",
      categoryId: 9,
      transactionName: "Company Employee Wage",
      assetsAffected: [],
      cashFlow: pay,
      realizedPnl: pay,
      rawLog: log as unknown as object,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  });
}

/**
 * Initializes Wealth Engine:
 * Sets wealth_ledger_init anchor status after log backfill completes.
 */
async function runWealthLedgerInit(): Promise<void> {
  try {
    logger.info("Initializing Wealth Engine...");

    const backfillRecord = await db.systemState.findUnique({
      where: { id: "log_manager_backfill_progress" },
    });
    const backfillData = backfillRecord?.data as { status: string } | undefined;

    if (backfillData?.status !== "completed") {
      logger.warn("Log backfill is ongoing. Postponing Wealth Engine initialization.");
      return;
    }

    await db.systemState.upsert({
      where: { id: "wealth_ledger_init" },
      update: { init: true, data: { status: "completed" }, updatedAt: new Date() },
      create: { id: "wealth_ledger_init", init: true, data: { status: "completed" }, createdAt: new Date(), updatedAt: new Date() },
    });

    logger.info("Wealth Engine initialized successfully.");
  } catch (err) {
    logger.error("Failed to initialize Wealth Engine:", err);
  }
}

async function checkAndInitWealth(): Promise<void> {
  const initState = await db.systemState.findUnique({
    where: { id: "wealth_ledger_init" },
  });

  if (!initState || !initState.init) {
    await runWealthLedgerInit();
  }
}

/**
 * Registers real-time log listeners for wealth-related events.
 */
export function startWealthModule(_options?: WorkerStartOptions): void {
  checkAndInitWealth().catch((err) => logger.error("Error during wealth checkAndInit:", err));

  workerEvents.on("new_log", async (log: UserLog) => {
    const logCode = Number(log.details.id);

    if (logCode === 4430) {
      await parseBarterTrade(log);
    } else if (logCode === 6222) {
      await parseCompanyProfitLog(log);
    } else if (logCode === 6221) {
      await parseEmployeeProfitLog(log);
    } else if (EQUITY_LOG_IDS.includes(logCode)) {
      await parseEquityProperty(log);
    } else if (FACTION_LOG_IDS.includes(logCode)) {
      await parseFactionLiability(log);
    } else if (STORAGE_TRANSFER_LOG_IDS.includes(logCode)) {
      await parseStorageTransfer(log);
    } else if (ZERO_COST_LOG_IDS.includes(logCode)) {
      await parseZeroCostInjection(log);
    } else if ([1112, 1225, 4200, 4201, 5010, 4320, 1226, 1113, 4210, 4220, 5011, 4322].includes(logCode)) {
      await parseStandardCash(log);
    } else {
      await parseTransformationSink(log);
    }
  });

  workerEvents.on("log_backfill_completed", () => {
    checkAndInitWealth().catch((err) => logger.error("Error running Wealth init after backfill:", err));
  });
}
