import { healLedger } from "../../scripts/heal-ledger.js";
import {
  TornSchema,
  Assets,
  LedgerEvents,
  AssetDocument,
  TornItems,
  PersonalLogs,
  TornItemDocument,
  Logger,
  tornApi,
  getWorkerApiKey,
  CompanyDailyProfits,
  AssetLocation,
  CashHistory,
  SystemState,
  ApiKeyRotator,
} from "@sentinel/shared";
import { randomUUID } from "crypto";
import { workerEvents } from "../../lib/event-bus.js";

const WORKER_NAME = "wealth_manager";
const logger = new Logger(WORKER_NAME);

// --- FROM barter.ts ---

export function parseBarterTrade(log: TornSchema<"UserLog">) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data = log.data as any;
  const tradeId = data.parsed_trade_id;

  if (!tradeId) return;

  // Wait, is it possible the barter was already processed?
  // Our router already prevents duplicate `log_id`. So this 4430 is unique.

  // 1. Fetch all related trade logs from PersonalLogs
  // In sqlite json_extract, '$.data.parsed_trade_id' will match nested.
  // We type cast to any to bypass strict TS checking for nested keys
  const tradeLogs = PersonalLogs.find({
    "data.parsed_trade_id": tradeId,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);

  let outgoingMoney = 0;
  let incomingMoney = 0;
  const outgoingItems: {
    id: string | number;
    qty: number;
    uid?: number | null;
  }[] = [];
  const incomingItems: {
    id: string | number;
    qty: number;
    uid?: number | null;
  }[] = [];

  for (const tlog of tradeLogs) {
    const tData = tlog.data;
    const tId = tlog.details?.id;

    // Outgoing Money (Trade money outgoing)
    if (tId === 4440) {
      outgoingMoney += tData.money || 0;
    }
    // Incoming Money (Trade money incoming)
    if (tId === 4441) {
      incomingMoney += tData.money || 0;
    }
    // Outgoing Items (Trade items outgoing)
    if (tId === 4446) {
      outgoingItems.push(...extractItemsFromLogData(tData));
    }
    // Incoming Items (Trade items incoming)
    if (tId === 4445) {
      incomingItems.push(...extractItemsFromLogData(tData));
    }
  }

  // 2. Sum Cost Basis of Outgoing Items
  let totalOutgoingCostBasis = outgoingMoney;
  const assetsAffected: {
    asset_id: string | number;
    quantity_change: number;
    cost_basis_impact: number;
  }[] = [];

  for (const item of outgoingItems) {
    const isUid = !!(item.uid && typeof item.uid !== "boolean");
    // They should be in "escrow" due to 4447, or "inventory". To be safe, we check escrow, then inventory.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let query: any = isUid
      ? { id: `uid_${item.uid}`, owner: "personal" }
      : { asset_id: item.id, owner: "personal" };

    const existingAssets = Assets.find(query);
    if (existingAssets.length > 0) {
      let assetDoc: AssetDocument;
      if (!isUid) {
        // Prefer escrow if multiple exist, otherwise fallback
        const escrowDoc = existingAssets.find(
          (a: AssetDocument) =>
            a.location === "escrow" && !a.id.startsWith("uid_"),
        );
        const invDoc = existingAssets.find(
          (a: AssetDocument) => !a.id.startsWith("uid_"),
        );
        assetDoc = escrowDoc || invDoc || existingAssets[0];
      } else {
        assetDoc = existingAssets[0];
      }

      const mac = assetDoc.moving_average_cost;
      const burnedCost = mac * item.qty;
      totalOutgoingCostBasis += burnedCost;

      assetDoc.quantity = Math.max(0, assetDoc.quantity - item.qty);
      assetDoc.total_cost_basis = assetDoc.quantity * mac;
      assetDoc.last_updated = Date.now();
      Assets.update(assetDoc);

      assetsAffected.push({
        asset_id: item.id,
        quantity_change: -item.qty,
        cost_basis_impact: -burnedCost,
      });
    }
  }

  // 3. Determine System Value Weightings for Incoming Items
  let totalSystemValue = 0;
  const incomingWeighted = incomingItems.map((item) => {
    // Find system value
    let sysVal = 0;
    if (item.id === "points") {
      sysVal = 45000; // rough fallback, we could fetch pointsmarket but close enough for weightings
    } else {
      const itemRecord = TornItems.findOne(
        item.id.toString(),
      ) as TornItemDocument;
      sysVal = itemRecord.data.value.market_price || 0;
    }

    const itemTotalValue = sysVal * item.qty;
    totalSystemValue += itemTotalValue;

    return { ...item, sysVal, itemTotalValue };
  });

  // 4. Distribute Outgoing Cost Basis proportionally
  for (const item of incomingWeighted) {
    // If totalSystemValue is 0 (e.g. all items have $0 system value), split equally
    const weight =
      totalSystemValue > 0
        ? item.itemTotalValue / totalSystemValue
        : 1 / incomingWeighted.length;
    const assignedCostBasis = totalOutgoingCostBasis * weight;

    // Inject the incoming item into Inventory
    const isUid = !!(item.uid && typeof item.uid !== "boolean");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let query: any = isUid
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
        type: item.id === "points" ? "point" : "item",
        asset_id: item.id,
        quantity: 0,
        moving_average_cost: 0,
        total_cost_basis: 0,
        location: "inventory", // items end up in inventory
        owner: "personal",
        origin: "barter",
        realized_pnl: 0,
        last_updated: Date.now(),
      };
      Assets.insertOne(assetDoc);
    }

    assetDoc.quantity += item.qty;
    assetDoc.total_cost_basis += assignedCostBasis;
    assetDoc.moving_average_cost =
      assetDoc.total_cost_basis / assetDoc.quantity;
    assetDoc.last_updated = Date.now();
    Assets.update(assetDoc);

    assetsAffected.push({
      asset_id: item.id,
      quantity_change: item.qty,
      cost_basis_impact: assignedCostBasis,
    });
  }

  // 5. Calculate net cash flow and PnL
  const netCashFlow = incomingMoney - outgoingMoney;
  // Per context.xml: "The net cash flow is logged, but the overall Realized PnL is ALWAYS $0"
  // Wait, if incoming money > outgoing cost basis, does it trigger PnL?
  // No, the instruction literally says "overall Realized PnL is ALWAYS $0".
  // Let's obey strictly.

  if (assetsAffected.length > 0 || netCashFlow !== 0) {
    LedgerEvents.insertOne({
      id: `ledger_ev_${log.id}`,
      log_id: log.id,
      timestamp: log.timestamp,
      type: "barter",
      category_id: 6,
      transaction_name: "Barter Trade",
      assets_affected: assetsAffected,
      cash_flow: netCashFlow,
      realized_pnl: 0,
      raw_log: log,
    });
  }
}

