import { TornApiClient, type TornApiComponents } from "@sentinel/shared";
import { tornApi } from "../services/torn-client.js";

/**
 * Torn API client for the bot
 */
export const botTornApi = new TornApiClient();

type UserProfileResponse = TornApiComponents["schemas"]["UserProfileResponse"] &
  TornApiComponents["schemas"]["UserFactionResponse"];

type TornItemsResponse = TornApiComponents["schemas"]["TornItemsResponse"];
type PointsMarketResponse = {
  pointsmarket?: Record<string, { cost?: number }>;
};

/**
 * Fetch Torn user profile data (name, faction)
 * @param tornId The Torn player ID
 * @param apiKey The API key to use
 * @returns Profile data or null if failed
 */
export async function fetchTornProfileData(
  tornId: number,
  apiKey: string,
): Promise<UserProfileResponse | null> {
  try {
    const response = await botTornApi.get<UserProfileResponse>(`/user`, {
      apiKey,
      queryParams: {
        selections: ["profile", "faction"],
        id: tornId,
      },
    });

    return response;
  } catch (error) {
    console.error(`[TornAPI] Failed to fetch profile for ${tornId}:`, error);
    return null;
  }
}

/**
 * Fetch the current point cost from the Torn market
 */
export async function fetchPointPrice(apiKey: string): Promise<number> {
  try {
    const response = await tornApi.get<PointsMarketResponse>(`/market`, {
      apiKey,
      queryParams: {
        selections: ["pointsmarket"],
      },
    });

    // Points market response is an object with unique IDs as keys
    const entries = Object.values(response.pointsmarket || {});
    if (entries.length > 0) {
      return entries[0]?.cost || 0;
    }
    return 0;
  } catch (error) {
    console.error(`[TornAPI] Failed to fetch point price:`, error);
    return 0;
  }
}

/**
 * Fetch market prices for a list of item IDs
 */
export async function fetchMarketPrices(
  apiKey: string,
  itemIds: number[],
): Promise<Record<number, number>> {
  if (itemIds.length === 0) return {};

  try {
    const response = await tornApi.get<TornItemsResponse>(`/torn/{ids}/items`, {
      apiKey,
      pathParams: { ids: itemIds.join(",") },
      queryParams: {
        selections: ["items"],
      },
    });

    const prices: Record<number, number> = {};
    const items = response.items;

    Object.entries(items).forEach(([id, item]) => {
      prices[parseInt(id)] = item.value?.market_price || 0;
    });

    return prices;
  } catch (error) {
    console.error(
      `[TornAPI] Failed to fetch market prices for ${itemIds.join(",")}:`,
      error,
    );
    return {};
  }
}
