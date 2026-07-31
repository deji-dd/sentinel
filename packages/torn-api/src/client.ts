import type { paths } from "./torn-api.js";
import {
  TornError,
  TORN_ERROR_CODES,
  type RateLimitTracker,
  type TornApiConfig,
  type PathOperation,
  type OperationResponse,
  type OperationQueryParams,
  type OperationPathParams,
} from "./types.js";

const TORN_API_BASE = "https://api.torn.com/v2";
const TORN_API_V1_BASE = "https://api.torn.com";
const REQUEST_TIMEOUT = 30000;

/**
 * Pure, stateless Torn API client with strict OpenAPI type inference.
 */
export class TornApiClient {
  private rateLimitTracker?: RateLimitTracker;
  private onInvalidKey?: (apiKey: string, errorCode: number) => Promise<void>;
  private timeout: number;

  constructor(config: TornApiConfig = {}) {
    this.rateLimitTracker = config.rateLimitTracker;
    this.onInvalidKey = config.onInvalidKey;
    this.timeout = config.timeout ?? REQUEST_TIMEOUT;
  }

  /**
   * Helper to replace `{param}` path placeholders.
   */
  private replacePath(
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

  /**
   * Type-safe GET request for Torn API v2 endpoints with OpenAPI inference.
   */
  async get<P extends keyof paths>(
    path: P,
    options: {
      apiKey: string;
      pathParams?: OperationPathParams<PathOperation<P>>;
      queryParams?: OperationQueryParams<PathOperation<P>>;
    },
  ): Promise<OperationResponse<PathOperation<P>>>;

  /**
   * Dynamic path variant for runtime-constructed paths.
   */
  async get<T extends Record<string, any> = any>(
    path: Exclude<string, keyof paths>,
    options: {
      apiKey: string;
      pathParams?: Record<string, string | number>;
      queryParams?: Record<string, any>;
    },
  ): Promise<T>;

  /**
   * Implementation handling both overloads.
   */
  async get<
    P extends keyof paths = keyof paths,
    T extends Record<string, any> = any,
  >(
    path: P | string,
    options: {
      apiKey: string;
      pathParams?: Record<string, string | number | any>;
      queryParams?: Record<string, any>;
    },
  ): Promise<OperationResponse<PathOperation<P>> | T> {
    const { apiKey, pathParams, queryParams } = options;

    if (this.rateLimitTracker) {
      await this.rateLimitTracker.waitIfNeeded(apiKey);
    }

    let url = `${TORN_API_BASE}${this.replacePath(String(path), pathParams)}`;

    const params = new URLSearchParams();
    params.append("key", apiKey);
    params.append("timestamp", String(Math.floor(Date.now() / 1000)));

    if (queryParams) {
      for (const [key, value] of Object.entries(queryParams)) {
        if (value !== undefined && value !== null && value !== "") {
          if (Array.isArray(value)) {
            params.append(key, value.join(","));
          } else {
            params.append(key, String(value));
          }
        }
      }
    }

    url += `?${params.toString()}`;

    const maxAttempts = 3;
    let lastError: any = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeout);

      try {
        const response = await fetch(url, {
          signal: controller.signal,
          headers: { Accept: "application/json" },
        });

        const data = (await response.json()) as any;

        if (data && typeof data === "object" && "error" in data) {
          const error = data.error as { code: number; error: string };
          const errorMessage =
            TORN_ERROR_CODES[error.code] ||
            error.error ||
            `Error code ${error.code}`;

          if (error.code === 2 && this.onInvalidKey) {
            await this.onInvalidKey(apiKey, error.code);
          }

          throw new TornError(error.code, errorMessage);
        }

        if (!response.ok) {
          throw new Error(`Torn API returned status ${response.status}`);
        }

        if (this.rateLimitTracker) {
          await this.rateLimitTracker.recordRequest(apiKey);
        }

        return data;
      } catch (error: any) {
        lastError = error;
        const isRateLimit =
          (error instanceof TornError && error.code === 5) ||
          (error &&
            error.message &&
            (error.message.includes("rate limit") ||
              error.message.includes("Rate limit")));

        const isNetworkOrTimeout =
          error instanceof TypeError ||
          error.name === "AbortError" ||
          (error.message && error.message.includes("status")) ||
          isRateLimit;

        if (!isNetworkOrTimeout || attempt === maxAttempts) {
          throw error;
        }

        const delay = isRateLimit ? 5000 * attempt : 200 * attempt;
        await new Promise((resolve) => setTimeout(resolve, delay));
      } finally {
        clearTimeout(timeoutId);
      }
    }

    throw lastError;
  }

  /**
   * Make a raw GET request to legacy Torn API v1 endpoints.
   */
  async getRaw<T = any>(
    path: string,
    options: {
      apiKey: string;
      queryParams?: Record<string, any>;
    },
  ): Promise<T> {
    const { apiKey, queryParams } = options;

    if (this.rateLimitTracker) {
      await this.rateLimitTracker.waitIfNeeded(apiKey);
    }

    const cleanPath = path.startsWith("/") ? path : `/${path}`;
    let url = `${TORN_API_V1_BASE}${cleanPath}`;

    const params = new URLSearchParams();
    params.append("key", apiKey);

    if (queryParams) {
      for (const [key, value] of Object.entries(queryParams)) {
        if (value !== undefined && value !== null && value !== "") {
          if (Array.isArray(value)) {
            params.append(key, value.join(","));
          } else {
            params.append(key, String(value));
          }
        }
      }
    }

    url += `?${params.toString()}`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: { Accept: "application/json" },
      });

      const data = (await response.json()) as any;

      if (data && typeof data === "object" && "error" in data) {
        const error = data.error as { code: number; error: string };
        const errorMessage =
          TORN_ERROR_CODES[error.code] ||
          error.error ||
          `Error code ${error.code}`;

        if (error.code === 2 && this.onInvalidKey) {
          await this.onInvalidKey(apiKey, error.code);
        }

        throw new TornError(error.code, errorMessage);
      }

      if (!response.ok) {
        throw new Error(`Torn API v1 returned status ${response.status}`);
      }

      if (this.rateLimitTracker) {
        await this.rateLimitTracker.recordRequest(apiKey);
      }

      return data;
    } finally {
      clearTimeout(timeoutId);
    }
  }
}

/**
 * Singleton stateless default client export
 */
export const tornApi = new TornApiClient();
