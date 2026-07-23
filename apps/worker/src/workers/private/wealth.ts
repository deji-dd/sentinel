import {
  TornSchema,
  Assets,
  LedgerEvents,
  AssetDocument,
  TornItems,
  PersonalLogs,
  TornItemDocument,
  Logger,
  tornApi,
  getWorkerApiKey,
  AssetLocation,
  CashHistory,
  SystemState,
  ApiKeyRotator,
  LogRouteMap,
  StrictUserLog,
  LedgerEventType,
  TransformationSinkData,
  LogDataRegistry,
  StandardCashData,
  UserState,
  UserStateDocument,
  CompanyDailyProfits,
  SystemStateDocument,
} from "@sentinel/shared";
import { randomUUID } from "crypto";
import { workerEvents } from "../../lib/event-bus.js";
import { runSequentialInit } from "../../lib/init-queue.js";
import type { WorkerStartOptions } from "../registry.js";

const WORKER_NAME = "wealth_module";
const logger = new Logger(WORKER_NAME);

// --- V2 ANCHOR SHIELD ---
let cachedAnchorTimestamp: number | null = null;

function getAnchorTimestamp(): number | null {
  if (cachedAnchorTimestamp) return cachedAnchorTimestamp;

  const state = SystemState.findOne("wealth_ledger_v2_init") as {
    init: boolean;
    timestamp: number;
  };

  if (state && state.init) {
    cachedAnchorTimestamp = state.timestamp;
    return cachedAnchorTimestamp;
  }

  return null;
}

// Reusable guard clause for all parsers
function isLogValidForWealth(logTimestamp: number): boolean {
  const anchor = getAnchorTimestamp();
  if (!anchor) return false; // Ledger not initialized yet
  if (logTimestamp < anchor) return false; // Historical log from before installation
  return true;
}

// --- Barter ---
function parseBarterTrade(log: StrictUserLog<4430>) {
  if (!isLogValidForWealth(log.timestamp)) return;

  const data = log.data;
  const tradeId = data.parsed_trade_id;

  if (!tradeId) return;

  const tradeLogs = PersonalLogs.find({
    "data.parsed_trade_id": tradeId,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);

  let outgoingMoney = 0;
  let incomingMoney = 0;
  const outgoingItems: {
    id: string | number;
    qty: number;
    uid?: number | null;
  }[] = [];
  const incomingItems: {
    id: string | number;
    qty: number;
    uid?: number | null;
  }[] = [];

  // --- V2 COMPLEX ASSET GUARD ---
  let requiresManualReview = false;
  let reviewReason = "";

  for (const tlog of tradeLogs) {
    const tData = tlog.data;
    const tId = tlog.details?.id;

    if (tId === 4440) outgoingMoney += tData.money || 0;
    if (tId === 4441) incomingMoney += tData.money || 0;

    // FIXED: 4445 is Outgoing, 4446 is Incoming
    if (tId === 4445) outgoingItems.push(...extractItemsFromLogData(tData));
    if (tId === 4446) incomingItems.push(...extractItemsFromLogData(tData));

    // GUARD: Properties (4450/4451), Companies (4475/4476)
    if (tId && [4450, 4451, 4475, 4476].includes(Number(tId))) {
      requiresManualReview = true;
      reviewReason = `Log ID ${tId}`;
    }
  }

  // --- HALT & FLAG FOR MANUAL REVIEW ---
  if (requiresManualReview) {
    logger.warn(
      `Barter ${tradeId} flagged for manual review due to complex assets (${reviewReason}).`,
    );

    // We insert a zero-impact ledger event with a flagged title so it shows up in your UI
    LedgerEvents.insertOne({
      id: `ledger_ev_${log.id}`,
      log_id: log.id,
      timestamp: log.timestamp,
      type: "barter",
      category_id: 6,
      transaction_name: "Barter Trade (MANUAL REVIEW REQUIRED)",
      assets_affected: [],
      cash_flow: 0,
      realized_pnl: 0,
      raw_log: log,
    });

    return; // Safely abort the cost-basis distribution
  }

  // --- STANDARD COST-BASIS DISTRIBUTION ---
  let totalOutgoingCostBasis = outgoingMoney;
  const assetsAffected: {
    asset_id: string | number;
    quantity_change: number;
    cost_basis_impact: number;
  }[] = [];

  for (const item of outgoingItems) {
    const isUid = !!(item.uid && typeof item.uid !== "boolean");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let query: any = isUid
      ? { id: `uid_${item.uid}`, owner: "personal" }
      : { asset_id: item.id, owner: "personal" };

    const existingAssets = Assets.find(query);
    if (existingAssets.length > 0) {
      let assetDoc: AssetDocument;
      if (!isUid) {
        const escrowDoc = existingAssets.find(
          (a: AssetDocument) =>
            a.location === "escrow" && !a.id.startsWith("uid_"),
        );
        const invDoc = existingAssets.find(
          (a: AssetDocument) => !a.id.startsWith("uid_"),
        );
        assetDoc = escrowDoc || invDoc || existingAssets[0];
      } else {
        assetDoc = existingAssets[0];
      }

      const mac = assetDoc.moving_average_cost;
      const burnedCost = mac * item.qty;
      totalOutgoingCostBasis += burnedCost;

      assetDoc.quantity = Math.max(0, assetDoc.quantity - item.qty);
      assetDoc.total_cost_basis = assetDoc.quantity * mac;
      assetDoc.last_updated = Date.now();
      Assets.update(assetDoc);

      assetsAffected.push({
        asset_id: item.id,
        quantity_change: -item.qty,
        cost_basis_impact: -burnedCost,
      });
    }
  }

  let totalSystemValue = 0;
  const incomingWeighted = incomingItems.map((item) => {
    let sysVal = 0;

    if (item.id === "points") {
      // Fetch the dynamic points market average from the daily reference sync
      const pointState = SystemState.findOne("points_price") as
        | { price: number }
        | undefined;
      sysVal = pointState?.price || 30000;
    } else {
      const itemRecord = TornItems.findOne(
        item.id.toString(),
      ) as TornItemDocument;
      sysVal = itemRecord?.data?.value?.market_price || 0;
    }

    const itemTotalValue = sysVal * item.qty;
    totalSystemValue += itemTotalValue;

    return { ...item, sysVal, itemTotalValue };
  });

  for (const item of incomingWeighted) {
    const weight =
      totalSystemValue > 0
        ? item.itemTotalValue / totalSystemValue
        : 1 / incomingWeighted.length;
    const assignedCostBasis = totalOutgoingCostBasis * weight;

    const isUid = !!(item.uid && typeof item.uid !== "boolean");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let query: any = isUid
      ? { id: `uid_${item.uid}`, owner: "personal" }
      : { asset_id: item.id, location: "inventory", owner: "personal" };

    const existingAssets = Assets.find(query);
    let assetDoc: AssetDocument;

    if (existingAssets.length > 0) {
      if (!isUid) {
        const fungible = existingAssets.find(
          (a: AssetDocument) => !a.id.startsWith("uid_"),
        );
        assetDoc = fungible || existingAssets[0];
      } else {
        assetDoc = existingAssets[0];
      }
    } else {
      assetDoc = {
        id: isUid
          ? `uid_${item.uid}`
          : `item_${item.id}_inventory_${randomUUID()}`,
        type: item.id === "points" ? "point" : "item",
        asset_id: item.id,
        quantity: 0,
        moving_average_cost: 0,
        total_cost_basis: 0,
        location: "inventory",
        owner: "personal",
        origin: "barter",
        realized_pnl: 0,
        last_updated: Date.now(),
      };
      Assets.insertOne(assetDoc);
    }

    assetDoc.quantity += item.qty;
    assetDoc.total_cost_basis += assignedCostBasis;
    assetDoc.moving_average_cost =
      assetDoc.total_cost_basis / assetDoc.quantity;
    assetDoc.last_updated = Date.now();
    Assets.update(assetDoc);

    assetsAffected.push({
      asset_id: item.id,
      quantity_change: item.qty,
      cost_basis_impact: assignedCostBasis,
    });
  }

  const netCashFlow = incomingMoney - outgoingMoney;

  if (assetsAffected.length > 0 || netCashFlow !== 0) {
    LedgerEvents.insertOne({
      id: `ledger_ev_${log.id}`,
      log_id: log.id,
      timestamp: log.timestamp,
      type: "barter",
      category_id: 6,
      transaction_name: "Barter Trade",
      assets_affected: assetsAffected,
      cash_flow: netCashFlow,
      realized_pnl: 0,
      raw_log: log,
    });
  }
}

// --- Company Profit ---
function parseCompanyProfitLog(log: StrictUserLog<6222>) {
  if (!isLogValidForWealth(log.timestamp)) return;

  // --- V2 RECENCY GUARD ---
  // Only ring the alarm for logs that occurred after 00:00 UTC today
  const now = new Date();
  const startOfDayUtc = Math.floor(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) / 1000,
  );

  if (log.timestamp < startOfDayUtc) return;

  // Ring the alarm clock on the event bus
  workerEvents.emit("company_pay_received");
}