// --- FROM company-profit.ts ---

export async function parseCompanyProfit(
  log: TornSchema<"UserLog">,
): Promise<void> {
  // Only trigger on "Company director pay" (log ID 6222)
  if (log.details.id !== 6222) return;

  try {
    const apiKey = getWorkerApiKey("personal");
    if (!apiKey) throw new Error("No personal API key found");

    // The endpoint is /company, selections profile and employees
    const rawRes = await tornApi.get("/company", {
      apiKey,
      queryParams: {
        selections: ["profile", "employees"],
      },
    });

    // Use casting here because the generic Torn API client returns a union of the possible selections
    const res = rawRes as TornSchema<"CompanyProfileResponseMixed"> &
      TornSchema<"CompanyEmployeesResponse">;

    const profile = res.profile as
      | TornSchema<"CompanyProfileExtended">
      | undefined;
    const employees = res.employees as
      | TornSchema<"CompanyEmployeeFull">[]
      | undefined;

    if (!profile || !employees) {
      logger.warn("Company sync response missing profile or employees data.");
      return;
    }

    // Calculate inflow (daily income)
    const inflow = profile.income.daily;

    // Calculate outflow (daily ad budget + all employee wages)
    let outflow = profile.advertisement_budget;

    for (const employee of employees) {
      outflow += employee.wage;
    }

    const profit = inflow - outflow;

    const doc = {
      id: `company_daily_profit_${Date.now()}_${randomUUID()}`,
      timestamp: Date.now(),
      inflow,
      outflow,
      profit,
      profile,
      employees,
    };

    CompanyDailyProfits.insertOne(doc);

    LedgerEvents.insertOne({
      id: `ledger_ev_company_profit_${log.id}`,
      log_id: log.id,
      timestamp: log.timestamp,
      type: profit >= 0 ? "injection" : "loss",
      category_id: 9, // Category 9: Equities, Real Estate & Companies
      transaction_name: "Daily Company Profit/Loss",
      assets_affected: null,
      cash_flow: 0, // No cash left the company into personal wallet
      realized_pnl: profit, // The player recognized this profit/loss intrinsically
      raw_log: log,
    });
  } catch (error) {
    logger.error("Failed to sync company data:", error);
  }
}

