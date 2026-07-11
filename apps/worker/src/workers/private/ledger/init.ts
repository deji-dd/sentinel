import {
  Logger,
  tornApi,
  getWorkerApiKey,
  TornItems,
  TornSchema,
  AssetDocument,
  TornItemDocument,
  Assets,
  LedgerEvents,
} from "@sentinel/shared";
import { randomUUID } from "crypto";

const logger = new Logger("ledger_init");

/**
 * Initializes the ledger by fetching a baseline of assets if the database is empty.
 * This satisfies Category 1: The Initialization (Day Zero)
 */
export async function initializeLedgerBaseline(): Promise<void> {
  const assetCount = Assets.find({}).length;
  if (assetCount > 0) {
    logger.debug("Assets already exist. Ledger initialization skipped.");
    return;
  }

  logger.info("Ledger is empty. Starting Day Zero baseline initialization...");

  try {
    const apiKey = getWorkerApiKey("personal");
    if (!apiKey) throw new Error("No personal API key found");

    // Fetch Inventory
    const invRes = (await tornApi.get("/user", {
      apiKey,
      queryParams: { selections: ["inventory"] },
    })) as TornSchema<"UserInventoryResponse">;
    const inventory = invRes.inventory.items || [];

    // Fetch Bazaar, Display, and Points (money selection)
    const userRes = (await tornApi.get("/user", {
      apiKey,
      queryParams: { selections: ["bazaar", "money", "display"] },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    })) as any;

    const bazaar = userRes.bazaar || [];
    const display = userRes.display || [];
    const pointsCount = userRes.money?.points || 0;

    // Fetch Points Market for current point average cost
    const marketRes = (await tornApi.get("/market", {
      apiKey,
      queryParams: { selections: ["pointsmarket"] },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    })) as any;

    const pointsMarket = marketRes.pointsmarket || {};
    // Use the first available listing cost as the "average" point cost, or default to a safe 45k
    const firstPointListingId = Object.keys(pointsMarket)[0];
    const pointCost = firstPointListingId
      ? pointsMarket[firstPointListingId].cost
      : 45000;

    logger.info(
      `Fetched baseline: ${inventory.length} inventory items, ${bazaar.length} bazaar items, ${display.length} display items, ${pointsCount} points at $${pointCost}`,
    );

    let injectedItems = 0;

    // Helper function to insert items
    const insertItems = (
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      items: any[],
      location: "inventory" | "bazaar" | "display",
    ) => {
      for (const item of items) {
        // Fetch System Assigned Value from local Items Sync database
        const itemRecord = TornItems.findOne(
          item.ID.toString(),
        ) as TornItemDocument;
        const systemValue = itemRecord
          ? itemRecord.data.value.market_price || 0
          : 0;

        // Bazaar items might have a 'price' field, but Cost Basis strictly uses system value
        const costBasis = systemValue || 0;

        // If item has a UID (e.g. weapons/armor), track as non-fungible
        if (item.uid) {
          Assets.insertOne({
            id: `uid_${item.uid}`,
            type: "item",
            asset_id: item.ID,
            quantity: 1, // Unique items are always quantity 1
            moving_average_cost: costBasis,
            total_cost_basis: costBasis,
            location: item.equipped ? "equipped" : location,
            owner: "personal",
            origin: "legacy_init",
            last_updated: Date.now(),
          });
          injectedItems++;
        } else {
          // Check if fungible item already exists in this location to aggregate quantity
          const existing = Assets.find({
            asset_id: item.ID,
            location: location,
          });
          const matched = existing.find(
            (a: AssetDocument) => !a.id.startsWith("uid_"),
          );
          if (matched) {
            const doc = matched;
            doc.quantity += item.quantity || 1;
            doc.total_cost_basis = doc.quantity * doc.moving_average_cost;
            Assets.update(doc);
          } else {
            const qty = item.quantity || 1;
            Assets.insertOne({
              id: `item_${item.ID}_${location}_${randomUUID()}`,
              type: "item",
              asset_id: item.ID,
              quantity: qty,
              moving_average_cost: costBasis,
              total_cost_basis: costBasis * qty,
              location: item.equipped ? "equipped" : location,
              owner: "personal",
              origin: "legacy_init",
              last_updated: Date.now(),
            });
            injectedItems++;
          }
        }
      }
    };

    insertItems(inventory, "inventory");
    insertItems(bazaar, "bazaar");
    insertItems(display, "display");

    // Insert Points
    if (pointsCount > 0) {
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
        last_updated: Date.now(),
      });
      injectedItems++;
    }

    const now = new Date();
    now.setUTCHours(0, 0, 0, 0);
    const midnightUTC = Math.floor(now.getTime() / 1000);

    LedgerEvents.insertOne({
      id: `ledger_ev_init_${Date.now()}`,
      log_id: "init",
      timestamp: midnightUTC, // Sync to midnight UTC of the initialization day
      type: "init",
      category_id: 1, // Or 0
      transaction_name: "Day Zero Initialization",
      assets_affected: [],
      cash_flow: 0,
      realized_pnl: 0,
      raw_log: {},
    });

    logger.info(
      `Ledger Initialization complete. ${injectedItems} asset groups injected.`,
    );
  } catch (error) {
    logger.error("Failed to initialize ledger baseline:", error);
  }
}