// --- Employee Profit ---
function parseEmployeeProfitLog(log: StrictUserLog<6221>) {
  if (!isLogValidForWealth(log.timestamp)) return;

  const pay = log.data.pay;

  // If your company doesn't pay you, there is no wealth impact
  if (!pay || pay <= 0) return;

  LedgerEvents.insertOne({
    id: `ledger_ev_${log.id}`,
    log_id: log.id,
    timestamp: log.timestamp,
    type: "injection",
    category_id: 9, // Category 9 matches Equities & Companies
    transaction_name: "Company Employee Wage",
    assets_affected: [],
    cash_flow: pay,
    realized_pnl: pay, // Pure profit directly into your net worth
    raw_log: log,
  });
}

// --- Equities ---
type EquityLogIds =
  | 5510
  | 5511
  | 5927
  | 5928
  | 5920
  | 5900
  | 6280
  | 6300
  | 6284
  | 6285
  | 6290
  | 6291
  | 6292;

function parseEquityProperty(log: StrictUserLog<EquityLogIds>) {
  if (!isLogValidForWealth(log.timestamp)) return;

  const logId = log.details.id;

  let cashFlow = 0;
  let realizedPnl = 0;
  const assetsAffected: {
    asset_id: string | number;
    quantity_change: number;
    cost_basis_impact: number;
  }[] = [];

  // 1. Strict Intent Mapping
  const isBuy = [5510, 5927, 6280].includes(logId);
  const isSell = [5511, 5928, 6300].includes(logId);
  const isUpkeep = [5920, 5900, 6290, 6291, 6292].includes(logId);
  const isTransfer = [6284, 6285].includes(logId);

  // 2. Data Extraction Dictionary
  let assetType: "stock" | "property" | "company";
  let assetId: string = "";
  let qty = 1;
  let cost = 0;

  if ([5510, 5511].includes(logId)) {
    const data = log.data as LogDataRegistry[5510 | 5511];
    assetType = "stock";
    assetId = `stock_${data.stock}`;
    qty = data.amount || 1;

    // Deduct fees on sale to calculate accurate Net Cash Flow
    const fees = data.fees || 0;
    cost = isSell ? data.worth - fees : data.worth;

    if (isSell && data.profit !== undefined) realizedPnl += data.profit;
  } else if ([5927, 5928, 5920, 5900].includes(logId)) {
    const data = log.data as LogDataRegistry[5927 | 5928 | 5920 | 5900];
    assetType = "property";
    assetId = `property_${data.property || data.property_id}`;
    qty = 1;
    cost = data.cost || data.upkeep_paid || 0;
  } else {
    const data = log.data as LogDataRegistry[
      | 6280
      | 6300
      | 6284
      | 6285
      | 6290
      | 6291
      | 6292];
    assetType = "company";
    assetId = `company_${data.company}`;
    qty = 1;
    cost =
      data.cost || data.deposited || data.withdrawn || data.sale_value || 0;
  }

  if (!assetId || assetId.includes("undefined")) return;

  // 3. Financial Logic (Unchanged and mathematically sound)
  if (isUpkeep) {
    cashFlow -= cost;
    realizedPnl -= cost;
  } else if (isTransfer) {
    // 6284 is Deposit (Cash flows OUT of wallet), 6285 is Withdraw (Cash flows IN)
    cashFlow = logId === 6285 ? cost : -cost;
    assetsAffected.push({
      asset_id: assetId,
      quantity_change: 0,
      cost_basis_impact: -cashFlow,
    });
  } else if (isBuy) {
    cashFlow -= cost;

    const existingAssets = Assets.find({
      asset_id: assetId,
      owner: "personal",
    });
    let assetDoc: AssetDocument =
      existingAssets.length > 0
        ? existingAssets[0]
        : {
            id: `equity_${assetId}_${randomUUID()}`,
            type: assetType,
            asset_id: assetId,
            quantity: 0,
            moving_average_cost: 0,
            total_cost_basis: 0,
            location: "portfolio",
            owner: "personal",
            origin: "purchase",
            realized_pnl: 0,
            last_updated: Date.now(),
          };

    if (existingAssets.length === 0) Assets.insertOne(assetDoc);

    const oldTotalCost = assetDoc.total_cost_basis;
    assetDoc.quantity += qty;
    assetDoc.total_cost_basis = oldTotalCost + cost;
    assetDoc.moving_average_cost =
      assetDoc.total_cost_basis / assetDoc.quantity;
    assetDoc.last_updated = Date.now();

    Assets.update(assetDoc);

    assetsAffected.push({
      asset_id: assetId,
      quantity_change: qty,
      cost_basis_impact: cost,
    });
  } else if (isSell) {
    const data = log.data as LogDataRegistry[5511 | 5928 | 6300];
    const profit =
      "profit" in data && typeof data.profit === "number"
        ? data.profit
        : undefined;
    cashFlow += cost;

    const existingAssets = Assets.find({
      asset_id: assetId,
      owner: "personal",
    });
    if (existingAssets.length > 0) {
      const assetDoc = existingAssets[0];
      const mac = assetDoc.moving_average_cost;

      let calculatedProfit = 0;
      if (profit === undefined) {
        const costBasis = mac * qty;
        calculatedProfit = cost - costBasis;
        realizedPnl += calculatedProfit;
      }

      assetDoc.quantity = Math.max(0, assetDoc.quantity - qty);
      assetDoc.total_cost_basis = assetDoc.quantity * mac;
      assetDoc.realized_pnl =
        (assetDoc.realized_pnl || 0) +
        (profit !== undefined ? profit : calculatedProfit);
      assetDoc.last_updated = Date.now();

      Assets.update(assetDoc);

      assetsAffected.push({
        asset_id: assetId,
        quantity_change: -qty,
        cost_basis_impact: -(mac * qty),
      });
    } else {
      if (profit === undefined) realizedPnl += cost;
    }
  }

  if (assetsAffected.length > 0 || cashFlow !== 0 || realizedPnl !== 0) {
    let eventType: LedgerEventType = isBuy
      ? "purchase"
      : isSell
        ? "sale"
        : "loss";
    if (isTransfer) eventType = "storage_transfer";

    LedgerEvents.insertOne({
      id: `ledger_ev_${log.id}`,
      log_id: log.id,
      log_type: log.details.id, // <-- V2 Tweak Included
      timestamp: log.timestamp,
      type: eventType,
      category_id: 9,
      transaction_name: "Equity/Property Transaction",
      assets_affected: assetsAffected,
      cash_flow: cashFlow,
      realized_pnl: realizedPnl,
      raw_log: log,
    });
  }
}

