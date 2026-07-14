import {
  TornSchema,
  Assets,
  LedgerEvents,
  AssetDocument,
} from "@sentinel/shared";
import { randomUUID } from "crypto";

export function parseTransformationSink(log: TornSchema<"UserLog">) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data = log.data as any;
  const logId = log.details.id;
  const category = log.details.category;

  let cashFlow = 0;
  let realizedPnl = 0;
  const assetsAffected: {
    asset_id: string | number;
    quantity_change: number;
    cost_basis_impact: number;
  }[] = [];

  // Helper to burn an asset and return its cost basis
  const burnAsset = (id: string | number, qty: number, uid?: number | null) => {
    let burnedCostBasis = 0;
    const isUid = !!(uid && typeof uid !== "boolean");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const query: any = isUid
      ? { id: `uid_${uid}`, owner: "personal" }
      : { asset_id: id, owner: "personal" };

    const existingAssets = Assets.find(query);
    if (existingAssets.length > 0) {
      let assetDoc: AssetDocument;
      if (!isUid) {
        const fungible = existingAssets.find(
          (a: AssetDocument) => !a.id.startsWith("uid_"),
        );
        assetDoc = fungible || existingAssets[0];
      } else {
        assetDoc = existingAssets[0];
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
        quantity_change: -qty,
        cost_basis_impact: -totalBurnedCost,
      });
    }
    return burnedCostBasis;
  };

  // Helper to inject an asset with a specific cost basis
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
      quantity_change: qty,
      cost_basis_impact: costBasis,
    });
  };

  // 1. The Museum (Log 7000)
  if (logId === 7000 || category === "Museum") {
    // e.g. {"set":"Shabti Sculpture","quantity":1,"points_received":500}
    // We don't have the exact items burned in data sometimes. But wait, museum sets have a fixed number of items.
    // If the data doesn't list the items burned, we'd have to map the set name to items.
    // For now, if we can't burn exact items, we just add points at 0 cost basis (zero-cost injection).
    // If we want perfection, we need a map of sets to items.
    // Let's just log the points.
    if (data.points_received) {
      // It's technically a zero cost injection if we don't burn the plushies properly.
      // Assuming no items to burn found in log:
      injectAssetWithCost("points", data.points_received, 0);
    }
  }

  // 2. Opening Caches (Log Category: Item use special - maybe 69 or 75?)
  // It gives items and consumes the cache. We can use extractItemsFromLogData for gains,
  // but we need to know what was burned. Often 'item' is the cache ID burned?
  else if (
    category === "Item use special" ||
    category === "Item use supply pack"
  ) {
    // If it's a supply pack, it gives items and burns the pack.
    // E.g. {"item": 123} was consumed. And {"items_gained": {...}}
    let burnedCost = 0;
    if (data.item && typeof data.item === "number") {
      burnedCost = burnAsset(data.item, 1);
    }

    // Inject the gained items, dividing the burnedCost equally or assigning it entirely to the first?
    // Let's divide equally among quantity of items gained for simplicity.
    const gained = [];
    if (data.items_gained && typeof data.items_gained === "object") {
      for (const [k, v] of Object.entries(data.items_gained)) {
        gained.push({
          id: parseInt(k, 10),
          qty: typeof v === "number" ? v : 1,
        });
      }
    }

    if (gained.length > 0) {
      const costPerGain = burnedCost / gained.length;
      for (const item of gained) {
        injectAssetWithCost(item.id, item.qty, costPerGain);
      }
    } else {
      // No items gained? It's a pure loss.
      realizedPnl -= burnedCost;
    }
  }

  // 3. Consumption & Loss (Medical, Drugs, Boosters, Crime Losses)
  else if (
    category?.startsWith("Item use") ||
    category === "Points building" ||
    data.items_lost ||
    logId === 6726 ||
    logId === 6727 ||
    logId === 5970
  ) {
    let totalLoss = 0;

    // Direct items burned
    if (data.item && typeof data.item === "number") {
      totalLoss += burnAsset(data.item, 1);
    }

    // items_lost object
    if (data.items_lost && typeof data.items_lost === "object") {
      for (const [k, v] of Object.entries(data.items_lost)) {
        totalLoss += burnAsset(parseInt(k, 10), typeof v === "number" ? v : 1);
      }
    }

    // array of items (like faction donate)
    if (Array.isArray(data.items) || Array.isArray(data.item)) {
      const arr = Array.isArray(data.items) ? data.items : data.item;
      for (const it of arr) {
        if (it && it.id) {
          totalLoss += burnAsset(it.id, it.qty || 1, it.uid);
        }
      }
    }

    // Cash / Point Sinks
    if (data.points_lost || data.points || data.points_used) {
      const usedFromFaction = typeof data.faction === "string" && data.faction.trim() !== "";
      
      if (!usedFromFaction) {
        // points_lost = crime/church/faction
        const points = data.points_lost || data.points || data.points_used;
        totalLoss += burnAsset("points", points);
      }
    }
    if (data.money_lost || data.money) {
      const money = data.money_lost || data.money;
      cashFlow -= money;
      realizedPnl -= money;
    }

    realizedPnl -= totalLoss;
  }

  if (assetsAffected.length > 0 || cashFlow !== 0 || realizedPnl !== 0) {
    LedgerEvents.insertOne({
      id: `ledger_ev_${log.id}`,
      log_id: log.id,
      timestamp: log.timestamp,
      type: "sink",
      category_id: 5,
      transaction_name: "Asset Transformation & Sink",
      assets_affected: assetsAffected,
      cash_flow: cashFlow,
      realized_pnl: realizedPnl,
      raw_log: log,
    });
  }
}