// --- FROM equities.ts ---

export function parseEquityProperty(log: TornSchema<"UserLog">) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data = log.data as any;
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
  const isBuy = title.includes("buy") || title.includes("invest");
  const isSell = title.includes("sell");
  const isUpkeep =
    title.includes("upkeep") ||
    title.includes("fee") ||
    title.includes("upgrade");
  const isTransfer =
    category === "Company" &&
    (title.includes("withdraw") || title.includes("deposit"));

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
  } else if (isTransfer) {
    cashFlow = title.includes("withdraw") ? cost : -cost;
    assetsAffected.push({
      asset_id: assetId,
      quantity_change: 0,
      cost_basis_impact: -cashFlow, // Offsets cashFlow to ensure Net Impact is 0
    });
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
        realized_pnl: 0,
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
      let calculatedProfit = 0;
      if (data.profit === undefined) {
        const costBasis = mac * qty;
        calculatedProfit = cost - costBasis;
        realizedPnl += calculatedProfit;
      }

      assetDoc.quantity = Math.max(0, assetDoc.quantity - qty);
      assetDoc.total_cost_basis = assetDoc.quantity * mac;
      // Add PnL to asset doc
      if (data.profit !== undefined) {
        assetDoc.realized_pnl = (assetDoc.realized_pnl || 0) + data.profit;
      } else {
        assetDoc.realized_pnl = (assetDoc.realized_pnl || 0) + calculatedProfit;
      }
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let eventType: any = isBuy ? "purchase" : isSell ? "sale" : "loss";
    if (isTransfer) {
      eventType = "storage_transfer";
    }

    LedgerEvents.insertOne({
      id: `ledger_ev_${log.id}`,
      log_id: log.id,
      timestamp: log.timestamp,
      type: eventType,
      category_id: 9,
      transaction_name: "Equity/Property Transaction",
      assets_affected: assetsAffected,
      cash_flow: cashFlow,
      realized_pnl: realizedPnl,
      raw_log: log,
    });
  }
}

// --- FROM faction.ts ---

