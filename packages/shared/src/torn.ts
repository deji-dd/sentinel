import type { paths } from "./generated/torn-api.js";

type PathsWithMethod<Method extends keyof paths[keyof paths]> = {
  [Path in keyof paths]: Method extends keyof paths[Path] ? Path : never;
}[keyof paths];

type GetPaths = PathsWithMethod<"get">;

type PathParameters<Path extends keyof paths> = paths[Path] extends {
  get: { parameters: { path: infer P } };
}
  ? P
  : never;

type QueryParameters<Path extends keyof paths> = paths[Path] extends {
  get: { parameters: { query?: infer Q } };
}
  ? Q
  : never;

type ResponseData<Path extends keyof paths> = paths[Path] extends {
  get: {
    responses: {
      200: {
        content: {
          "application/json": infer R;
        };
      };
    };
  };
}
  ? R
  : never;

const TORN_API_BASE = "https://api.torn.com/v2";
const TORN_API_V1_BASE = "https://api.torn.com";
const REQUEST_TIMEOUT = 30000; // 30 seconds - increased from 10s for better reliability

export interface TornApiError {
  error: {
    code: number;
    error: string;
  };
}

export const TORN_ERROR_CODES: Record<number, string> = {
  0: "Unknown error",
  1: "Key is empty",
  2: "Incorrect Key: API key is wrong/incorrect format",
  5: "Too many requests: Rate limited (max 100 per minute)",
  6: "Incorrect ID: User ID doesn't exist",
  7: "Incorrect ID: Faction ID doesn't exist",
  8: "Incorrect ID: Company ID doesn't exist",
  9: "Function disabled: API disabled by admin",
  10: "Key not found: API key owner is in federal jail",
  11: "Key change error: Cannot change API key owner in tutorial",
  12: "Key read error: Could not read key from database",
  13: "The key is temporarily disabled due to owner inactivity",
  14: "Daily read limit reached",
  15: "Temporary error: API disabled for system maintenance",
  16: "Access level insufficient: Key does not have permission",
  17: "Backend error: API encountered an error",
  18: "API system overloaded",
  19: "Backend database error",
  20: "System error: API encountered an error",
  21: "System maintenance",
  22: "Invalid response: API response missing required fields",
  23: "Invalid route: API endpoint does not exist",
  24: "Invalid request: Malformed request parameters",
  25: "Invalid access level: Not allowed with current key access",
  26: "Key paused: API key has been paused by owner",
};

/**
 * Rate limiting tracker interface - implement this to provide rate limiting
 */
export interface RateLimitTracker {
  waitIfNeeded(apiKey: string): Promise<void>;
  recordRequest(apiKey: string): Promise<void>;
}

/**
 * Configuration for TornApiClient
 */
export interface TornApiConfig {
  rateLimitTracker?: RateLimitTracker;
  timeout?: number;
}

/**
 * Type-safe Torn API client with auto-complete for paths and query parameters
 */
export class TornApiClient {
  private rateLimitTracker?: RateLimitTracker;
  private timeout: number;

  constructor(config: TornApiConfig = {}) {
    this.rateLimitTracker = config.rateLimitTracker;
    this.timeout = config.timeout ?? REQUEST_TIMEOUT;
  }

  /**
   * Make a type-safe GET request to the Torn API
   */
  async get<Path extends GetPaths>(
    path: Path,
    options: {
      apiKey: string;
      pathParams?: PathParameters<Path>;
      queryParams?: Omit<QueryParameters<Path>, "key">;
    },
  ): Promise<ResponseData<Path>> {
    const { apiKey, pathParams, queryParams } = options;

    // Apply rate limiting if configured
    if (this.rateLimitTracker) {
      await this.rateLimitTracker.waitIfNeeded(apiKey);
    }

    // Build URL with path parameters
    let url = `${TORN_API_BASE}${this.buildPath(path, pathParams as Record<string, string | number> | undefined)}`;

    // Add query parameters
    const params = new URLSearchParams();
    params.append("key", apiKey);

    // Add epoch timestamp to bypass global cache
    params.append("timestamp", String(Math.floor(Date.now() / 1000)));

    if (queryParams) {
      for (const [key, value] of Object.entries(queryParams)) {
        if (value !== undefined && value !== null) {
          params.append(key, String(value));
        }
      }
    }

    url += `?${params.toString()}`;

    // Make request with timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      controller.abort();
    }, this.timeout);

    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: { Accept: "application/json" },
      });
      const data = (await response.json()) as any;

      // Check for API errors
      if (data && typeof data === "object" && "error" in data) {
        const error = data.error as { code: number; error: string };
        const errorMessage =
          TORN_ERROR_CODES[error.code] || `Error code ${error.code}`;
        throw new Error(errorMessage);
      }

      if (!response.ok) {
        throw new Error(`Torn API returned status ${response.status}`);
      }

      // Record request for rate limiting
      if (this.rateLimitTracker) {
        await this.rateLimitTracker.recordRequest(apiKey);
      }
      return data as ResponseData<Path>;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Make a raw GET request to the Torn API (for v1 endpoints not in OpenAPI spec)
   */
  async getRaw<T>(
    path: string,
    apiKey: string,
    queryParams?: Record<string, string>,
  ): Promise<T> {
    // Apply rate limiting if configured
    if (this.rateLimitTracker) {
      await this.rateLimitTracker.waitIfNeeded(apiKey);
    }

    // Build URL
    let url = `${TORN_API_V1_BASE}${path}`;

    const params = new URLSearchParams();
    params.append("key", apiKey);

    if (queryParams) {
      for (const [key, value] of Object.entries(queryParams)) {
        if (value !== undefined && value !== null) {
          params.append(key, value);
        }
      }
    }

    url += `?${params.toString()}`;

    // Make request with timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: { Accept: "application/json" },
      });

      const data = (await response.json()) as any;

      // Check for API errors
      if (data && typeof data === "object" && "error" in data) {
        const error = data.error as { code: number; error: string };
        const errorMessage =
          TORN_ERROR_CODES[error.code] || `Error code ${error.code}`;
        throw new Error(errorMessage);
      }

      if (!response.ok) {
        throw new Error(`Torn API returned status ${response.status}`);
      }

      // Record request for rate limiting
      if (this.rateLimitTracker) {
        await this.rateLimitTracker.recordRequest(apiKey);
      }

      return data as T;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Build path with path parameters (e.g., /user/{id}/basic -> /user/123/basic)
   */
  private buildPath(
    path: string,
    pathParams?: Record<string, string | number>,
  ): string {
    if (!pathParams) return path;

    let result = path;
    for (const [key, value] of Object.entries(pathParams)) {
      result = result.replace(`{${key}}`, String(value));
    }
    return result;
  }
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
