import {
  TornSchema,
  Assets,
  LedgerEvents,
  AssetDocument,
} from "@sentinel/shared";
import { randomUUID } from "crypto";

export async function parseEquityProperty(log: TornSchema<"UserLog">) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data = log.data as any;
  const _logId = log.details.id;
  const title = log.details.title.toLowerCase();
  const category = log.details.category;

  let cashFlow = 0;
  let realizedPnl = 0;
  const assetsAffected: {
    asset_id: string | number;
    quantity_change: number;
    cost_basis_impact: number;
  }[] = [];

  // Identify if purchase or sale
  const isBuy =
    title.includes("buy") ||
    title.includes("invest") ||
    title.includes("deposit");
  const isSell = title.includes("sell") || title.includes("withdraw");
  const isUpkeep =
    title.includes("upkeep") ||
    title.includes("fee") ||
    title.includes("upgrade");

  let assetType = "equity";
  let assetId: string | number = "";
  let qty = 1;
  let cost = 0;

  // Stocks
  if (category === "Stocks") {
    assetType = "stock";
    assetId = `stock_${data.stock || data.stock_id}`;
    qty = data.amount || data.shares || 1;
    cost = data.worth || data.cost || data.total_cost || 0;

    // Torn nicely includes "profit" in stock sell logs!
    if (isSell && data.profit !== undefined) {
      realizedPnl += data.profit;
    }
  }
  // Property
  else if (category === "Property") {
    assetType = "property";
    assetId = `property_${data.property || data.property_id}`;
    qty = 1;
    cost = data.cost || data.upkeep_paid || data.worth || data.money || 0;
  }
  // Company
  else if (category === "Company") {
    assetType = "company";
    assetId = `company_${data.company || data.company_id}`;
    qty = 1;
    cost =
      data.cost ||
      data.withdrawn ||
      data.deposited ||
      data.amount ||
      data.money ||
      0;
  }

  if (
    !assetId ||
    assetId === "stock_undefined" ||
    assetId === "property_undefined" ||
    assetId === "company_undefined"
  ) {
    return; // Cannot parse asset identity reliably
  }

  if (isUpkeep) {
    // Pure expense (Realized Loss)
    cashFlow -= cost;
    realizedPnl -= cost;
  } else if (isBuy) {
    // Treat cash spent as locked equity
    cashFlow -= cost;

    const existingAssets = Assets.find({
      asset_id: assetId,
      owner: "personal",
    });
    let assetDoc: AssetDocument;

    if (existingAssets.length > 0) {
      assetDoc = existingAssets[0];
    } else {
      assetDoc = {
        id: `equity_${assetId}_${randomUUID()}`,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        type: assetType as any,
        asset_id: assetId,
        quantity: 0,
        moving_average_cost: 0,
        total_cost_basis: 0,
        location: "portfolio",
        owner: "personal",
        origin: "purchase",
        last_updated: Date.now(),
      };
      Assets.insertOne(assetDoc);
    }

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
    cashFlow += cost;

    const existingAssets = Assets.find({
      asset_id: assetId,
      owner: "personal",
    });
    if (existingAssets.length > 0) {
      const assetDoc = existingAssets[0];
      const mac = assetDoc.moving_average_cost;

      // If Torn didn't provide profit, calculate it ourselves based on MAC
      if (data.profit === undefined) {
        const costBasis = mac * qty;
        const profit = cost - costBasis;
        realizedPnl += profit;
      }

      assetDoc.quantity = Math.max(0, assetDoc.quantity - qty);
      assetDoc.total_cost_basis = assetDoc.quantity * mac;
      assetDoc.last_updated = Date.now();
      Assets.update(assetDoc);

      assetsAffected.push({
        asset_id: assetId,
        quantity_change: -qty,
        cost_basis_impact: -(mac * qty),
      });
    } else {
      // Selling something we don't have tracked. Assume 100% profit (0 cost basis)
      if (data.profit === undefined) {
        realizedPnl += cost;
      }
    }
  }

  if (assetsAffected.length > 0 || cashFlow !== 0 || realizedPnl !== 0) {
    LedgerEvents.insertOne({
      id: `ledger_ev_${log.id}`,
      log_id: log.id,
      timestamp: log.timestamp,
      type: isBuy ? "purchase" : isSell ? "sale" : "loss",
      category_id: 9,
      transaction_name: "Equity/Property Transaction",
      assets_affected: assetsAffected,
      cash_flow: cashFlow,
      realized_pnl: realizedPnl,
      raw_log: log,
    });
  }
}
