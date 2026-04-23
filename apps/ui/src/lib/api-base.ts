/**
 * Get the API base URL with fallback endpoints for resilience.
 * Tries configured endpoint first, then falls back to common localhost endpoints.
 */
export function getApiBase(): string {
  const configuredBase = import.meta.env.VITE_API_URL;

  const apiBases = Array.from(
    new Set(
      [configuredBase, "http://127.0.0.1:3001", "http://localhost:3001"]
        .filter((base): base is string => Boolean(base))
        .map((base) => base.replace(/\/$/, "")),
    ),
  );

  // Return all bases for tryout logic; caller will try them in order
  return apiBases[0] || "http://localhost:3001";
}

/**
 * Get all API base URLs for trying in sequence.
 * Primary (configured), then localhost fallbacks.
 */
export function getApiBaseFallbacks(): string[] {
  const configuredBase = import.meta.env.VITE_API_URL;

  return Array.from(
    new Set(
      [configuredBase, "http://127.0.0.1:3001", "http://localhost:3001"]
        .filter((base): base is string => Boolean(base))
        .map((base) => base.replace(/\/$/, "")),
    ),
  );
}

/**
 * Helper to fetch with fallback endpoints.
 * Tries each endpoint in sequence until one succeeds.
 */
export async function fetchWithFallback(
  path: string,
  options?: RequestInit,
): Promise<Response> {
  const bases = getApiBaseFallbacks();
  let lastError: unknown;

  for (const base of bases) {
    try {
      const response = await fetch(`${base}${path}`, {
        ...options,
        signal: AbortSignal.timeout(10000), // 10s timeout per attempt
      });
      return response;
    } catch (error) {
      lastError = error;
      // Continue to next endpoint
      continue;
    }
  }

  throw (
    lastError ||
    new Error(`Unable to reach API from any endpoint: ${bases.join(", ")}`)
  );
}