// --- Faction ---
function parseFactionLiability(log: StrictUserLog<6746 | 6747 | 6728>) {
  if (!isLogValidForWealth(log.timestamp)) return;

  const data = log.data;
  const logId = log.details.id;

  const items = extractItemsFromLogData(data);
  const assetsAffected: {
    asset_id: string | number;
    uid?: number | string; // <-- Added UID tracking
    quantity_change: number;
    cost_basis_impact: number;
  }[] = [];

  for (const item of items) {
    const isUid = !!(item.uid && typeof item.uid !== "boolean");
    const assetIdQuery = isUid
      ? { id: `uid_${item.uid}` }
      : { asset_id: item.id };

    // --- LOAN RECEIVE (6746) ---
    if (logId === 6746) {
      const owner: "faction" | "personal" = "faction";
      const query = { ...assetIdQuery, owner };
      const existingAssets = Assets.find(query);
      let assetDoc: AssetDocument;

      if (existingAssets.length > 0) {
        assetDoc = isUid
          ? existingAssets[0]
          : existingAssets.find(
              (a: AssetDocument) => !a.id.startsWith("uid_"),
            ) || existingAssets[0];
      } else {
        assetDoc = {
          id: isUid
            ? `uid_${item.uid}`
            : `item_${item.id}_inventory_${randomUUID()}`,
          type: "item",
          asset_id: item.id,
          quantity: 0,
          moving_average_cost: 0,
          total_cost_basis: 0,
          location: "inventory",
          owner: "faction",
          origin: "faction_loan",
          realized_pnl: 0,
          last_updated: Date.now(),
        };
        Assets.insertOne(assetDoc);
      }

      assetDoc.quantity += item.qty;
      assetDoc.last_updated = Date.now();
      Assets.update(assetDoc);

      assetsAffected.push({
        asset_id: item.id,
        uid: item.uid || undefined,
        quantity_change: item.qty,
        cost_basis_impact: 0, // Zero cost basis for borrowed items
      });
    }

    // --- LOAN RETURN (6747) OR DEPOSIT (6728) ---
    else if (logId === 6747 || logId === 6728) {
      let remainingToBurn = item.qty;

      // Step 1: Drain Faction-Owned Assets First
      const factionOwner: "faction" | "personal" = "faction";
      const factionQuery = { ...assetIdQuery, owner: factionOwner };
      const factionAssets = Assets.find(factionQuery);

      if (factionAssets.length > 0) {
        let assetDoc: AssetDocument = isUid
          ? factionAssets[0]
          : factionAssets.find(
              (a: AssetDocument) => !a.id.startsWith("uid_"),
            ) || factionAssets[0];

        const burnQty = Math.min(assetDoc.quantity, remainingToBurn);

        if (burnQty > 0) {
          assetDoc.quantity -= burnQty;
          assetDoc.last_updated = Date.now();
          Assets.update(assetDoc);

          assetsAffected.push({
            asset_id: item.id,
            uid: item.uid || undefined,
            quantity_change: -burnQty,
            cost_basis_impact: 0,
          });

          remainingToBurn -= burnQty;
        }
      }

      // Step 2: Burn Remainder from Personal Assets
      if (remainingToBurn > 0) {
        const personalOwner: "faction" | "personal" = "personal";
        const personalQuery = { ...assetIdQuery, owner: personalOwner };
        const personalAssets = Assets.find(personalQuery);

        if (personalAssets.length > 0) {
          let assetDoc: AssetDocument = isUid
            ? personalAssets[0]
            : personalAssets.find(
                (a: AssetDocument) => !a.id.startsWith("uid_"),
              ) || personalAssets[0];

          const mac = assetDoc.moving_average_cost;
          const costImpact = mac * remainingToBurn;

          assetDoc.quantity = Math.max(0, assetDoc.quantity - remainingToBurn);
          assetDoc.total_cost_basis = assetDoc.quantity * mac;
          assetDoc.realized_pnl = (assetDoc.realized_pnl || 0) - costImpact;
          assetDoc.last_updated = Date.now();
          Assets.update(assetDoc);

          assetsAffected.push({
            asset_id: item.id,
            uid: item.uid || undefined,
            quantity_change: -remainingToBurn,
            cost_basis_impact: -costImpact, // This constitutes a realized loss
          });
        }
      }
    }
  }

  // Calculate Realized PnL (Negative cost_basis_impact = Personal Loss)
  let realizedPnl = 0;
  for (const affect of assetsAffected) {
    if (affect.cost_basis_impact < 0) {
      realizedPnl += affect.cost_basis_impact;
    }
  }

  if (assetsAffected.length > 0) {
    LedgerEvents.insertOne({
      id: `ledger_ev_${log.id}`,
      log_id: log.id,
      log_type: logId, // <-- Added Log Type
      timestamp: log.timestamp,
      type: logId === 6746 ? "injection" : "sink",
      category_id: 7,
      transaction_name:
        logId === 6746
          ? "Faction Loan Received"
          : "Faction Item Returned/Deposited",
      assets_affected: assetsAffected,
      cash_flow: 0,
      realized_pnl: realizedPnl,
      raw_log: log,
    });
  }
}

// --- Sinks ---
// Define the specific items that make up Museum Sets to ensure accurate burning
const MUSEUM_SETS: Record<string, number[]> = {
  "Plushie Set": [
    186, 187, 215, 258, 261, 266, 268, 269, 273, 274, 281, 384, 618,
  ],
  "Flower Set": [260, 263, 264, 267, 271, 272, 276, 277, 282, 385, 617],
  "Medieval Coins": [770, 771, 772],
  "Quran Script": [773, 774],
  "Senet Board": [775, 776, 777],
  "Shabti Sculpture": [778, 779, 780],
  Amulet: [781, 782, 783],
};

