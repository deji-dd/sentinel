const TORN_API_BASE = "https://api.torn.com/v2";
const TORN_API_V1_BASE = "https://api.torn.com";
const REQUEST_TIMEOUT = 10000; // 10 seconds

import { waitIfNeededPerUser } from "../lib/rate-limit-tracker-per-user.js";
import { TORN_ERROR_CODES } from "@sentinel/shared";

export interface TornUserBasic {
  profile?: {
    id: number;
    name: string;
    capacity?: number;
  };
  error?: {
    code: number;
    error: string;
  };
}

export interface TornUserTravel {
  travel?: {
    destination?: string | null;
    method?: string | null;
    departed_at?: number | null;
    arrival_at?: number | null;
    time_left?: number | null;
  };
  error?: {
    code: number;
    error: string;
  };
}

export interface TornUserPerks {
  property_perks?: string[];
  stock_perks?: string[];
  book_perks?: string[];
  education_perks?: string[];
  enhancer_perks?: string[];
  faction_perks?: string[];
  job_perks?: string[];
  merit_perks?: string[];
  error?: {
    code: number;
    error: string;
  };
}

export interface TornUserProfileResponse {
  profile?: {
    id?: number;
    name?: string;
    donator_status?: string;
    image?: string;
  };
  error?: {
    code: number;
    error: string;
  };
}

export interface TornItem {
  id: number | string;
  name: string;
  type?: string | null;
  image?: string | null;
}

export interface TornItemsResponseArray {
  items: TornItem[];
}

export interface TornItemsResponseObject {
  items: Record<string, TornItem>;
}

export interface TornItemMarketListing {
  cost?: number;
  price?: number;
  quantity?: number;
  id?: number;
  listing_id?: number;
  owner_id?: number;
}

export interface TornItemMarketResponse {
  itemmarket?: { listings: TornItemMarketListing[] };
  error?: { code: number; error: string };
}

export type TornItemsResponse =
  | TornItemsResponseArray
  | TornItemsResponseObject
  | { error?: { code: number; error: string } };

async function fetchTorn<T>(url: string): Promise<T> {
  // Extract API key from URL for per-user rate limiting
  const keyMatch = url.match(/[?&]key=([^&]+)/);
  const apiKey = keyMatch ? keyMatch[1] : "unknown";

  // Apply per-user rate limiting (database-backed, 90 req/min per key)
  // Each API key has independent 100 req/min limit from Torn
  await waitIfNeededPerUser(apiKey);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });

    const data = (await response.json()) as T & { error?: { code: number } };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if ((data as any)?.error) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const code = (data as any).error?.code;
      const errorMessage =
        code !== undefined
          ? TORN_ERROR_CODES[code] || `Error code ${code}`
          : "Unknown Torn API error";

      throw new Error(errorMessage);
    }

    if (!response.ok) {
      throw new Error(`Torn API returned status ${response.status}`);
    }

    return data as T;
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function fetchTornUserBasic(
  apiKey: string,
): Promise<TornUserBasic> {
  const data = await fetchTorn<TornUserBasic>(
    `${TORN_API_BASE}/user/basic?key=${apiKey}`,
  );

  if (!data.profile?.id || !data.profile?.name) {
    throw new Error("Invalid response from Torn API: missing profile data");
  }

  return data;
}

export async function fetchTornUserTravel(
  apiKey: string,
): Promise<TornUserTravel> {
  return fetchTorn<TornUserTravel>(
    `${TORN_API_BASE}/user/travel?key=${apiKey}`,
  );
}

export async function fetchTornUserPerks(
  apiKey: string,
): Promise<TornUserPerks> {
  return fetchTorn<TornUserPerks>(
    `${TORN_API_V1_BASE}/user/?selections=perks&key=${apiKey}`,
  );
}

export async function fetchTornUserProfile(
  apiKey: string,
): Promise<TornUserProfileResponse> {
  return fetchTorn<TornUserProfileResponse>(
    `${TORN_API_BASE}/user/profile?key=${apiKey}`,
  );
}

