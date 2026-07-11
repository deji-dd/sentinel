import {
  TornSchema,
  Assets,
  LedgerEvents,
  AssetDocument,
} from "@sentinel/shared";
import { randomUUID } from "crypto";
import { extractItemsFromLogData } from "./utils.js";

export async function parseZeroCostInjection(log: TornSchema<"UserLog">) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data = log.data as any;

  // Extract items gained
  const _itemsGained = extractItemsFromLogData(data);
  // Specifically ignore "items_lost" for zero-cost injection since this parser is only for gains.
  // Actually, extractItemsFromLogData grabs both items_gained and items_lost if we're not careful.
  // Let's filter manually if data.items_lost is present, but extractItemsFromLogData merged them.
  // We should probably filter out `items_lost` keys in the extraction, but since we know it's a zero-cost injection,
  // we will just process items. Wait, if a crime gives items_gained and items_lost, we need to handle both?
  // Usually crimes are either success (gain) or fail (lose).

  // Actually, we'll only look at `items_gained` or `item` or `items` that represent gains in this parser.
  const gainedItems: {
    id: string | number;
    qty: number;
    uid?: number | null;
  }[] = [];

  // Re-implementing a safer extraction for just gains
  if (data.items_gained && typeof data.items_gained === "object") {
    for (const [k, v] of Object.entries(data.items_gained)) {
      gainedItems.push({
        id: parseInt(k, 10),
        qty: typeof v === "number" ? v : 1,
      });
    }
  }
  // If no items_gained, use the standard extraction but ignore if it's a loss log
  if (gainedItems.length === 0 && !data.items_lost) {
    const extracted = extractItemsFromLogData(data);
    gainedItems.push(...extracted);
  }

  let cashFlow = 0;
  let realizedPnl = 0;
  const assetsAffected: {
    asset_id: string | number;
    quantity_change: number;
    cost_basis_impact: number;
  }[] = [];

  // Fiat Generation (Cash Income)
  if (data.money_gained) {
    cashFlow += data.money_gained;
    realizedPnl += data.money_gained;
  } else if (data.money) {
    // Some logs might just use `money`
    cashFlow += data.money;
    realizedPnl += data.money;
  }

  // Free Acquisition (Items)
  for (const item of gainedItems) {
    if (item.id === "points") continue; // handled above if any, but zero cost points are rare

    const isUid = !!(item.uid && typeof item.uid !== "boolean");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const query: any = isUid
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
        type: "item",
        asset_id: item.id,
        quantity: 0,
        moving_average_cost: 0,
        total_cost_basis: 0,
        location: "inventory",
        owner: "personal",
        origin: "zero_cost_injection",
        last_updated: Date.now(),
      };
      Assets.insertOne(assetDoc);
    }

    const qty = item.qty;

    // Inject at $0 cost basis
    assetDoc.quantity += qty;
    // Total cost basis stays EXACTLY the same, so MAC goes down!
    assetDoc.moving_average_cost =
      assetDoc.total_cost_basis / assetDoc.quantity;
    assetDoc.last_updated = Date.now();

    Assets.update(assetDoc);

    assetsAffected.push({
      asset_id: item.id,
      quantity_change: qty,
      cost_basis_impact: 0, // $0 impact
    });
  }

  if (assetsAffected.length > 0 || cashFlow !== 0) {
    LedgerEvents.insertOne({
      id: `ledger_ev_${log.id}`,
      log_id: log.id,
      timestamp: log.timestamp,
      type: "injection",
      category_id: 4,
      transaction_name: "Zero-Cost Injection",
      assets_affected: assetsAffected,
      cash_flow: cashFlow,
      realized_pnl: realizedPnl,
      raw_log: log,
    });
  }
}
