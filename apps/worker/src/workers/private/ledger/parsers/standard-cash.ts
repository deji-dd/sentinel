import {
  TornSchema,
  Assets,
  LedgerEvents,
  AssetDocument,
} from "@sentinel/shared";
import { randomUUID } from "crypto";

export async function parseStandardCashTransaction(log: TornSchema<"UserLog">) {
  const logId = log.details.id;
  const isPurchase = [1112, 1225, 4200, 4201, 5010, 4320].includes(logId);
  const isSale = [1226, 1113, 4210, 4220, 5011, 4322].includes(logId);

  // Fallbacks based on string title/category if log types change
  const title = log.details.title.toLowerCase();
  const _category = log.details.category;

  const purchase =
    isPurchase || title.includes("buy") || title.includes("bought");
  const sale = isSale || title.includes("sell") || title.includes("sold");

  if (!purchase && !sale) return; // Not a recognized cash transaction

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data = log.data as any;
  const items = data.items || [];

  // If the log is for points, the API structure might vary (e.g. data.points, data.cost_total)
  // We'll handle items first.
  let cashFlow = 0;
  let realizedPnl = 0;
  const assetsAffected: {
    asset_id: string | number;
    quantity_change: number;
    cost_basis_impact: number;
  }[] = [];

  for (const item of items) {
    const id = item.id;
    const qty = item.qty || 1;
    // Some logs provide cost_each, others don't
    const priceEach =
      data.cost_each || (data.cost_total ? data.cost_total / qty : 0);
    const totalCost = priceEach * qty;

    // Find asset
    // We assume purchases go to inventory, sales come from bazaar/market.
    // For exact tracking, we query by asset_id and personal owner. If multiple exist, we just merge or pick the primary pool.
    const existingAssets = Assets.find({ asset_id: id, owner: "personal" });
    const matchedAsset = existingAssets.find(
      (a: AssetDocument) => !a.id.startsWith("uid_"),
    );
    let assetDoc: AssetDocument;

    if (matchedAsset) {
      assetDoc = matchedAsset;
    } else {
      assetDoc = {
        id: `item_${id}_inventory_${randomUUID()}`,
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
        quantity_change: qty,
        cost_basis_impact: totalCost,
      });
    } else if (sale) {
      // Calculate PnL
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
        quantity_change: -qty,
        cost_basis_impact: -(costBasis * qty),
      });
    }

    if (matchedAsset) {
      Assets.update(assetDoc);
    } else {
      Assets.insertOne(assetDoc);
    }
  }

  // Handle Points bought/sold
  const isPointsTransaction = title.includes("points") || logId === 5010 || logId === 5011;
  if (isPointsTransaction || data.points) {
    const qty = data.points || data.quantity || 1;
    const totalCost = data.cost || data.total_cost || data.cost_total || 0;
    const priceEach = totalCost / qty;

    const existingAssets = Assets.find({
      asset_id: "points",
      owner: "personal",
    });
    let assetDoc: AssetDocument =
      existingAssets.length > 0
        ? existingAssets[0]
        : {
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

    if (existingAssets.length > 0) {
      Assets.update(assetDoc);
    } else {
      Assets.insertOne(assetDoc);
    }
  }

  // Insert Ledger Event
  LedgerEvents.insertOne({
    id: `ledger_ev_${log.id}`,
    log_id: log.id,
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