function parseTransformationSink(log: TornSchema<"UserLog">) {
  if (!isLogValidForWealth(log.timestamp)) return;

  const data = log.data as TransformationSinkData;
  const logId = log.details.id;
  const category = log.details.category || "";

  let cashFlow = 0;
  let realizedPnl = 0;
  const assetsAffected: {
    asset_id: string | number;
    uid?: number | string;
    quantity_change: number;
    cost_basis_impact: number;
  }[] = [];

  // --- HELPER: Burn Asset (V2 Patched) ---
  const burnAsset = (id: string | number, qty: number, uid?: number | null) => {
    let burnedCostBasis = 0;
    const isUid = !!(uid && typeof uid !== "boolean");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const query: any = isUid
      ? { id: `uid_${uid}`, owner: "personal" }
      : { asset_id: id, owner: "personal" };

    const existingAssets = Assets.find(query);
    let assetDoc: AssetDocument;

    if (existingAssets.length > 0) {
      assetDoc = isUid
        ? existingAssets[0]
        : existingAssets.find((a: AssetDocument) => !a.id.startsWith("uid_")) ||
          existingAssets[0];
    } else {
      // FIX 1: Safely handle untracked assets to ensure the burn is permanently logged
      assetDoc = {
        id: isUid ? `uid_${uid}` : `item_${id}_inventory_${randomUUID()}`,
        type: id === "points" ? "point" : "item",
        asset_id: id,
        quantity: 0, // Starts at 0, goes negative
        moving_average_cost: 0,
        total_cost_basis: 0,
        location: "inventory",
        owner: "personal",
        origin: "unknown",
        realized_pnl: 0,
        last_updated: Date.now(),
      };
      Assets.insertOne(assetDoc);
    }

    const mac = assetDoc.moving_average_cost;
    const totalBurnedCost = mac * qty;
    burnedCostBasis = totalBurnedCost;

    assetDoc.quantity = Math.max(0, assetDoc.quantity - qty);
    assetDoc.total_cost_basis = assetDoc.quantity * mac;
    assetDoc.realized_pnl = (assetDoc.realized_pnl || 0) - totalBurnedCost;
    assetDoc.last_updated = Date.now();
    Assets.update(assetDoc);

    assetsAffected.push({
      asset_id: id,
      uid: uid || undefined,
      quantity_change: -qty,
      cost_basis_impact: -totalBurnedCost,
    });

    return burnedCostBasis;
  };

  // --- HELPER: Inject Asset ---
  const injectAssetWithCost = (
    id: string | number,
    qty: number,
    costBasis: number,
    uid?: number | null,
  ) => {
    const isUid = !!(uid && typeof uid !== "boolean");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const query: any = isUid
      ? { id: `uid_${uid}`, owner: "personal" }
      : { asset_id: id, location: "inventory", owner: "personal" };

    const existingAssets = Assets.find(query);
    let assetDoc: AssetDocument;

    if (existingAssets.length > 0) {
      assetDoc = isUid
        ? existingAssets[0]
        : existingAssets.find((a: AssetDocument) => !a.id.startsWith("uid_")) ||
          existingAssets[0];
    } else {
      assetDoc = {
        id: isUid ? `uid_${uid}` : `item_${id}_inventory_${randomUUID()}`,
        type: id === "points" ? "point" : "item",
        asset_id: id,
        quantity: 0,
        moving_average_cost: 0,
        total_cost_basis: 0,
        location: "inventory",
        owner: "personal",
        origin: "transformation",
        realized_pnl: 0,
        last_updated: Date.now(),
      };
      Assets.insertOne(assetDoc);
    }

    assetDoc.quantity += qty;
    assetDoc.total_cost_basis += costBasis;
    assetDoc.moving_average_cost =
      assetDoc.total_cost_basis / assetDoc.quantity;
    assetDoc.last_updated = Date.now();
    Assets.update(assetDoc);

    assetsAffected.push({
      asset_id: id,
      uid: uid || undefined,
      quantity_change: qty,
      cost_basis_impact: costBasis,
    });
  };

  // 1. The Museum (Log 7000 - V2 Patched)
  if (logId === 7000) {
    const setName = data.set;
    const setQty = data.quantity || 1;
    let totalSetCostBasis = 0;

    // FIX 2: Burn the underlying plushies/flowers to prevent wealth inflation
    if (setName && MUSEUM_SETS[setName]) {
      for (const itemId of MUSEUM_SETS[setName]) {
        totalSetCostBasis += burnAsset(itemId, setQty);
      }
    }

    if (data.points_received) {
      // Transfer the entire cost basis of the plushies directly into the points
      injectAssetWithCost("points", data.points_received, totalSetCostBasis);
    }
  }
  // 2. All Other Sinks (Item Use, Crimes, Faction Deposits, Money Sends)
  else {
    const fromFaction =
      typeof data.faction === "number" ? data.faction > 0 : !!data.faction;
    let totalLoss = 0;

    // Direct items burned
    if (!fromFaction && typeof data.item === "number") {
      totalLoss += burnAsset(data.item, 1);
    }

    // items_lost object
    if (data.items_lost && typeof data.items_lost === "object") {
      for (const [k, v] of Object.entries(data.items_lost)) {
        totalLoss += burnAsset(parseInt(k, 10), typeof v === "number" ? v : 1);
      }
    }

    // Cash / Point Sinks (losses - V2 Patched)
    // FIX 3: Check explicitly for lost/used flags to avoid burning points you just gained
    if (!fromFaction) {
      if (data.points_lost) totalLoss += burnAsset("points", data.points_lost);
      else if (data.points_used)
        totalLoss += burnAsset("points", data.points_used);
      else if (data.points && category === "Points building")
        totalLoss += burnAsset("points", data.points);
    }

    if (data.money_lost) {
      cashFlow -= data.money_lost;
      realizedPnl -= data.money_lost;
    } else if (
      data.money &&
      !category.startsWith("Item use") &&
      category !== "Crimes"
    ) {
      cashFlow -= data.money;
      realizedPnl -= data.money;
    }

    // Handle GAINS
    const gained: { id: string | number; qty: number; uid?: number | null }[] =
      [];
    if (data.items_gained && typeof data.items_gained === "object") {
      for (const [k, v] of Object.entries(data.items_gained)) {
        gained.push({
          id: parseInt(k, 10),
          qty: typeof v === "number" ? v : 1,
        });
      }
    } else if (Array.isArray(data.items)) {
      for (const it of data.items) {
        if (it && it.id)
          gained.push({ id: it.id, qty: it.qty || 1, uid: it.uid });
      }
    }

    if (gained.length > 0) {
      // --- V2: PROPORTIONAL COST DISTRIBUTION ---
      let totalSystemValue = 0;
      const gainedWeighted = gained.map((item) => {
        let sysVal = 0;
        if (item.id === "points") {
          const pointState = SystemState.findOne("points_price") as
            | { price: number }
            | undefined;
          sysVal = pointState?.price || 45000;
        } else {
          const itemRecord = TornItems.findOne(
            item.id.toString(),
          ) as TornItemDocument;
          sysVal = itemRecord?.data?.value?.market_price || 0;
        }
        const itemTotalValue = sysVal * item.qty;
        totalSystemValue += itemTotalValue;
        return { ...item, sysVal, itemTotalValue };
      });

      for (const item of gainedWeighted) {
        const weight =
          totalSystemValue > 0
            ? item.itemTotalValue / totalSystemValue
            : 1 / gainedWeighted.length;
        const assignedCostBasis = totalLoss * weight;
        injectAssetWithCost(item.id, item.qty, assignedCostBasis, item.uid);
      }
    } else {
      // Pure loss
      realizedPnl -= totalLoss;
    }

    // Cash Gains
    if (data.money_gained) {
      cashFlow += data.money_gained;
      realizedPnl += data.money_gained;
    } else if (
      data.money &&
      (category.startsWith("Item use") || category === "Crimes")
    ) {
      cashFlow += data.money;
      realizedPnl += data.money;
    }

    if (assetsAffected.length === 0 && cashFlow === 0 && realizedPnl === 0)
      return;
  }

  // --- DISPATCH LEDGER EVENT ---
  if (assetsAffected.length > 0 || cashFlow !== 0 || realizedPnl !== 0) {
    let type: LedgerEventType = "sink";
    if (realizedPnl > 0) type = "injection";
    else if (realizedPnl === 0 && assetsAffected.length > 0) type = "barter";

    LedgerEvents.insertOne({
      id: `ledger_ev_${log.id}`,
      log_id: log.id,
      log_type: logId,
      timestamp: log.timestamp,
      type,
      category_id: 5,
      transaction_name:
        category === "Crimes" ? "Crime Result" : "Asset Transformation & Sink",
      assets_affected: assetsAffected,
      cash_flow: cashFlow,
      realized_pnl: realizedPnl,
      raw_log: log,
    });
  }
}

const SINK_LOG_IDS = [
  7000,
  5970,
  4800,
  6726,
  6727,
  // Add all Item Use IDs (2010 to 2621, 8981 to 8989)
  ...Array.from({ length: 2621 - 2010 + 1 }, (_, i) => i + 2010),
  ...Array.from({ length: 8989 - 8981 + 1 }, (_, i) => i + 8981),
  // Add all Points Building IDs (4900 to 4978)
  ...Array.from({ length: 4978 - 4900 + 1 }, (_, i) => i + 4900),
  // Add all Crime IDs (5700 to 5735, 9005 to 9362)
  ...Array.from({ length: 5735 - 5700 + 1 }, (_, i) => i + 5700),
  ...Array.from({ length: 9362 - 9005 + 1 }, (_, i) => i + 9005),
];

// --- Standard Cash ---
type StandardCashLogIds =
  | 1112
  | 1225
  | 4200
  | 4201
  | 5010
  | 4320
  | 1226
  | 1113
  | 4210
  | 4220
  | 5011
  | 4322;

