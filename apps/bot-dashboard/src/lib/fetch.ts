/**
 * Central fetch wrapper for @sentinel/bot-dashboard.
 * Automatically injects the `x-sentinel-secret` header ONLY into requests sent to
 * the internal Fastify API server (to authenticate through Cloudflare Tunnel / WAF rules).
 */
export async function apiFetch(
  input: string | URL | globalThis.Request,
  init?: RequestInit,
): Promise<Response> {
  const secret = process.env.SENTINEL_INTERNAL_SECRET;
  const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:3001";
  const urlStr = typeof input === "string" ? input : input.toString();

  const headers = new Headers(init?.headers);

  // Only inject x-sentinel-secret header for API server requests
  if (secret && (urlStr.startsWith(apiUrl) || urlStr.startsWith("/api") || !urlStr.startsWith("http"))) {
    if (!headers.has("x-sentinel-secret")) {
      headers.set("x-sentinel-secret", secret);
    }
  }

  return fetch(input, {
    ...init,
    headers,
  });
}

// Re-export as customFetch for backwards compatibility
export const customFetch = apiFetch;