export function parseFactionLiability(log: TornSchema<"UserLog">) {
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
          realized_pnl: 0,
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
          assetDoc.realized_pnl = (assetDoc.realized_pnl || 0) - costImpact;
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

// --- FROM sinks.ts ---

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

  // 2. Item Use and Crimes
  else if (
    category?.startsWith("Item use") ||
    category === "Crimes" ||
    category === "Points building" ||
    data.items_lost ||
    data.money_lost ||
    data.items_gained ||
    data.money_gained ||
    logId === 6726 ||
    logId === 6727 ||
    logId === 5970
  ) {
    // Some logs represent Faction item use via `data.faction`
    const fromFaction =
      typeof data.faction === "number" ? data.faction > 0 : !!data.faction;
    let totalLoss = 0;

    // Direct items burned
    if (!fromFaction && data.item && typeof data.item === "number") {
      totalLoss += burnAsset(data.item, 1);
    }

    // items_lost object
    if (data.items_lost && typeof data.items_lost === "object") {
      for (const [k, v] of Object.entries(data.items_lost)) {
        totalLoss += burnAsset(parseInt(k, 10), typeof v === "number" ? v : 1);
      }
    }

    // Cash / Point Sinks (losses)
    if (
      data.points_lost ||
      data.points_used ||
      (data.points &&
        !category?.startsWith("Item use") &&
        !category?.startsWith("Crimes"))
    ) {
      if (!fromFaction) {
        const points = data.points_lost || data.points_used || data.points;
        totalLoss += burnAsset("points", points);
      }
    }

    if (data.money_lost) {
      cashFlow -= data.money_lost;
      realizedPnl -= data.money_lost;
    } else if (data.money && category !== "Item use" && category !== "Crimes") {
      // Sometimes money is just `money` and implies loss if it's not a gain log.
      cashFlow -= data.money;
      realizedPnl -= data.money;
    }

    // Now handle GAINS (Item use wallets, Crime successes)
    const gained = [];
    if (data.items_gained && typeof data.items_gained === "object") {
      for (const [k, v] of Object.entries(data.items_gained)) {
        gained.push({
          id: parseInt(k, 10),
          qty: typeof v === "number" ? v : 1,
        });
      }
    } else if (data.items && Array.isArray(data.items)) {
      // Item use sometimes puts gained items in data.items array
      for (const it of data.items) {
        if (it && it.id) {
          gained.push({ id: it.id, qty: it.qty || 1, uid: it.uid });
        }
      }
    }

    if (gained.length > 0) {
      // Distribute the cost of the burned items (if any) across the gained items
      const costPerGain = totalLoss / gained.length;
      for (const item of gained) {
        injectAssetWithCost(item.id, item.qty, costPerGain, item.uid);
      }
    } else {
      // Pure loss
      realizedPnl -= totalLoss;
    }

    // Cash Gains
    if (data.money_gained) {
      cashFlow += data.money_gained;
      realizedPnl += data.money_gained;
    } else if (
      data.money &&
      (category?.startsWith("Item use") || category === "Crimes")
    ) {
      // For Item use and Crimes, if `money` is present alongside `items_gained` or inside the same log, it's typically a gain!
      cashFlow += data.money;
      realizedPnl += data.money;
    }

    // If no assets affected and no cash flow and no pnl, return early (e.g. Faction item use with no gains)
    if (assetsAffected.length === 0 && cashFlow === 0 && realizedPnl === 0)
      return;
  }

  if (assetsAffected.length > 0 || cashFlow !== 0 || realizedPnl !== 0) {
    let type: "injection" | "sink" | "barter" = "sink";
    if (realizedPnl > 0) type = "injection";
    else if (realizedPnl === 0 && assetsAffected.length > 0)
      type = "barter";

    const logCategory = log.details.category || "";

    LedgerEvents.insertOne({
      id: `ledger_ev_${log.id}`,
      log_id: log.id,
      timestamp: log.timestamp,
      type,
      category_id: 5,
      transaction_name:
        logCategory === "Crimes"
          ? "Crime Result"
          : "Asset Transformation & Sink",
      assets_affected: assetsAffected,
      cash_flow: cashFlow,
      realized_pnl: realizedPnl,
      raw_log: log,
    });
  }
}

// --- FROM standard-cash.ts ---