function parseStandardCash(log: StrictUserLog<StandardCashLogIds>) {
  if (!isLogValidForWealth(log.timestamp)) return;

  const logId = log.details.id;
  const data = log.data as StandardCashData;

  const purchaseIds = [1112, 1225, 4200, 4201, 5010, 4320];
  const saleIds = [1226, 1113, 4210, 4220, 5011, 4322];

  const purchase = purchaseIds.includes(logId);
  const sale = saleIds.includes(logId);

  if (!purchase && !sale) return;

  let items = data.items || [];

  // Safely handle Torn's chaotic `item` formats
  if (items.length === 0 && data.item) {
    if (Array.isArray(data.item)) {
      items = data.item;
    } else if (typeof data.item === "number") {
      items = [{ id: data.item, uid: null, qty: data.quantity || 1 }];
    }
  }

  let cashFlow = 0;
  let realizedPnl = 0;
  const assetsAffected: {
    asset_id: string | number;
    uid?: number | string; // <-- V2 Tweak Included
    quantity_change: number;
    cost_basis_impact: number;
  }[] = [];

  // --- 1. PROCESS ITEMS ---
  for (const item of items) {
    const id = item.id;
    const qty = item.qty || 1;

    // Safely cascade through the new pricing fields
    let totalCost =
      data.final_price ?? data.cost_total ?? data.total_value ?? 0;
    let priceEach = data.cost_each ?? data.value_each ?? 0;

    // Resolve whichever half of the equation Torn failed to provide
    if (totalCost === 0 && priceEach > 0) totalCost = priceEach * qty;
    if (priceEach === 0 && totalCost > 0) priceEach = totalCost / qty;

    let assetDoc: AssetDocument | undefined;
    let isUid = false;
    let isNewAsset = false;

    if (item.uid && typeof item.uid !== "boolean") {
      isUid = true;
      const existingAsset = Assets.findOne(
        `uid_${item.uid}`,
      ) as AssetDocument | null;
      if (existingAsset && existingAsset.owner === "personal") {
        assetDoc = existingAsset;
      }
    }

    const existingAssets = Assets.find({ asset_id: id, owner: "personal" });

    if (!isUid || !assetDoc) {
      const fungibles = existingAssets.filter(
        (a: AssetDocument) => !a.id.startsWith("uid_"),
      );

      fungibles.sort((a, b) => {
        const locationPriority = {
          bazaar: 1,
          escrow: 2,
          display: 3,
          inventory: 4,
          portfolio: 5,
          equipped: 6,
          vault: 7,
        };
        const pA =
          locationPriority[a.location as keyof typeof locationPriority] || 99;
        const pB =
          locationPriority[b.location as keyof typeof locationPriority] || 99;

        if (pA !== pB) {
          if (sale) return pA - pB;
          const invA = a.location === "inventory" ? 1 : 2;
          const invB = b.location === "inventory" ? 1 : 2;
          return invA - invB;
        }
        return b.quantity - a.quantity;
      });

      if (fungibles.length > 0) assetDoc = fungibles[0];
    }

    if (!assetDoc) {
      isNewAsset = true;
      assetDoc = {
        id: isUid ? `uid_${item.uid}` : `item_${id}_inventory_${randomUUID()}`,
        type: "item",
        asset_id: id,
        quantity: 0,
        moving_average_cost: 0,
        total_cost_basis: 0,
        location: "inventory",
        owner: "personal",
        origin: "purchase",
        realized_pnl: 0,
        last_updated: Date.now(),
      };
    }

    if (purchase) {
      const oldTotalCost = assetDoc.total_cost_basis;
      assetDoc.quantity += qty;
      assetDoc.total_cost_basis = oldTotalCost + totalCost;
      assetDoc.moving_average_cost =
        assetDoc.total_cost_basis / assetDoc.quantity;

      cashFlow -= totalCost;
      assetsAffected.push({
        asset_id: id,
        uid: item.uid || undefined,
        quantity_change: qty,
        cost_basis_impact: totalCost,
      });
    } else if (sale) {
      const costBasis = assetDoc.moving_average_cost;
      const profit = (priceEach - costBasis) * qty;

      realizedPnl += profit;
      assetDoc.realized_pnl = (assetDoc.realized_pnl || 0) + profit;
      cashFlow += totalCost;

      assetDoc.quantity = Math.max(0, assetDoc.quantity - qty);
      assetDoc.total_cost_basis =
        assetDoc.quantity * assetDoc.moving_average_cost;

      assetsAffected.push({
        asset_id: id,
        uid: item.uid || undefined,
        quantity_change: -qty,
        cost_basis_impact: -(costBasis * qty),
      });
    }

    if (isNewAsset) Assets.insertOne(assetDoc);
    else Assets.update(assetDoc);
  }

  // --- 2. PROCESS POINTS ---
  const isPointsTransaction = [5010, 5011, 4220].includes(logId);

  if (isPointsTransaction) {
    const qty = data.quantity || 1;
    const totalCost = data.cost_total || 0;
    const priceEach = totalCost / qty;

    const existingAssets = Assets.find({
      asset_id: "points",
      owner: "personal",
    });
    let isNewAsset = false;
    let assetDoc: AssetDocument;

    if (existingAssets.length > 0) {
      assetDoc = existingAssets[0];
    } else {
      isNewAsset = true;
      assetDoc = {
        id: `points_personal_${randomUUID()}`,
        type: "point",
        asset_id: "points",
        quantity: 0,
        moving_average_cost: 0,
        total_cost_basis: 0,
        location: "inventory",
        owner: "personal",
        origin: "purchase",
        realized_pnl: 0,
        last_updated: Date.now(),
      };
    }

    if (purchase) {
      const oldTotalCost = assetDoc.total_cost_basis;
      assetDoc.quantity += qty;
      assetDoc.total_cost_basis = oldTotalCost + totalCost;
      assetDoc.moving_average_cost =
        assetDoc.total_cost_basis / assetDoc.quantity;

      cashFlow -= totalCost;
      assetsAffected.push({
        asset_id: "points",
        quantity_change: qty,
        cost_basis_impact: totalCost,
      });
    } else if (sale) {
      const profit = (priceEach - assetDoc.moving_average_cost) * qty;
      realizedPnl += profit;
      assetDoc.realized_pnl = (assetDoc.realized_pnl || 0) + profit;
      cashFlow += totalCost;

      assetDoc.quantity = Math.max(0, assetDoc.quantity - qty);
      assetDoc.total_cost_basis =
        assetDoc.quantity * assetDoc.moving_average_cost;

      assetsAffected.push({
        asset_id: "points",
        quantity_change: -qty,
        cost_basis_impact: -(assetDoc.moving_average_cost * qty),
      });
    }

    if (isNewAsset) Assets.insertOne(assetDoc);
    else Assets.update(assetDoc);
  }

  // --- 3. DISPATCH LEDGER EVENT ---
  if (assetsAffected.length > 0 || cashFlow !== 0 || realizedPnl !== 0) {
    LedgerEvents.insertOne({
      id: `ledger_ev_${log.id}`,
      log_id: log.id,
      log_type: logId, // <-- V2 Tweak Included
      timestamp: log.timestamp,
      type: purchase ? "purchase" : "sale",
      category_id: 2,
      transaction_name: purchase ? "Asset Purchase" : "Asset Sale",
      assets_affected: assetsAffected,
      cash_flow: cashFlow,
      realized_pnl: realizedPnl,
      raw_log: log,
    });
  }
}

// --- Storage Transfers ---
type StorageTransferLogIds =
  | 1222
  | 1223
  | 1302
  | 1303
  | 1403
  | 1110
  | 1111
  | 4447
  | 4448
  | 5000
  | 5001
  | 4300;

