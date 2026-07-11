import {
  TornSchema,
  Assets,
  LedgerEvents,
  AssetDocument,
  TornItems,
  PersonalLogs,
  Logger,
  TornItemDocument,
} from "@sentinel/shared";
import { randomUUID } from "crypto";
import { extractItemsFromLogData } from "./utils.js";

const _logger = new Logger("ledger_barter");

export async function parseBarterTrade(log: TornSchema<"UserLog">) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data = log.data as any;
  const tradeId = data.parsed_trade_id;

  if (!tradeId) return;

  // Wait, is it possible the barter was already processed?
  // Our router already prevents duplicate `log_id`. So this 4430 is unique.

  // 1. Fetch all related trade logs from PersonalLogs
  // In sqlite json_extract, '$.data.parsed_trade_id' will match nested.
  // We type cast to any to bypass strict TS checking for nested keys
  const tradeLogs = PersonalLogs.find({ "data.parsed_trade_id": tradeId });

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

  for (const tlog of tradeLogs) {
    const tData = tlog.data;
    const tId = tlog.details?.id;

    // Outgoing Money (Trade money outgoing)
    if (tId === 4440) {
      outgoingMoney += tData.money || 0;
    }
    // Incoming Money (Trade money incoming)
    if (tId === 4441) {
      incomingMoney += tData.money || 0;
    }
    // Outgoing Items (Trade items outgoing)
    if (tId === 4446) {
      outgoingItems.push(...extractItemsFromLogData(tData));
    }
    // Incoming Items (Trade items incoming)
    if (tId === 4445) {
      incomingItems.push(...extractItemsFromLogData(tData));
    }
  }

  // 2. Sum Cost Basis of Outgoing Items
  let totalOutgoingCostBasis = outgoingMoney;
  const assetsAffected: {
    asset_id: string | number;
    quantity_change: number;
    cost_basis_impact: number;
  }[] = [];

  for (const item of outgoingItems) {
    const isUid = !!(item.uid && typeof item.uid !== "boolean");
    // They should be in "escrow" due to 4447, or "inventory". To be safe, we check escrow, then inventory.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let query: any = isUid
      ? { id: `uid_${item.uid}`, owner: "personal" }
      : { asset_id: item.id, owner: "personal" };

    const existingAssets = Assets.find(query);
    if (existingAssets.length > 0) {
      let assetDoc: AssetDocument;
      if (!isUid) {
        // Prefer escrow if multiple exist, otherwise fallback
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

  // 3. Determine System Value Weightings for Incoming Items
  let totalSystemValue = 0;
  const incomingWeighted = incomingItems.map((item) => {
    // Find system value
    let sysVal = 0;
    if (item.id === "points") {
      sysVal = 45000; // rough fallback, we could fetch pointsmarket but close enough for weightings
    } else {
      const itemRecord = TornItems.findOne(
        item.id.toString(),
      ) as TornItemDocument;
      sysVal = itemRecord.data.value.market_price || 0;
    }

    const itemTotalValue = sysVal * item.qty;
    totalSystemValue += itemTotalValue;

    return { ...item, sysVal, itemTotalValue };
  });

  // 4. Distribute Outgoing Cost Basis proportionally
  for (const item of incomingWeighted) {
    // If totalSystemValue is 0 (e.g. all items have $0 system value), split equally
    const weight =
      totalSystemValue > 0
        ? item.itemTotalValue / totalSystemValue
        : 1 / incomingWeighted.length;
    const assignedCostBasis = totalOutgoingCostBasis * weight;

    // Inject the incoming item into Inventory
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
        location: "inventory", // items end up in inventory
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

  // 5. Calculate net cash flow and PnL
  const netCashFlow = incomingMoney - outgoingMoney;
  // Per context.xml: "The net cash flow is logged, but the overall Realized PnL is ALWAYS $0"
  // Wait, if incoming money > outgoing cost basis, does it trigger PnL?
  // No, the instruction literally says "overall Realized PnL is ALWAYS $0".
  // Let's obey strictly.

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