export interface TornUserBarsResponse {
  bars?: {
    energy?: { current: number; maximum: number };
    nerve?: { current: number; maximum: number };
    happy?: { current: number; maximum: number };
    life?: { current: number; maximum: number };
  };
  error?: {
    code: number;
    error: string;
  };
}

export async function fetchTornUserBars(
  apiKey: string,
): Promise<TornUserBarsResponse> {
  return fetchTorn<TornUserBarsResponse>(
    `${TORN_API_BASE}/user/bars?key=${apiKey}`,
  );
}

export interface TornUserCooldownsResponse {
  cooldowns?: {
    drug: number;
    medical: number;
    booster: number;
  };
  error?: {
    code: number;
    error: string;
  };
}

export async function fetchTornUserCooldowns(
  apiKey: string,
): Promise<TornUserCooldownsResponse> {
  return fetchTorn<TornUserCooldownsResponse>(
    `${TORN_API_BASE}/user/cooldowns?key=${apiKey}`,
  );
}

export interface TornUserDiscordResponse {
  discord?: {
    discord_id: string;
    user_id: number;
  };
  error?: {
    code: number;
    error: string;
  };
}

export async function fetchTornUserDiscord(
  apiKey: string,
): Promise<TornUserDiscordResponse> {
  return fetchTorn<TornUserDiscordResponse>(
    `${TORN_API_BASE}/user/discord?key=${apiKey}`,
  );
}

export async function fetchTornItems(
  apiKey: string,
): Promise<TornItemsResponse> {
  return fetchTorn<TornItemsResponse>(
    `${TORN_API_BASE}/torn/items?key=${apiKey}`,
  );
}
export async function fetchTornItemMarket(
  apiKey: string,
  itemId: number,
  limit = 1,
): Promise<TornItemMarketResponse> {
  return fetchTorn<TornItemMarketResponse>(
    `${TORN_API_BASE}/market/${itemId}/itemmarket?limit=${limit}&key=${apiKey}`,
  );
}
/**
 * API Key Rotation Manager for distributing requests across multiple keys.
 * Supports sequential or concurrent batch processing.
 */
export class ApiKeyRotator {
  private keys: string[];
  private currentIndex: number = 0;

  constructor(keys: string[]) {
    if (!keys.length) {
      throw new Error("ApiKeyRotator requires at least one API key");
    }
    this.keys = keys;
  }

  /**
   * Get the next key in round-robin rotation
   */
  getNextKey(): string {
    const key = this.keys[this.currentIndex];
    this.currentIndex = (this.currentIndex + 1) % this.keys.length;
    return key;
  }

  /**
   * Process items concurrently, one per API key in parallel.
   * Useful when you have N keys and want N concurrent requests.
   * @param items - Items to process
   * @param handler - Async function that takes item and API key
   * @param delayMs - Delay between batches to avoid spikes
   */
  async processConcurrent<T, R>(
    items: T[],
    handler: (item: T, apiKey: string) => Promise<R>,
    delayMs: number = 0,
  ): Promise<R[]> {
    const results: R[] = [];
    const concurrency = this.keys.length;

    for (let i = 0; i < items.length; i += concurrency) {
      const batch = items.slice(i, i + concurrency);
      const batchResults = await Promise.all(
        batch.map((item, idx) =>
          handler(item, this.keys[idx % this.keys.length]),
        ),
      );
      results.push(...batchResults);

      // Delay before next batch (except after last)
      if (i + concurrency < items.length && delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }

    return results;
  }

  /**
   * Process items sequentially with per-request delay and key rotation.
   * @param items - Items to process
   * @param handler - Async function that takes item and API key
   * @param delayMs - Delay between requests
   */
  async processSequential<T, R>(
    items: T[],
    handler: (item: T, apiKey: string) => Promise<R>,
    delayMs: number = 700,
  ): Promise<R[]> {
    const results: R[] = [];

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const apiKey = this.getNextKey();
      const result = await handler(item, apiKey);
      results.push(result);

      // Delay between requests (except after last)
      if (i < items.length - 1 && delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }

    return results;
  }

  /**
   * Get number of available keys
   */
  getKeyCount(): number {
    return this.keys.length;
  }
}