function parseStorageTransfer(log: StrictUserLog<StorageTransferLogIds>) {
  if (!isLogValidForWealth(log.timestamp)) return;

  const logId = log.details.id;
  const data = log.data;

  let sourceLocation: AssetLocation = "inventory";
  let targetLocation: AssetLocation = "inventory";

  // --- 1. STRICT DIRECTIONAL ROUTING ---
  const TO_BAZAAR = [1222];
  const FROM_BAZAAR = [1223];
  const TO_DISPLAY = [1302];
  const FROM_DISPLAY = [1303];
  const TO_ESCROW = [1403, 1110, 4447, 5000, 4300];
  const FROM_ESCROW = [1111, 4448, 5001];

  if (TO_BAZAAR.includes(logId)) targetLocation = "bazaar";
  else if (FROM_BAZAAR.includes(logId)) sourceLocation = "bazaar";
  else if (TO_DISPLAY.includes(logId)) targetLocation = "display";
  else if (FROM_DISPLAY.includes(logId)) sourceLocation = "display";
  else if (TO_ESCROW.includes(logId)) targetLocation = "escrow";
  else if (FROM_ESCROW.includes(logId)) sourceLocation = "escrow";
  else return; // Safety boundary

  // --- 2. EXTRACT ITEMS ---
  let items = data.items || [];

  // Safely handle Torn occasionally using `item` as the array key
  if (items.length === 0 && data.item && Array.isArray(data.item)) {
    items = data.item;
  }

  // Handle Points Market which strictly uses `quantity`
  if (items.length === 0 && data.quantity && [5000, 5001].includes(logId)) {
    items.push({ id: "points", uid: null, qty: data.quantity });
  }

  if (items.length === 0) return;

  const assetsAffected: {
    asset_id: string | number;
    uid?: number | string; // <-- V2 Tweak Included
    quantity_change: number;
    cost_basis_impact: number;
  }[] = [];

  // --- 3. EXECUTE TRANSFER ---
  for (const item of items) {
    const id = item.id;
    const uid = item.uid;
    const qty = item.qty || 1;
    const isUid = !!(uid && typeof uid !== "boolean");

    // Retrieve Source Asset
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sourceQuery: any = isUid
      ? { id: `uid_${uid}`, owner: "personal" }
      : { asset_id: id, location: sourceLocation, owner: "personal" };
    const sourceAssets = Assets.find(sourceQuery);
    let sourceAsset: AssetDocument;

    if (sourceAssets.length > 0) {
      sourceAsset = isUid
        ? sourceAssets[0]
        : sourceAssets.find((a: AssetDocument) => !a.id.startsWith("uid_")) ||
          sourceAssets[0];
    } else {
      sourceAsset = {
        id: isUid
          ? `uid_${uid}`
          : `item_${id}_${sourceLocation}_${randomUUID()}`,
        type: id === "points" ? "point" : "item",
        asset_id: id,
        quantity: qty,
        moving_average_cost: 0,
        total_cost_basis: 0,
        location: sourceLocation,
        owner: "personal",
        origin: "unknown",
        realized_pnl: 0,
        last_updated: Date.now(),
      };
      Assets.insertOne(sourceAsset);
    }

    const mac = sourceAsset.moving_average_cost;
    const costImpact = mac * qty;

    // Deduct from Source
    sourceAsset.quantity = Math.max(0, sourceAsset.quantity - qty);
    sourceAsset.total_cost_basis = sourceAsset.quantity * mac;
    sourceAsset.last_updated = Date.now();
    Assets.update(sourceAsset);

    // Retrieve or Create Target Asset
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const targetQuery: any = isUid
      ? { id: `uid_${uid}`, owner: "personal" }
      : { asset_id: id, location: targetLocation, owner: "personal" };
    const targetAssets = Assets.find(targetQuery);
    let targetAsset: AssetDocument;

    if (targetAssets.length > 0) {
      targetAsset = isUid
        ? targetAssets[0]
        : targetAssets.find((a: AssetDocument) => !a.id.startsWith("uid_")) ||
          targetAssets[0];
    } else {
      targetAsset = {
        id: isUid
          ? `uid_${uid}`
          : `item_${id}_${targetLocation}_${randomUUID()}`,
        type: id === "points" ? "point" : "item",
        asset_id: id,
        quantity: 0,
        moving_average_cost: mac,
        total_cost_basis: 0,
        location: targetLocation,
        owner: "personal",
        origin: sourceAsset.origin,
        realized_pnl: 0,
        last_updated: Date.now(),
      };
      Assets.insertOne(targetAsset);
    }

    // Add to Target
    targetAsset.quantity += qty;
    targetAsset.total_cost_basis += costImpact;
    targetAsset.moving_average_cost =
      targetAsset.total_cost_basis / targetAsset.quantity;
    targetAsset.last_updated = Date.now();
    targetAsset.location = targetLocation; // Ensure location is rigidly enforced for UIDs
    Assets.update(targetAsset);

    assetsAffected.push({
      asset_id: id,
      uid: uid || undefined, // <-- V2 Tweak Included
      quantity_change: 0, // Net quantity change across your entire net worth is 0
      cost_basis_impact: 0, // Net cost impact across your net worth is 0
    });
  }

  LedgerEvents.insertOne({
    id: `ledger_ev_${log.id}`,
    log_id: log.id,
    log_type: logId, // <-- V2 Tweak Included
    timestamp: log.timestamp,
    type: "storage_transfer",
    category_id: 3,
    transaction_name: "Asset Storage Transfer",
    assets_affected: assetsAffected,
    cash_flow: 0,
    realized_pnl: 0,
    raw_log: log,
  });
}

// Utility to normalize wildly varying item structures from Torn Logs
type GenericItemPayload = {
  items?: {
    id: number | string;
    qty?: number;
    amount?: number;
    uid?: number | null;
  }[];
  item?:
    | number
    | Record<string, number>
    | {
        id: number | string;
        qty?: number;
        amount?: number;
        uid?: number | null;
      }[];
  quantity?: number;
  points?: number;
};

function extractItemsFromLogData(data: GenericItemPayload): {
  id: string | number;
  qty: number;
  uid?: number | null;
}[] {
  const result: { id: string | number; qty: number; uid?: number | null }[] =
    [];

  // Helper: Parse Arrays (Handles `data.items` and `data.item` arrays)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const parseArray = (arr: any[]) => {
    for (const item of arr) {
      if (item && item.id) {
        result.push({
          id: item.id,
          qty: item.qty || item.amount || 1,
          uid: item.uid || null,
        });
      }
    }
  };

  // Helper: Parse Objects (Handles Stock special items: {"3": 1})
  const parseObject = (obj: Record<string, number>) => {
    for (const [key, value] of Object.entries(obj)) {
      const id = parseInt(key, 10);
      const qty = typeof value === "number" ? value : 1;
      if (!isNaN(id)) {
        result.push({ id, qty });
      }
    }
  };

  // 1. data.items (Standard purchases, bazaar adds, trades)
  if (Array.isArray(data.items)) parseArray(data.items);

  // 2. data.item (Faction gives, sometimes Torn just uses `item` as an array)
  if (Array.isArray(data.item)) parseArray(data.item);

  // 3. data.item object (Stock special items)
  if (data.item && typeof data.item === "object" && !Array.isArray(data.item)) {
    parseObject(data.item as Record<string, number>);
  }

  // 4. data.item number (City finds)
  if (typeof data.item === "number") {
    result.push({ id: data.item, qty: data.quantity || 1 });
  }

  // 5. Points
  if (data.points && typeof data.points === "number") {
    result.push({ id: "points", qty: data.points });
  }

  return result;
}

// --- Zero cost ---
type ZeroCostLogIds = 7011 | 8374 | 8375 | 8377 | 8378 | 1404 | 5575;

