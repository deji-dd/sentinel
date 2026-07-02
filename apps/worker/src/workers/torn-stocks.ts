/* eslint-disable @typescript-eslint/no-explicit-any */
import { executeSync } from "../lib/sync.js";
import { getAllSystemApiKeys, getSystemApiKey } from "../lib/api-keys.js";
import { tornApi } from "../services/torn-client.js";
import { Logger } from "../lib/logger.js";
import { startDbScheduledRunner } from "../lib/scheduler.js";
import { TABLE_NAMES, ApiKeyRotator } from "@sentinel/shared";
import { getKysely } from "@sentinel/shared/db/sqlite.js";

const WORKER_NAME = "torn_stocks_worker";
const logger = new Logger(WORKER_NAME);
const SYNC_INTERVAL_SECONDS = 3600; // Hourly sync

export async function syncTornStocks(): Promise<void> {
  const startTime = Date.now();
  const db = getKysely();

  try {
    const apiKeys = await getAllSystemApiKeys("system");
    if (!apiKeys.length) {
      logger.warn("No system API keys available");
      return;
    }

    const keyRotator = new ApiKeyRotator(apiKeys);

    // 1. Fetch points market price
    logger.info("Syncing points market price...");
    try {
      const pointsResponse = (await tornApi.get("/market", {
        apiKey: keyRotator.getNextKey(),
        queryParams: { selections: ["pointsmarket"] } as any,
      })) as any;

      const listings = Object.values(pointsResponse.pointsmarket || {});
      const validListings = listings.filter(
        (l: any) => l && typeof l.cost === "number" && l.cost > 1000
      );

      if (validListings.length > 0) {
        const minPointPrice = Math.min(...validListings.map((l: any) => l.cost));
        logger.info(`Minimum points market price resolved: $${minPointPrice}`);

        await db
          .insertInto(TABLE_NAMES.MARKET_PRICES as any)
          .values({
            key: "points",
            value: minPointPrice,
            updated_at: new Date().toISOString(),
          })
          .onConflict((oc: any) =>
            oc.column("key").doUpdateSet({
              value: minPointPrice,
              updated_at: new Date().toISOString(),
            })
          )
          .execute();
      }
    } catch (pointsErr) {
      logger.error("Failed to sync points market price", pointsErr);
    }

    // 2. Fetch properties list to calculate average cost of HRG property pool
    logger.info("Syncing average HRG property cost...");
    try {
      const propertiesResponse = (await tornApi.get("/torn/properties", {
        apiKey: keyRotator.getNextKey(),
      })) as any;

      const propertiesList = propertiesResponse.properties || [];
      const hrgIds = new Set([2, 3, 4, 5, 6, 7, 8, 9, 11]);
      const hrgProperties = propertiesList.filter((p: any) => hrgIds.has(Number(p.id)));

      if (hrgProperties.length > 0) {
        const sum = hrgProperties.reduce((acc: number, p: any) => acc + Number(p.cost || 0), 0);
        const avgPropertyCost = sum / hrgProperties.length;
        logger.info(`Average HRG property cost resolved: $${avgPropertyCost.toLocaleString()}`);

        await db
          .insertInto(TABLE_NAMES.MARKET_PRICES as any)
          .values({
            key: "average_property_cost",
            value: avgPropertyCost,
            updated_at: new Date().toISOString(),
          })
          .onConflict((oc: any) =>
            oc.column("key").doUpdateSet({
              value: avgPropertyCost,
              updated_at: new Date().toISOString(),
            })
          )
          .execute();
      }
    } catch (propErr) {
      logger.error("Failed to sync properties list", propErr);
    }

    // 3. Fetch all stocks from /torn/stocks
    logger.info("Syncing Torn stock market...");
    const stocksResponse = (await tornApi.get("/torn/stocks", {
      apiKey: keyRotator.getNextKey(),
    })) as any;

    const stocksList = stocksResponse.stocks || [];
    if (!Array.isArray(stocksList) || stocksList.length === 0) {
      logger.warn("No stocks returned from /torn/stocks");
      return;
    }

    logger.info(`Upserting ${stocksList.length} stocks to database...`);
    for (const stock of stocksList) {
      const stockId = Number(stock.id);
      if (!stockId || isNaN(stockId)) continue;

      const market = stock.market || {};
      const bonus = stock.bonus || {};
      const images = stock.images || {};

      await db
        .insertInto(TABLE_NAMES.TORN_STOCKS as any)
        .values({
          stock_id: stockId,
          name: stock.name,
          acronym: stock.acronym,
          logo_image: images.logo || null,
          full_image: images.full || null,
          price: Number(market.price || 0),
          market_cap: Number(market.cap || 0),
          shares: Number(market.shares || 0),
          investors: Number(market.investors || 0),
          bonus_passive: bonus.passive ? 1 : 0,
          bonus_frequency: Number(bonus.frequency || 0),
          bonus_requirement: Number(bonus.requirement || 0),
          bonus_description: bonus.description || "",
          updated_at: new Date().toISOString(),
        })
        .onConflict((oc: any) =>
          oc.column("stock_id").doUpdateSet({
            name: stock.name,
            acronym: stock.acronym,
            logo_image: images.logo || null,
            full_image: images.full || null,
            price: Number(market.price || 0),
            market_cap: Number(market.cap || 0),
            shares: Number(market.shares || 0),
            investors: Number(market.investors || 0),
            bonus_passive: bonus.passive ? 1 : 0,
            bonus_frequency: Number(bonus.frequency || 0),
            bonus_requirement: Number(bonus.requirement || 0),
            bonus_description: bonus.description || "",
            updated_at: new Date().toISOString(),
          })
        )
        .execute();
    }

    // 4. Sync user owned stocks
    logger.info("Syncing user owned stocks from /user/stocks...");
    try {
      const personalKey = await getSystemApiKey("personal");
      const userStocksResponse = (await tornApi.get("/user/stocks" as any, {
        apiKey: personalKey,
      })) as any;

      const userStocksList = userStocksResponse.stocks || [];
      if (Array.isArray(userStocksList)) {
        const activeAcronyms = new Set<string>();

        for (const us of userStocksList) {
          const stockId = Number(us.id);
          const increment = Number(us.bonus?.increment || 0);

          const stockMeta = await db
            .selectFrom(TABLE_NAMES.TORN_STOCKS)
            .select("acronym")
            .where("stock_id", "=", stockId)
            .executeTakeFirst();

          if (stockMeta?.acronym) {
            activeAcronyms.add(stockMeta.acronym);
            await db
              .insertInto(TABLE_NAMES.USER_ASSETS as any)
              .values({
                asset_type: "stock",
                asset_key: stockMeta.acronym,
                quantity: increment,
                updated_at: new Date().toISOString(),
              })
              .onConflict((oc: any) =>
                oc.columns(["asset_type", "asset_key"]).doUpdateSet({
                  quantity: increment,
                  updated_at: new Date().toISOString(),
                })
              )
              .execute();
          }
        }

        // Set quantity to 0 for any stocks that the user doesn't own anymore
        const allStocks = await db
          .selectFrom(TABLE_NAMES.TORN_STOCKS)
          .select("acronym")
          .execute();

        for (const s of allStocks) {
          if (!activeAcronyms.has(s.acronym)) {
            await db
              .insertInto(TABLE_NAMES.USER_ASSETS as any)
              .values({
                asset_type: "stock",
                asset_key: s.acronym,
                quantity: 0,
                updated_at: new Date().toISOString(),
              })
              .onConflict((oc: any) =>
                oc.columns(["asset_type", "asset_key"]).doUpdateSet({
                  quantity: 0,
                  updated_at: new Date().toISOString(),
                })
              )
              .execute();
          }
        }
      }
    } catch (userStocksErr) {
      logger.error("Failed to sync user owned stocks", userStocksErr);
    }

    // 5. Sync user owned properties
    logger.info("Syncing user properties...");
    try {
      const personalKey = await getSystemApiKey("personal");
      const userPropertiesResponse = (await tornApi.get("/user/properties" as any, {
        apiKey: personalKey,
      })) as any;

      const userPropertiesList = userPropertiesResponse.properties || [];
      
      // Resolve user ID
      let userId = Number(process.env.SENTINEL_USER_ID);
      if (!userId) {
        const personalSettings = await db
          .selectFrom("sentinel_personal_settings" as any)
          .select("user_id")
          .where("discord_id", "=", process.env.SENTINEL_DISCORD_USER_ID || "")
          .executeTakeFirst();
        if (personalSettings?.user_id) {
          userId = Number(personalSettings.user_id);
        }
      }
      
      if (!userId) {
        try {
          const profile = (await tornApi.get("/user" as any, { apiKey: personalKey })) as any;
          userId = Number(profile.player_id);
        } catch (err) {
          logger.error("Failed to resolve user ID from /user profile", err);
        }
      }

      let ownedBasePi = 0;
      let ownedMaxedPi = 0;
      let spousePiUpkeep = 0;

      if (Array.isArray(userPropertiesList)) {
        for (const prop of userPropertiesList) {
          const propTypeId = Number(prop.property?.id);
          const propOwnerId = Number(prop.owner?.id);
          
          if (propTypeId === 13) {
            // It is a Private Island
            if (propOwnerId === userId) {
              ownedBasePi = 1;
              const happy = Number(prop.happy || 0);
              if (happy >= 5025) {
                ownedMaxedPi = 1;
              }
            } else if (prop.status === "in_use") {
              // User lives in it but does not own it (spouse's PI)
              const propUpkeep = Number(prop.upkeep?.property || 0);
              const staffUpkeep = Number(prop.upkeep?.staff || 0);
              spousePiUpkeep = propUpkeep + staffUpkeep;
            }
          }
        }
      }

      logger.info(`User property status: ownedBasePi=${ownedBasePi}, ownedMaxedPi=${ownedMaxedPi}, spousePiUpkeep=${spousePiUpkeep}`);

      const assetsToUpsert = [
        { key: "owned_base_pi", val: ownedBasePi },
        { key: "owned_maxed_pi", val: ownedMaxedPi },
        { key: "spouse_pi_upkeep", val: spousePiUpkeep },
      ];

      for (const asset of assetsToUpsert) {
        await db
          .insertInto(TABLE_NAMES.USER_ASSETS as any)
          .values({
            asset_type: "property",
            asset_key: asset.key,
            quantity: asset.val,
            updated_at: new Date().toISOString(),
          })
          .onConflict((oc: any) =>
            oc.columns(["asset_type", "asset_key"]).doUpdateSet({
              quantity: asset.val,
              updated_at: new Date().toISOString(),
            })
          )
          .execute();
      }
    } catch (propsErr) {
      logger.error("Failed to sync user properties", propsErr);
    }

    const duration = Date.now() - startTime;
    logger.success(`Stocks sync completed successfully for ${stocksList.length} stocks`, duration);
  } catch (error) {
    logger.error("Sync failed", error, Date.now() - startTime);
    throw error;
  }
}

export function startTornStocksWorker(): void {
  startDbScheduledRunner({
    worker: WORKER_NAME,
    defaultCadenceSeconds: SYNC_INTERVAL_SECONDS,
    pollIntervalMs: 5000,
    handler: async () => {
      return await executeSync({
        name: WORKER_NAME,
        timeout: 180000, // 3 minutes
        handler: syncTornStocks,
      });
    },
  });
}
