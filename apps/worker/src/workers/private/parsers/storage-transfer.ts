import {
  TornSchema,
  Assets,
  LedgerEvents,
  AssetDocument,
} from "@sentinel/shared";
import { randomUUID } from "crypto";
import { AssetLocation } from "@sentinel/shared";

export function parseStorageTransfer(log: TornSchema<"UserLog">) {
  const logId = log.details.id;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data = log.data as any;

  let targetLocation: AssetLocation = "escrow";
  let sourceLocation: AssetLocation = "inventory";

  switch (logId) {
    case 1222: // Bazaar Add
      targetLocation = "bazaar";
      break;
    case 1302: // Display Add
      targetLocation = "display";
      break;
    case 4700: // Items Equip
      targetLocation = "equipped";
      break;
    case 4710: // Items Unequip
      sourceLocation = "equipped";
      targetLocation = "inventory";
      break;
    case 1403: // Dump Add
    case 1110: // Item Market Add
    case 4447: // Trade Add
    case 5000: // Points Market Add
    case 4300: // Auction Add
      targetLocation = "escrow";
      break;
    default: {
      // Fallback inference from title
      const title = log.details.title.toLowerCase();
      if (title.includes("equip")) targetLocation = "equipped";
      else if (title.includes("bazaar")) targetLocation = "bazaar";
      else if (title.includes("display")) targetLocation = "display";
      break;
    }
  }

  // Handle Item arrays
  const items = data.items || [];

  if (items.length === 0 && data.quantity && logId === 5000) {
    // Handling points market add (it uses quantity, not items array)
    items.push({ id: "points", qty: data.quantity });
  }

  if (items.length === 0) return;

  const assetsAffected: {
    asset_id: string | number;
    quantity_change: number;
    cost_basis_impact: number;
  }[] = [];

  for (const item of items) {
    const id = item.id;
    const uid = item.uid;
    const qty = item.qty || item.amount || 1;

    // We locate the existing asset in the source location
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let sourceQuery: any = {
      asset_id: id,
      location: sourceLocation,
      owner: "personal",
    };
    // Unique item handling
    let isUid = false;
    if (uid && typeof uid !== "boolean") {
      sourceQuery = { id: `uid_${uid}`, owner: "personal" };
      isUid = true;
    }

    const sourceAssets = Assets.find(sourceQuery);

    // Pick the most relevant source asset or use default if it wasn't tracked
    let sourceAsset: AssetDocument;
    if (sourceAssets.length > 0) {
      // If fungible, pick the first one not starting with uid_
      if (!isUid) {
        const fungibleSource = sourceAssets.find(
          (a: AssetDocument) => !a.id.startsWith("uid_"),
        );
        sourceAsset = fungibleSource || sourceAssets[0];
      } else {
        sourceAsset = sourceAssets[0];
      }
    } else {
      // If we don't have it in the ledger (e.g. legacy item we missed), we have a $0 cost basis fallback
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

    // Deduct from source
    sourceAsset.quantity = Math.max(0, sourceAsset.quantity - qty);
    sourceAsset.total_cost_basis = sourceAsset.quantity * mac;
    sourceAsset.last_updated = Date.now();
    Assets.update(sourceAsset);

    // Add to target
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let targetQuery: any = {
      asset_id: id,
      location: targetLocation,
      owner: "personal",
    };
    if (isUid) {
      targetQuery = { id: `uid_${uid}`, owner: "personal" };
    }

    const targetAssets = Assets.find(targetQuery);
    let targetAsset: AssetDocument;

    if (targetAssets.length > 0) {
      if (!isUid) {
        const fungibleTarget = targetAssets.find(
          (a: AssetDocument) => !a.id.startsWith("uid_"),
        );
        targetAsset = fungibleTarget || targetAssets[0];
      } else {
        targetAsset = targetAssets[0];
      }
    } else {
      targetAsset = {
        id: isUid
          ? `uid_${uid}`
          : `item_${id}_${targetLocation}_${randomUUID()}`,
        type: id === "points" ? "point" : "item",
        asset_id: id,
        quantity: 0,
        moving_average_cost: mac, // Keep identical cost basis per context.xml
        total_cost_basis: 0,
        location: targetLocation,
        owner: "personal",
        origin: sourceAsset.origin,
        realized_pnl: 0,
        last_updated: Date.now(),
      };
      Assets.insertOne(targetAsset);
    }

    targetAsset.quantity += qty;
    targetAsset.total_cost_basis += costImpact;
    // MAC remains the same unless merged with a different MAC
    targetAsset.moving_average_cost =
      targetAsset.total_cost_basis / targetAsset.quantity;
    targetAsset.last_updated = Date.now();
    targetAsset.location = targetLocation; // Ensure it's correctly placed (especially for uid updates)

    Assets.update(targetAsset);

    // Cost basis impact is 0 because we didn't gain/lose wealth, just moved it
    assetsAffected.push({
      asset_id: id,
      quantity_change: 0,
      cost_basis_impact: 0,
    });
  }

  LedgerEvents.insertOne({
    id: `ledger_ev_${log.id}`,
    log_id: log.id,
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