function parseZeroCostInjection(log: StrictUserLog<ZeroCostLogIds>) {
  if (!isLogValidForWealth(log.timestamp)) return;

  const logId = log.details.id;
  const data = log.data;

  // Use an extended internal type so we can route properties to the right location
  const gainedItems: {
    id: string | number;
    qty: number;
    uid?: number | null;
    isProperty?: boolean;
  }[] = [];

  gainedItems.push(...extractItemsFromLogData(data as GenericItemPayload));

  if (data.first_item) gainedItems.push({ id: data.first_item, qty: 1 });
  if (data.second_item) gainedItems.push({ id: data.second_item, qty: 1 });

  // 3. Extract Zero-Cost Properties (e.g. winning a PI)
  if (data.property)
    gainedItems.push({
      id: `property_${data.property}`,
      qty: 1,
      isProperty: true,
    });

  let cashFlow = 0;
  let realizedPnl = 0;
  const assetsAffected: {
    asset_id: string | number;
    uid?: number | string;
    quantity_change: number;
    cost_basis_impact: number;
  }[] = [];

  // --- FIAT GENERATION (Pure Profit) ---
  if (data.money) {
    cashFlow += data.money;
    realizedPnl += data.money;
  }

  // --- ASSET INJECTION (MAC Dilution) ---
  for (const item of gainedItems) {
    const isUid = !!(item.uid && typeof item.uid !== "boolean");
    const targetLocation: AssetLocation = item.isProperty
      ? "portfolio"
      : "inventory";

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const query: any = isUid
      ? { id: `uid_${item.uid}`, owner: "personal" }
      : { asset_id: item.id, location: targetLocation, owner: "personal" };

    const existingAssets = Assets.find(query);
    let assetDoc: AssetDocument;
    let isNewAsset = false;

    if (existingAssets.length > 0) {
      assetDoc = isUid
        ? existingAssets[0]
        : existingAssets.find((a: AssetDocument) => !a.id.startsWith("uid_")) ||
          existingAssets[0];
    } else {
      isNewAsset = true;
      let assetType: "item" | "point" | "property" = "item";
      if (item.id === "points") assetType = "point";
      if (item.isProperty) assetType = "property";

      assetDoc = {
        id: isUid
          ? `uid_${item.uid}`
          : `asset_${item.id}_${targetLocation}_${randomUUID()}`,
        type: assetType,
        asset_id: item.id,
        quantity: 0,
        moving_average_cost: 0,
        total_cost_basis: 0,
        location: targetLocation,
        owner: "personal",
        origin: "zero_cost_injection",
        realized_pnl: 0,
        last_updated: Date.now(),
      };
    }

    const qty = item.qty;

    // Inject at $0 cost basis, mathematically diluting the MAC
    assetDoc.quantity += qty;
    assetDoc.moving_average_cost =
      assetDoc.total_cost_basis / assetDoc.quantity;
    assetDoc.last_updated = Date.now();

    if (isNewAsset) Assets.insertOne(assetDoc);
    else Assets.update(assetDoc);

    assetsAffected.push({
      asset_id: item.id,
      uid: item.uid || undefined,
      quantity_change: qty,
      cost_basis_impact: 0, // $0 impact
    });
  }

  // --- DISPATCH LEDGER EVENT ---
  if (assetsAffected.length > 0 || cashFlow !== 0) {
    LedgerEvents.insertOne({
      id: `ledger_ev_${log.id}`,
      log_id: log.id,
      log_type: logId,
      timestamp: log.timestamp,
      type: "injection",
      category_id: 4,
      transaction_name: "Free Asset Acquisition",
      assets_affected: assetsAffected,
      cash_flow: cashFlow,
      realized_pnl: realizedPnl,
      raw_log: log,
    });
  }
}

const ZERO_COST_IDS = [7011, 8374, 8375, 8377, 8378, 1404, 5575];

// --- Liquid cash sync ---
function executeLiquidCashEngine(): void {
  try {
    const liveState = UserState.findOne("live_state") as Extract<
      UserStateDocument,
      { id: "live_state" }
    >;
    const money = liveState?.money;

    if (!money) {
      logger.warn(
        "Skipping liquid cash sync: No money data in local UserState yet.",
      );
      return;
    }

    let withdrawableCorporateCash = 0;

    if (money.company > 0) {
      try {
        // 2. Read the latest Company Profile locally (No API Call!)
        // This relies on the daily sync we built in the Company module
        const latestCompanyProfits = CompanyDailyProfits.find({});

        if (latestCompanyProfits.length > 0) {
          // Sort to get the most recent entry
          latestCompanyProfits.sort((a, b) => b.timestamp - a.timestamp);
          const latest = latestCompanyProfits[0];

          const profile = latest.profile;
          const employees = latest.employees || [];

          const dailyAdCost = profile?.advertisement_budget || 0;
          let employeesWage = 0;
          for (const employee of employees) {
            employeesWage += employee.wage || 0;
          }

          const weeklyBurn = (employeesWage + dailyAdCost) * 7;
          withdrawableCorporateCash = Math.max(0, money.company - weeklyBurn);
        } else {
          // Fallback if no company data has been synced yet
          withdrawableCorporateCash = money.company;
        }
      } catch (error) {
        withdrawableCorporateCash = money.company;
        logger.error(
          "Failed to calculate withdrawable corporate cash from local DB",
          error,
        );
      }
    }

    // 3. Calculate Total Liquidity
    const totalLiquidity =
      (money.wallet || 0) +
      (money.vault || 0) +
      (money.faction?.money || 0) + // Ensure you handle the nested faction object safely
      withdrawableCorporateCash;

    // 4. Upsert into CashHistory (Chronological Snapshot)
    const now = new Date();
    now.setUTCHours(0, 0, 0, 0);
    const startOfDayUtc = Math.floor(now.getTime() / 1000);

    const snapshotDoc = {
      id: startOfDayUtc.toString(),
      timestamp: startOfDayUtc,
      liquid_cash: totalLiquidity,
    };

    CashHistory.update(snapshotDoc);

    logger.info(`Total liquidity: ${totalLiquidity}`);
  } catch (error) {
    logger.error("Failed to run offline liquid cash engine:", error);
  }
}

// --- Init ---
type UserResponse = TornSchema<"UserMoneyResponse"> & {
  bazaar?: {
    ID: number;
    UID?: number;
    name: string;
    type: string;
    quantity: number;
    price: number;
    market_price: number;
  }[];
  display?: {
    ID: number;
    UID?: number;
    name: string;
    type: string;
    quantity: number;
    market_price: number;
  }[];
};

// Unified internal type to handle Torn's capitalization chaos
type InitItem = {
  id: number;
  uid?: number | null;
  qty: number;
};

/**
 * Initializes the ledger by fetching a baseline of assets if the database is empty.
 * This satisfies Category 1: The Initialization (Day Zero)
 */
