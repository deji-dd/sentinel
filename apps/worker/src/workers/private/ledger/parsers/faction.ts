import {
  TornSchema,
  Assets,
  LedgerEvents,
  AssetDocument,
} from "@sentinel/shared";
import { randomUUID } from "crypto";
import { extractItemsFromLogData } from "./utils.js";

export async function parseFactionLiability(log: TornSchema<"UserLog">) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data = log.data as any;
  const logId = log.details.id;

  const items = extractItemsFromLogData(data);
  const assetsAffected: {
    asset_id: string | number;
    quantity_change: number;
    cost_basis_impact: number;
  }[] = [];

  for (const item of items) {
    const isUid = !!(item.uid && typeof item.uid !== "boolean");

    if (logId === 6746) {
      // Faction loan item receive
      // We get an item, but it's owned by the faction.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const query: any = isUid
        ? { id: `uid_${item.uid}`, owner: "faction" }
        : { asset_id: item.id, owner: "faction" };
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
          owner: "faction",
          origin: "faction_loan",
          last_updated: Date.now(),
        };
        Assets.insertOne(assetDoc);
      }

      assetDoc.quantity += item.qty;
      assetDoc.last_updated = Date.now();
      Assets.update(assetDoc);

      assetsAffected.push({
        asset_id: item.id,
        quantity_change: item.qty,
        cost_basis_impact: 0,
      });
    } else if (logId === 6747 || logId === 6728) {
      // Faction loan return OR Faction deposit item
      // First, try to burn a faction-owned item if we are returning a loan.
      // If we are depositing our own item (6728) or we don't have a faction item logged, we burn a personal item.
      let burnedFaction = false;

      if (logId === 6747 || logId === 6728) {
        // Try faction first for loan returns, and also try it for deposits just in case they deposited a loaned item (which returns it)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const factionQuery: any = isUid
          ? { id: `uid_${item.uid}`, owner: "faction" }
          : { asset_id: item.id, owner: "faction" };
        const factionAssets = Assets.find(factionQuery);

        if (factionAssets.length > 0) {
          let assetDoc: AssetDocument;
          if (!isUid) {
            const fungible = factionAssets.find(
              (a: AssetDocument) => !a.id.startsWith("uid_"),
            );
            assetDoc = fungible || factionAssets[0];
          } else {
            assetDoc = factionAssets[0];
          }

          if (assetDoc.quantity >= item.qty) {
            assetDoc.quantity -= item.qty;
            assetDoc.last_updated = Date.now();
            Assets.update(assetDoc);

            assetsAffected.push({
              asset_id: item.id,
              quantity_change: -item.qty,
              cost_basis_impact: 0,
            });
            burnedFaction = true;
          }
        }
      }

      // If we couldn't burn a faction item, we must burn a personal item
      if (!burnedFaction) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const personalQuery: any = isUid
          ? { id: `uid_${item.uid}`, owner: "personal" }
          : { asset_id: item.id, owner: "personal" };
        const personalAssets = Assets.find(personalQuery);

        if (personalAssets.length > 0) {
          let assetDoc: AssetDocument;
          if (!isUid) {
            const fungible = personalAssets.find(
              (a: AssetDocument) => !a.id.startsWith("uid_"),
            );
            assetDoc = fungible || personalAssets[0];
          } else {
            assetDoc = personalAssets[0];
          }

          const mac = assetDoc.moving_average_cost;
          const costImpact = mac * item.qty;

          assetDoc.quantity = Math.max(0, assetDoc.quantity - item.qty);
          assetDoc.total_cost_basis = assetDoc.quantity * mac;
          assetDoc.last_updated = Date.now();
          Assets.update(assetDoc);

          assetsAffected.push({
            asset_id: item.id,
            quantity_change: -item.qty,
            cost_basis_impact: -costImpact,
          });
        }
      }
    }
  }

  // Calculate Realized PnL (If we burned personal items, it's a loss!)
  let realizedPnl = 0;
  for (const affect of assetsAffected) {
    // cost_basis_impact is negative if we burned a personal item
    if (affect.cost_basis_impact < 0) {
      realizedPnl += affect.cost_basis_impact;
    }
  }

  if (assetsAffected.length > 0) {
    LedgerEvents.insertOne({
      id: `ledger_ev_${log.id}`,
      log_id: log.id,
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
