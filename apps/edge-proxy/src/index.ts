const PROXY_SECRET_HEADER = "Proxy-Secret-Header";
const ALLOWED_API_PATHS = new Set(["/api/assist-events"]);
const ALLOWED_API_METHODS = new Set(["POST", "PATCH", "DELETE"]);
const UUID_PATH_RE =
  /^\/install\/([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.user\.js$/i;

/**
 * Verify HMAC signature for install link
 * Uses the same algorithm as assist-link-signing.ts for consistency
 */
async function verifyInstallLinkSignature(
  uuid: string,
  expiresAt: string,
  providedSignature: string,
  secret: string,
): Promise<{ valid: boolean; reason?: string }> {
  // Check expiry first
  const expiresAtNum = Number.parseInt(expiresAt, 10);
  if (!Number.isFinite(expiresAtNum)) {
    return { valid: false, reason: "Invalid expiry format" };
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  if (expiresAtNum <= nowSeconds) {
    return { valid: false, reason: "Link expired" };
  }

  // Verify signature using SubtleCrypto (Cloudflare Workers API)
  try {
    const encoder = new TextEncoder();
    const message = encoder.encode(`${uuid}.${expiresAtNum}`);
    const key = await crypto.subtle.importKey(
      "raw",
      encoder.encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );

    // Bot signs with base64url; compute and compare the same representation.
    const expectedSignatureBuffer = await crypto.subtle.sign(
      "HMAC",
      key,
      message,
    );
    const expectedSignature = btoa(
      String.fromCharCode(...new Uint8Array(expectedSignatureBuffer)),
    )
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/g, "");

    const isValid = expectedSignature === providedSignature;

    if (!isValid) {
      return { valid: false, reason: "Invalid signature" };
    }

    return { valid: true };
  } catch (error) {
    return { valid: false, reason: "Signature verification failed" };
  }
}

export interface Env {
  BOT_ORIGIN: string;
  ASSIST_PROXY_SECRET: string;
  ASSIST_MAX_JSON_BYTES?: string;
}

function jsonResponse(
  status: number,
  payload: Record<string, unknown>,
): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

function normalizeBotOrigin(origin: string): string {
  return origin.replace(/\/+$/, "");
}

function getJsonLimit(env: Env): number {
  const parsed = Number.parseInt(env.ASSIST_MAX_JSON_BYTES || "16384", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 16384;
  }

  return parsed;
}

async function proxyInstall(
  request: Request,
  env: Env,
  url: URL,
  uuid: string,
): Promise<Response> {
  // Validate signature and expiry from query params
  const exp = url.searchParams.get("exp");
  const sig = url.searchParams.get("sig");

  if (!exp || !sig) {
    return jsonResponse(401, {
      error: "Missing authentication parameters",
    });
  }

  const verification = await verifyInstallLinkSignature(
    uuid,
    exp,
    sig,
    env.ASSIST_PROXY_SECRET,
  );

  if (!verification.valid) {
    return jsonResponse(401, {
      error: verification.reason || "Authentication failed",
    });
  }

  // Forward to bot server after signature validation
  const upstreamUrl = new URL(
    `${normalizeBotOrigin(env.BOT_ORIGIN)}/internal/assist-install/${uuid}.user.js`,
  );
  upstreamUrl.search = url.search;

  const upstream = await fetch(upstreamUrl.toString(), {
    method: "GET",
    headers: {
      "User-Agent": request.headers.get("User-Agent") || "sentinel-edge-proxy",
      "X-Assist-Proxy-Origin": url.origin,
      "X-Assist-Client-IP":
        request.headers.get("CF-Connecting-IP") || "unknown",
      "X-Assist-Client-UA": request.headers.get("User-Agent") || "unknown",
      [PROXY_SECRET_HEADER]: env.ASSIST_PROXY_SECRET,
    },
  });

  const headers = new Headers(upstream.headers);
  headers.set("Content-Type", "application/javascript; charset=utf-8");
  headers.set("Cache-Control", "no-store");
  headers.set("X-Content-Type-Options", "nosniff");

  return new Response(upstream.body, {
    status: upstream.status,
    headers,
  });
}

async function proxyApi(
  request: Request,
  env: Env,
  url: URL,
): Promise<Response> {
  const jsonLimit = getJsonLimit(env);
  const contentType = request.headers.get("content-type") || "";
  if (!contentType.toLowerCase().includes("application/json")) {
    return jsonResponse(415, {
      error: "Content-Type must be application/json",
    });
  }

  const declaredLength = Number.parseInt(
    request.headers.get("content-length") || "0",
    10,
  );
  if (Number.isFinite(declaredLength) && declaredLength > jsonLimit) {
    return jsonResponse(413, { error: "JSON payload too large" });
  }

  const rawBody = await request.text();
  const actualLength = new TextEncoder().encode(rawBody).byteLength;
  if (actualLength > jsonLimit) {
    return jsonResponse(413, { error: "JSON payload too large" });
  }

  let parsed: unknown;
  try {
    parsed = rawBody ? JSON.parse(rawBody) : {};
  } catch {
    return jsonResponse(400, { error: "Invalid JSON body" });
  }

  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return jsonResponse(400, { error: "JSON body must be an object" });
  }

  const internalPath = url.pathname.replace(/^\/api\//, "/internal/");
  const upstreamUrl = `${normalizeBotOrigin(env.BOT_ORIGIN)}${internalPath}`;

  const upstream = await fetch(upstreamUrl, {
    method: request.method,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "User-Agent": request.headers.get("User-Agent") || "sentinel-edge-proxy",
      "X-Assist-Proxy-Origin": url.origin,
      "X-Assist-Client-IP":
        request.headers.get("CF-Connecting-IP") || "unknown",
      "X-Assist-Client-UA": request.headers.get("User-Agent") || "unknown",
      [PROXY_SECRET_HEADER]: env.ASSIST_PROXY_SECRET,
    },
    body: JSON.stringify(parsed),
  });

  const headers = new Headers(upstream.headers);
  headers.set("Cache-Control", "no-store");
  headers.set("X-Content-Type-Options", "nosniff");

  return new Response(upstream.body, {
    status: upstream.status,
    headers,
  });
}

export default {
  async fetch(request, env): Promise<Response> {
    if (!env.ASSIST_PROXY_SECRET) {
      return jsonResponse(500, {
        error: "Worker misconfigured: ASSIST_PROXY_SECRET missing",
      });
    }

    if (!env.BOT_ORIGIN) {
      return jsonResponse(500, {
        error: "Worker misconfigured: BOT_ORIGIN missing",
      });
    }

    const url = new URL(request.url);

    if (request.method === "GET") {
      const match = UUID_PATH_RE.exec(url.pathname);
      if (match) {
        return proxyInstall(request, env, url, match[1]);
      }
    }

    if (
      ALLOWED_API_METHODS.has(request.method) &&
      ALLOWED_API_PATHS.has(url.pathname)
    ) {
      return proxyApi(request, env, url);
    }

    return jsonResponse(404, { error: "Not found" });
  },
} satisfies ExportedHandler<Env>;
