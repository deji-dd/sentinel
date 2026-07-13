import { TornItems } from "../schemas/index.js";

export function getItemValue(itemId: string): number {
  const item = TornItems.findOne(itemId);

  if (item) {
    const itemRef = item.data;
    return itemRef.value.market_price || 0;
  }

  return 0;
}
