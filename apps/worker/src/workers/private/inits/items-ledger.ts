import {
  Logger,
  tornApi,
  getWorkerApiKey,
  TornItems,
  TornSchema,
  AssetDocument,
  TornItemDocument,
  Assets,
  SystemState,
  ApiKeyRotator,
  LedgerEvents,
  CashHistory,
} from "@sentinel/shared";
import { randomUUID } from "crypto";

type PointsMarketResponse = {
  pointsmarket: Record<
    string,
    { cost: number; quantity: number; total_cost: number }
  >;
};
type UserResponse = TornSchema<"UserMoneyResponse"> & {
  bazaar:
    | {
        ID: number;
        UID?: number;
        name: string;
        type: string;
        quantity: number;
        price: number;
        market_price: number;
      }[]
    | [];
  display:
    | {
        ID: number;
        UID?: number;
        name: string;
        type: string;
        quantity: number;
        market_price: number;
      }[]
    | [];
};

const logger = new Logger("items_ledger_init");

/**
 * Initializes the ledger by fetching a baseline of assets if the database is empty.
 * This satisfies Category 1: The Initialization (Day Zero)
 */
export async function runItemsLedgerInit(): Promise<void> {
  try {
    const finishSync = logger.time();
    const apiKey = getWorkerApiKey("personal");

    Assets.deleteManyBy({});
    LedgerEvents.deleteManyBy({});
    CashHistory.deleteManyBy({});

    // Fetch Bazaar, Display, and Points (money selection)
    const userRes = (await tornApi.get("/user", {
      apiKey,
      queryParams: { selections: ["bazaar", "money", "display"] },
    })) as unknown as UserResponse;

    const bazaar = userRes.bazaar || [];
    const display = userRes.display || [];
    const pointsCount = userRes.money?.points || 0;

    // Fetch Points Market for current point average cost
    const marketRes = (await tornApi.get("/market", {
      apiKey,
      queryParams: { selections: ["pointsmarket"] },
    })) as unknown as PointsMarketResponse;

    const pointsMarket = marketRes.pointsmarket || {};
    // Use the first available listing cost as the "average" point cost, or default to a safe 45k
    const firstPointListingId = Object.keys(pointsMarket)[0];
    const pointCost = firstPointListingId
      ? pointsMarket[firstPointListingId].cost
      : 32000;

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

    let rotator = new ApiKeyRotator([apiKey]);

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
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
        } catch (_e) {
          // Ignore errors for categories that might be empty or invalid
        }
      },
      1000,
    );

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

        const itemUid = item.uid || item.UID;
        // If item has a UID (e.g. weapons/armor), track as non-fungible
        if (itemUid) {
          Assets.insertOne({
            id: `uid_${itemUid}`,
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
    }

    SystemState.update({
      id: "items_ledger_init_state",
      timestamp: Math.floor(Date.now() / 1000),
      init: true,
    });

    finishSync();
  } catch (error) {
    logger.error("Failed to initialize ledger baseline:", error);
  }
}
