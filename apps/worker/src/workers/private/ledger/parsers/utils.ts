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
