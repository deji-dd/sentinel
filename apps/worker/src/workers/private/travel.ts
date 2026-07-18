import { Logger, TornItems, TravelAreaMap, TravelUnmappedAreas, TravelLedger } from "@sentinel/shared";

const logger = new Logger("travel_ledger_parser");

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function parseTravelActivityLog(log: any) {
  const logId = log.details.id;
  
  // Track missing Area IDs
  const checkAreaId = (areaId: number) => {
    if (!areaId) return;
    const mapped = TravelAreaMap.findOne(String(areaId));
    if (!mapped) {
      if (!TravelUnmappedAreas.findOne(String(areaId))) {
        TravelUnmappedAreas.insertOne({
          id: String(areaId),
          first_seen: log.timestamp
        });
        logger.warn(`Discovered unmapped Travel Area ID: ${areaId}`);
      }
    }
  };

  // Travel depart (id: 6000)
  if (logId === 6000) {
    checkAreaId(log.data.origin);
    checkAreaId(log.data.destination);
    return;
  }

  // Item abroad buy (id: 4201)
  if (logId === 4201) {
    const areaId = log.data.area;
    checkAreaId(areaId);

    const itemId = log.data.item;
    const quantity = log.data.quantity || 0;
    const costTotal = log.data.cost_total || 0;

    const item = TornItems.findOne(String(itemId));
    if (!item) {
      logger.warn(`Could not calculate profit for unknown item ID: ${itemId}`);
      return;
    }

    const marketPrice = item.data.value.market_price || 0;
    const realizedValue = marketPrice * quantity;
    const profit = realizedValue - costTotal;

    const areaStr = String(areaId);
    const existing = TravelLedger.findOne(areaStr);
    
    if (existing) {
      TravelLedger.update({
        id: areaStr,
        tracked_profit: existing.tracked_profit + profit
      });
    } else {
      TravelLedger.insertOne({
        id: areaStr,
        tracked_profit: profit
      });
    }
    
    logger.info(`Tracked +$${profit.toLocaleString()} profit for Area ${areaId}`);
  }
}