export function parseStandardCash(log: TornSchema<"UserLog">) {
  const logId = log.details.id;
  const isPurchase = [1112, 1225, 4200, 4201, 5010, 4320].includes(logId);
  const isSale = [1226, 1113, 4210, 4220, 5011, 4322].includes(logId);

  // Fallbacks based on string title/category if log types change
  const title = log.details.title.toLowerCase();

  const purchase =
    isPurchase || title.includes("buy") || title.includes("bought");
  const sale = isSale || title.includes("sell") || title.includes("sold");

  if (!purchase && !sale) return; // Not a recognized cash transaction

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data = log.data as any;
  let items = data.items || [];
  if (items.length === 0 && data.item) {
    items = [{ id: data.item, qty: data.quantity || 1 }];
  }

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
    let assetDoc: AssetDocument | undefined;

    let isUid = false;
    if (item.uid && typeof item.uid !== "boolean") {
      isUid = true;
      const existingAsset = Assets.findOne(
        `uid_${item.uid}`,
      ) as AssetDocument | null;
      if (existingAsset && existingAsset.owner === "personal") {
        assetDoc = existingAsset;
      }
    }

    const existingAssets = Assets.find({ asset_id: id, owner: "personal" });

    if (!isUid || !assetDoc) {
      const fungibles = existingAssets.filter(
        (a: AssetDocument) => !a.id.startsWith("uid_"),
      );

      fungibles.sort((a, b) => {
        const locationPriority = {
          bazaar: 1,
          escrow: 2,
          display: 3,
          inventory: 4,
          portfolio: 5,
          equipped: 6,
          vault: 7,
        };
        const pA =
          locationPriority[a.location as keyof typeof locationPriority] || 99;
        const pB =
          locationPriority[b.location as keyof typeof locationPriority] || 99;

        if (pA !== pB) {
          if (sale) {
            return pA - pB;
          } else {
            const invA = a.location === "inventory" ? 1 : 2;
            const invB = b.location === "inventory" ? 1 : 2;
            return invA - invB;
          }
        }
        return b.quantity - a.quantity;
      });

      if (fungibles.length > 0) {
        assetDoc = fungibles[0];
      }
    }

    if (!assetDoc) {
      assetDoc = {
        id: isUid ? `uid_${item.uid}` : `item_${id}_inventory_${randomUUID()}`,
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

    // Check if the asset already exists in the database to know whether to update or insert
    const exists =
      existingAssets &&
      existingAssets.some((a: AssetDocument) => a.id === assetDoc!.id);
    if (exists) {
      Assets.update(assetDoc);
    } else {
      Assets.insertOne(assetDoc);
    }
  }

  // Handle Points bought/sold
  const isPointsTransaction =
    title.includes("points") || logId === 5010 || logId === 5011;
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

// --- FROM storage-transfer.ts ---

export function parseStorageTransfer(log: TornSchema<"UserLog">) {
  const logId = log.details.id;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data = log.data as any;

  const title = log.details.title.toLowerCase();
  if (
    logId === 1224 ||
    title.includes("edit") ||
    title.includes("change") ||
    title.includes("buy") ||
    title.includes("sell") ||
    title.includes("bought") ||
    title.includes("sold")
  )
    return;

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

// --- FROM utils.ts ---
// Utility to normalize wildly varying item structures from Torn Logs
export function extractItemsFromLogData(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: any,
): { id: string | number; qty: number; uid?: number | null }[] {
  const result: { id: string | number; qty: number; uid?: number | null }[] =
    [];

  // Helper to parse array format: [{id: 1, qty: 1, uid: 123}]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const parseArray = (arr: any[]) => {
    for (const item of arr) {
      if (item && item.id) {
        result.push({
          id: item.id,
          qty: item.qty || item.amount || 1,
          uid: item.uid,
        });
      }
    }
  };

  // Helper to parse object format: {"3": 1, "643": 1}
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const parseObject = (obj: any) => {
    for (const [key, value] of Object.entries(obj)) {
      const id = parseInt(key, 10);
      const qty = typeof value === "number" ? value : 1;
      if (!isNaN(id)) {
        result.push({ id, qty });
      }
    }
  };

  // 1. Check data.items array (Standard purchases, bazaar adds)
  if (Array.isArray(data.items)) {
    parseArray(data.items);
  }

  // 2. Check data.item array (Faction gives)
  if (Array.isArray(data.item)) {
    parseArray(data.item);
  }

  // 3. Check data.item object (Stock special items)
  if (data.item && typeof data.item === "object" && !Array.isArray(data.item)) {
    parseObject(data.item);
  }

  // 4. Check data.items_gained object (Crimes)
  if (data.items_gained && typeof data.items_gained === "object") {
    parseObject(data.items_gained);
  }

  // 5. Check data.items_lost object (Crimes)
  if (data.items_lost && typeof data.items_lost === "object") {
    parseObject(data.items_lost);
    // Note: If calling this for "lost" items, we need to negate them externally, so maybe we shouldn't mix them.
    // Actually, zero-cost injections shouldn't process lost items. Sinks process lost items. We will handle that.
    // For now, if someone calls extractItems, they get absolute quantities.
  }

  // 6. Check data.item number (City finds)
  if (typeof data.item === "number") {
    result.push({ id: data.item, qty: data.quantity || 1 });
  }

  // 7. Handle money/points as "items" if applicable
  if (data.points && typeof data.points === "number") {
    result.push({ id: "points", qty: data.points });
  }

  return result;
}

// --- FROM zero-cost.ts ---

export function parseZeroCostInjection(log: TornSchema<"UserLog">) {
  const category = log.details.category?.toLowerCase() || "";
  const excludeCategories = [
    "bazaars",
    "market",
    "trade",
    "company",
    "property",
    "crimes",
  ];
  if (excludeCategories.includes(category) || category.startsWith("item use"))
    return;

  const title = log.details.title?.toLowerCase() || "";
  if (
    title.includes("buy") ||
    title.includes("sell") ||
    title.includes("bought") ||
    title.includes("sold")
  )
    return;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data = log.data as any;

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
        realized_pnl: 0,
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

// --- FROM liquid-cash-sync.ts ---

export async function executeLiquidCashEngine(): Promise<void> {
  const finishSync = logger.time();

  try {
    const apiKey = getWorkerApiKey("personal");
    if (!apiKey) {
      throw new Error("No personal API key found");
    }

    // 1. Fetch user money from Torn
    const userMoneyRes = await tornApi.get("/user/money", { apiKey });
    const money = (userMoneyRes as TornSchema<"UserMoneyResponse">).money;

    if (!money) {
      throw new Error("Failed to extract money object from response");
    }

    let withdrawableCorporateCash = 0;

    if (money.company > 0) {
      try {
        // 2. Fetch the latest company details dynamically from the API
        const rawRes = await tornApi.get("/company", {
          apiKey,
          queryParams: {
            selections: ["profile", "employees"],
          },
        });

        const res = rawRes as TornSchema<"CompanyProfileResponseMixed"> &
          TornSchema<"CompanyEmployeesResponse">;

        const profile = res.profile as
          | TornSchema<"CompanyProfileExtended">
          | undefined;
        const employees = res.employees as
          | TornSchema<"CompanyEmployeeFull">[]
          | undefined;

        if (profile && employees) {
          const dailyAdCost = profile.advertisement_budget || 0;
          let employeesWage = 0;
          for (const employee of employees) {
            employeesWage += employee.wage || 0;
          }
          const weeklyBurn = (employeesWage + dailyAdCost) * 7;
          withdrawableCorporateCash = Math.max(0, money.company - weeklyBurn);
        } else {
          withdrawableCorporateCash = money.company;
        }
      } catch (error) {
        // Fallback: If API throws (e.g. not a director or company error)
        withdrawableCorporateCash = money.company;
        logger.error(
          "Failed to calculate withdrawable corporate cash, defaulting to company bank balance",
          error,
        );
      }
    }

    // 3. Calculate Total Liquidity
    const totalLiquidity =
      money.wallet +
      money.vault +
      (money.faction?.money || 0) +
      withdrawableCorporateCash;

    // 4. Upsert into CashHistory (Chronological Snapshot)
    const now = new Date();
    now.setUTCHours(0, 0, 0, 0);
    const startOfDayUtc = Math.floor(now.getTime() / 1000);

    const snapshotDoc = {
      id: startOfDayUtc.toString(),
      timestamp: startOfDayUtc,
      liquid_cash: totalLiquidity,
    };

    CashHistory.update(snapshotDoc);

    finishSync();
  } catch (error) {
    logger.error("Failed to run liquid cash engine:", error);
    throw error;
  }
}

let lastCashSync = 0;
let cashSyncTimeout: ReturnType<typeof setTimeout> | null = null;

export async function queueLiquidCashEngine() {
  const now = Date.now();
  // Debounce to at most once per 60 seconds
  if (now - lastCashSync > 60000) {
    lastCashSync = now;
    if (cashSyncTimeout) {
      clearTimeout(cashSyncTimeout);
      cashSyncTimeout = null;
    }
    await executeLiquidCashEngine();
  } else {
    if (!cashSyncTimeout) {
      cashSyncTimeout = setTimeout(
        () => {
          cashSyncTimeout = null;
          lastCashSync = Date.now();
          executeLiquidCashEngine().catch((e) =>
            logger.error("Debounced sync failed", e),
          );
        },
        60000 - (now - lastCashSync),
      );
    }
  }
}

export async function parseWealthActivityLog(log: TornSchema<"UserLog">) {
  try {
    const category =
      log.details?.category?.toLowerCase() ||
      log.details?.category?.toLowerCase() ||
      "";
    let isWealthLog = false;

    if (
      category === "money" ||
      category === "item" ||
      category === "items" ||
      category === "market" ||
      category === "trade" ||
      category === "bazaar" ||
      category === "bazaars" ||
      category === "company" ||
      category === "faction" ||
      category === "property" ||
      category === "travel" ||
      category.includes("item use") ||
      category.includes("crime")
    ) {
      isWealthLog = true;
    }

    if (!isWealthLog) return;

    parseStandardCash(log);
    parseBarterTrade(log);
    parseEquityProperty(log);
    parseFactionLiability(log);
    parseTransformationSink(log);
    parseStorageTransfer(log);
    parseZeroCostInjection(log);

    await parseCompanyProfit(log);

    await queueLiquidCashEngine();
  } catch (error) {
    logger.error("Error parsing wealth log", error);
  }
}

// --- FROM inits/items-ledger.ts ---
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

/**
 * Initializes the ledger by fetching a baseline of assets if the database is empty.
 * This satisfies Category 1: The Initialization (Day Zero)
 */
export async function runItemsLedgerInit(): Promise<void> {
  try {
    SystemState.update({
      id: "wealth_init",
      data: { status: "in_progress" },
      updated_at: Date.now(),
    });

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

    // 6. Snapshot Day Zero liquid cash
    await executeLiquidCashEngine();

    finishSync();

    SystemState.update({
      id: "wealth_init",
      data: { status: "completed" },
      updated_at: Date.now(),
    });
  } catch (error) {
    logger.error("Failed to initialize ledger baseline:", error);
    SystemState.update({
      id: "wealth_init",
      data: { status: "error" },
      updated_at: Date.now(),
    });
  }
}

// Listen for the init trigger from the API
workerEvents.on("wealth_init", () => {
  logger.info("Received wealth_init event. Running item ledger init.");
  runItemsLedgerInit().catch((e) =>
    logger.error("Failed to run items ledger init", e),
  );
});

// Listen for the heal trigger from the API
workerEvents.on("wealth_heal", () => {
  logger.info("Received wealth_heal event. Running healLedger().");
  healLedger().catch((e) => logger.error("Failed to run ledger healer", e));
});