async function runWealthLedgerInit(): Promise<void> {
  const time = performance.now();
  logger.warn("Initializing Wealth Ledger V2");

  try {
    const apiKey = getWorkerApiKey("personal");
    if (!apiKey) throw new Error("No personal API key found");

    // 1. Wipe previous state for a clean slate
    Assets.deleteManyBy({});
    LedgerEvents.deleteManyBy({});
    CashHistory.deleteManyBy({});

    // 2. Fetch Baseline Data
    const userRes = (await tornApi.get("/user", {
      apiKey,
      queryParams: { selections: ["bazaar", "money", "display"] },
    })) as unknown as UserResponse;

    const bazaar = userRes.bazaar || [];
    const display = userRes.display || [];
    const moneyData = userRes.money;
    const pointsCount = moneyData?.points || 0;

    // 3. Fetch Points Market for accurate MAC
    // 3. Fetch Points Market for accurate MAC (Read from local VWAP state)
    let pointCost = 30000; // Safe fallback
    try {
      const pointState = SystemState.findOne("points_price") as Extract<
        SystemStateDocument,
        { id: "points_price" }
      >;

      if (pointState && pointState.price > 0) {
        pointCost = pointState.price;
      }
    } catch {
      logger.warn(
        "Failed to read points_price from SystemState, defaulting to 30k fallback",
      );
    }

    // 4. Fetch Inventory via Rotator
    const categories: string[] = [
      "Collectible",
      "Clothing",
      "Other",
      "Tool",
      "Melee",
      "Defensive",
      "Material",
      "Car",
      "Primary",
      "Secondary",
      "Book",
      "Special",
      "Supply Pack",
      "Temporary",
      "Enhancer",
      "Artifact",
      "Flower",
      "Booster",
      "Medical",
      "Candy",
      "Jewelry",
      "Alcohol",
      "Plushie",
      "Drug",
      "Energy Drink",
    ];

    let inventory: TornSchema<"UserInventoryItem">[] = [];
    const rotator = new ApiKeyRotator([apiKey]);

    await rotator.processSequential(
      categories,
      async (cat, key) => {
        try {
          const invRes = (await tornApi.get("/user/inventory", {
            apiKey: key,
            queryParams: { cat, limit: 250 },
          })) as TornSchema<"UserInventoryResponse">;

          if (invRes.inventory?.items) {
            inventory = inventory.concat(invRes.inventory.items);
          }
        } catch {
          // Expected for empty categories
        }
      },
      1000,
    );

    let totalInitWealth = 0; // Track total value for the initial ledger event

    // --- V2 HELPER: Type-Safe Insertion ---
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const insertItems = (rawItems: any[], location: AssetLocation) => {
      for (const raw of rawItems) {
        // Normalize Torn's chaotic casing
        const item: InitItem = {
          id: raw.id || raw.ID,
          uid: raw.uid || raw.UID,
          qty: raw.amount || raw.quantity || 1,
        };

        const itemRecord = TornItems.findOne(
          item.id.toString(),
        ) as TornItemDocument;
        const systemValue = itemRecord?.data?.value?.market_price || 0;
        const costBasis = systemValue || 0;

        totalInitWealth += costBasis * item.qty;

        if (item.uid) {
          Assets.insertOne({
            id: `uid_${item.uid}`,
            type: "item",
            asset_id: item.id,
            quantity: 1,
            moving_average_cost: costBasis,
            total_cost_basis: costBasis,
            location, // V2 FIX: Removed 'equipped' override
            owner: "personal",
            origin: "legacy_init",
            realized_pnl: 0,
            last_updated: Date.now(),
          });
        } else {
          const existing = Assets.find({ asset_id: item.id, location });
          const matched = existing.find(
            (a: AssetDocument) => !a.id.startsWith("uid_"),
          );

          if (matched) {
            matched.quantity += item.qty;
            matched.total_cost_basis =
              matched.quantity * matched.moving_average_cost;
            Assets.update(matched);
          } else {
            Assets.insertOne({
              id: `item_${item.id}_${location}_${randomUUID()}`,
              type: "item",
              asset_id: item.id,
              quantity: item.qty,
              moving_average_cost: costBasis,
              total_cost_basis: costBasis * item.qty,
              location,
              owner: "personal",
              origin: "legacy_init",
              realized_pnl: 0,
              last_updated: Date.now(),
            });
          }
        }
      }
    };

    // 5. Execute Insertions
    insertItems(inventory, "inventory");
    insertItems(bazaar, "bazaar");
    insertItems(display, "display");

    if (pointsCount > 0) {
      totalInitWealth += pointsCount * pointCost;
      Assets.insertOne({
        id: `points_personal_${randomUUID()}`,
        type: "point",
        asset_id: "points",
        quantity: pointsCount,
        moving_average_cost: pointCost,
        total_cost_basis: pointsCount * pointCost,
        location: "inventory",
        owner: "personal",
        origin: "legacy_init",
        realized_pnl: 0,
        last_updated: Date.now(),
      });
    }

    // 6. Write Initial Ledger Event
    // Gives the UI a beautiful starting point showing exactly how much net worth was imported
    LedgerEvents.insertOne({
      id: `ledger_ev_init_${Date.now()}`,
      log_id: "init",
      timestamp: Math.floor(Date.now() / 1000),
      type: "init",
      category_id: 1,
      transaction_name: "Ledger Initialization",
      assets_affected: [],
      cash_flow: moneyData?.wallet || 0, // Initial wallet cash
      realized_pnl: totalInitWealth, // Treat imported legacy items as initial "profit" baseline
      raw_log: { note: "Day Zero Sync" },
    });

    // 8. Update System State Flags
    const nowTimestamp = Math.floor(Date.now() / 1000);
    SystemState.update({
      id: "wealth_ledger_v2_init",
      timestamp: nowTimestamp,
      init: true,
    });

    cachedAnchorTimestamp = nowTimestamp;

    logger.info(
      `Successfully initialized wealth ledger. Baseline value imported: $${totalInitWealth} in ${(performance.now() - time) / 1000}ms`,
    );
  } catch (error) {
    logger.error("Failed to initialize ledger baseline:", error);
    SystemState.update({
      id: "wealth_ledger_v2_init",
      init: false,
      timestamp: Date.now(),
    });
  }
}

// Listen for the init trigger from the API
workerEvents.on("wealth_init", runWealthLedgerInit);

// Listen for the heal trigger from the API
workerEvents.on("wealth_heal", async () => {
  const { healLedger } = await import("../../scripts/heal-ledger.js");
  await healLedger();
});

workerEvents.on("live_state_updated", executeLiquidCashEngine);

export const WEALTH_LOG_ROUTES: LogRouteMap = {
  1110: [parseStorageTransfer],
  1113: [parseStandardCash],
  1222: [parseStorageTransfer],
  1226: [parseStandardCash],
  1302: [parseStorageTransfer],
  1403: [parseStorageTransfer],
  4210: [parseStandardCash],
  4220: [parseStandardCash],
  4300: [parseStorageTransfer],
  4320: [parseStandardCash],
  4322: [parseStandardCash],
  4430: [parseBarterTrade],
  4447: [parseStorageTransfer],
  5000: [parseStorageTransfer],
  5010: [parseStandardCash],
  5011: [parseStandardCash],
  5510: [parseEquityProperty],
  5511: [parseEquityProperty],
  5900: [parseEquityProperty],
  5920: [parseEquityProperty],
  5927: [parseEquityProperty],
  5928: [parseEquityProperty],
  6221: [parseEmployeeProfitLog],
  6222: [parseCompanyProfitLog],
  6280: [parseEquityProperty],
  6284: [parseEquityProperty],
  6285: [parseEquityProperty],
  6290: [parseEquityProperty],
  6291: [parseEquityProperty],
  6292: [parseEquityProperty],
  6300: [parseEquityProperty],
  6728: [parseFactionLiability],
  6746: [parseFactionLiability],
  6747: [parseFactionLiability],
  1112: [parseStandardCash],
  1225: [parseStandardCash],
  4200: [parseStandardCash],
  4201: [parseStandardCash],
};

SINK_LOG_IDS.forEach((id) => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const routeMap = WEALTH_LOG_ROUTES as Record<number, any>;

  if (!routeMap[id]) routeMap[id] = [];
  routeMap[id].push(parseTransformationSink);
});

ZERO_COST_IDS.forEach((id) => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const routeMap = WEALTH_LOG_ROUTES as Record<number, any>;
  if (!routeMap[id]) routeMap[id] = [];
  routeMap[id].push(parseZeroCostInjection);
});

function checkAndInit() {
  // 1. Check if the master engine is currently pulling history
  const backfillState = SystemState.findOne("log_manager_backfill_progress") as
    | Extract<SystemStateDocument, { id: "log_manager_backfill_progress" }>
    | undefined;

  if (!backfillState || backfillState.status !== "completed") {
    logger.warn(
      "Log backfill is ongoing or incomplete. Postponing Wealth module initialization.",
    );
    return;
  }

  // 2. Check if this specific module has completed its V2 initialization
  const initState = SystemState.findOne("wealth_ledger_v2_init");
  if (!initState) {
    runSequentialInit("wealth_init", runWealthLedgerInit);
  }
}

export function startWealthModule(_options?: WorkerStartOptions): void {
  // Attempt to boot immediately
  checkAndInit();

  // Listen for the master engine to broadcast completion, then attempt boot again
  workerEvents.on("log_backfill_completed", () => {
    checkAndInit();
  });
}
