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
  const isInitialized = LedgerEvents.find({ log_id: "init" }).length > 0;

  if (isInitialized) {
    logger.debug("Ledger already initialized successfully. Skipping.");
    return;
  }

  // If assets exist but initialization isn't marked as complete, a previous run crashed halfway.
  // We must self-heal by wiping the corrupted baseline so we can start fresh.
  const assetCount = Assets.find({}).length;
  if (assetCount > 0) {
    logger.warn(
      "Found assets but no initialization event. A previous baseline run crashed. Wiping corrupted assets to self-heal...",
    );
    // Fetch all existing assets to delete them
    const existingAssets = Assets.find({});
    for (const asset of existingAssets) {
      Assets.delete(asset.id);
    }
  }

  logger.info("Starting Day Zero baseline initialization...");

  try {
    const apiKey = getWorkerApiKey("personal");
    if (!apiKey) throw new Error("No personal API key found");

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

    // Torn API v2 requires explicit categories for inventory fetching
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
    logger.info(
      `Fetching ${categories.length} inventory categories to build baseline...`,
    );

    for (const cat of categories) {
      try {
        const invRes = (await tornApi.get("/user/inventory", {
          apiKey,
          queryParams: { cat, limit: 250 },
        })) as TornSchema<"UserInventoryResponse">;

        if (invRes.inventory?.items) {
          inventory = inventory.concat(invRes.inventory.items);
        }
      } catch (err) {
        // Ignore errors for categories that might be empty or invalid
      }
    }

    logger.info(
      `Fetched baseline: ${inventory.length} inventory items, ${bazaar.length} bazaar items, ${display.length} display items, ${pointsCount} points at $${pointCost}`,
    );

    let injectedItems = 0;

    // Helper function to insert items
    const insertItems = (
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      items: any,
      location: "inventory" | "bazaar" | "display",
    ) => {
      for (const item of items) {
        // Fetch System Assigned Value from local Items Sync database
        const itemId = item.id || item.ID;
        const itemRecord = TornItems.findOne(
          itemId.toString(),
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
            asset_id: itemId,
            quantity: 1, // Unique items are always quantity 1
            moving_average_cost: costBasis,
            total_cost_basis: costBasis,
            location: item.equipped ? "equipped" : location,
            owner: "personal",
            origin: "legacy_init",
            realized_pnl: 0,
            last_updated: Date.now(),
          });
          injectedItems++;
        } else {
          // Check if fungible item already exists in this location to aggregate quantity
          const existing = Assets.find({
            asset_id: itemId,
            location: location,
          });
          const matched = existing.find(
            (a: AssetDocument) => !a.id.startsWith("uid_"),
          );
          if (matched) {
            const doc = matched;
            doc.quantity += item.amount || item.quantity || 1;
            doc.total_cost_basis = doc.quantity * doc.moving_average_cost;
            Assets.update(doc);
          } else {
            const qty = item.amount || item.quantity || 1;
            Assets.insertOne({
              id: `item_${itemId}_${location}_${randomUUID()}`,
              type: "item",
              asset_id: itemId,
              quantity: qty,
              moving_average_cost: costBasis,
              total_cost_basis: costBasis * qty,
              location: item.equipped ? "equipped" : location,
              owner: "personal",
              origin: "legacy_init",
              realized_pnl: 0,
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
        realized_pnl: 0,
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
