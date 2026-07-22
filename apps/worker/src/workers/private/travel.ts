import {
  Logger,
  TornItems,
  TravelAreaMap,
  TravelUnmappedAreas,
  TravelLedger,
  StrictUserLog,
  LogRouteMap,
} from "@sentinel/shared";

const logger = new Logger("travel_module");

// 1. The Shared Helper
function checkAreaId(areaId: number, timestamp: number) {
  if (!areaId) return;
  const mapped = TravelAreaMap.findOne(String(areaId));
  if (!mapped) {
    if (!TravelUnmappedAreas.findOne(String(areaId))) {
      TravelUnmappedAreas.insertOne({
        id: String(areaId),
        first_seen: timestamp,
      });
      logger.warn(`Discovered unmapped Travel Area ID: ${areaId}`);
    }
  }
}

// 2. The Strict Parser for Log 6000 (Travel Depart)
function parseTravelDepart(log: StrictUserLog<6000>) {
  checkAreaId(log.data.origin, log.timestamp);
  checkAreaId(log.data.destination, log.timestamp);
}

// 3. The Strict Parser for Log 4201 (Item Abroad Buy)
function parseItemAbroadBuy(log: StrictUserLog<4201>) {
  const { area, item: itemId, quantity, cost_total } = log.data;

  checkAreaId(area, log.timestamp);

  // Fallback to 0 if the payload is missing quantities
  const qty = quantity || 0;
  const cost = cost_total || 0;

  const item = TornItems.findOne(String(itemId));
  if (!item) {
    logger.warn(`Could not calculate profit for unknown item ID: ${itemId}`);
    return;
  }

  const marketPrice = item.data.value.market_price || 0;
  const realizedValue = marketPrice * qty;
  const profit = realizedValue - cost;

  const itemStr = String(itemId);
  const existing = TravelLedger.findOne(itemStr);

  if (existing) {
    const history = existing.history || [];
    history.push({ timestamp: log.timestamp, profit });

    TravelLedger.update({
      id: itemStr,
      tracked_profit: existing.tracked_profit + profit,
      history,
    });
  } else {
    TravelLedger.insertOne({
      id: itemStr,
      tracked_profit: profit,
      history: [{ timestamp: log.timestamp, profit }],
    });
  }

  logger.info(`Tracked +$${profit.toLocaleString()} profit for Area ${area}`);
}

// 4. Export the specific routes
export const TRAVEL_LOG_ROUTES: LogRouteMap = {
  6000: [parseTravelDepart],
  4201: [parseItemAbroadBuy],
};
