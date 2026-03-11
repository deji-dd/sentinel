import { createHmac } from "crypto";

/**
 * HMAC-based signed install link utilities
 * Links expire after a configurable period (default 7 days) but installed scripts work forever
 */

const LINK_VALIDITY_SECONDS = Number.parseInt(
  process.env.ASSIST_LINK_VALIDITY_SECONDS || String(10 * 60), // 10 minutes default
  10,
);

const HMAC_ALGORITHM = "sha256";
const ASSIST_EVENT_AUTH_CONTEXT = "assist_event_v1";

function getSigningSecret(): string {
  const secret = process.env.ASSIST_SIGNING_SECRET || process.env.ASSIST_PROXY_SECRET;
  if (!secret) {
    throw new Error("ASSIST_SIGNING_SECRET (or ASSIST_PROXY_SECRET) is required for signed install links");
  }
  return secret;
}

/**
 * Generate HMAC signature for install link
 * @param uuid - Token UUID
 * @param expiresAt - Unix timestamp (seconds) when link expires
 * @returns Base64-encoded HMAC signature
 */
export function generateLinkSignature(uuid: string, expiresAt: number): string {
  const secret = getSigningSecret();
  const message = `${uuid}.${expiresAt}`;
  const hmac = createHmac(HMAC_ALGORITHM, secret);
  hmac.update(message);
  return hmac.digest("base64url");
}

/**
 * Generate stable HMAC token used by userscript assist event payloads.
 */
export function generateAssistEventAuthToken(uuid: string): string {
  const secret = getSigningSecret();
  const message = `${uuid}.${ASSIST_EVENT_AUTH_CONTEXT}`;
  const hmac = createHmac(HMAC_ALGORITHM, secret);
  hmac.update(message);
  return hmac.digest("base64url");
}

/**
 * Verify HMAC signature for install link
 * @param uuid - Token UUID
 * @param expiresAt - Unix timestamp (seconds) from query params
 * @param providedSignature - Signature from query params
 * @returns true if signature is valid and link has not expired
 */
export function verifyLinkSignature(
  uuid: string,
  expiresAt: number,
  providedSignature: string,
): { valid: boolean; reason?: string } {
  // Check expiry first
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (expiresAt <= nowSeconds) {
    return { valid: false, reason: "Link expired" };
  }

  // Verify signature
  const expectedSignature = generateLinkSignature(uuid, expiresAt);
  const signaturesMatch =
    expectedSignature === providedSignature &&
    expectedSignature.length > 0 &&
    providedSignature.length > 0;

  if (!signaturesMatch) {
    return { valid: false, reason: "Invalid signature" };
  }

  return { valid: true };
}

/**
 * Create a signed install URL
 * @param baseUrl - Base URL (e.g., "https://worker.dev/install")
 * @param uuid - Token UUID
 * @returns Full signed URL with expiry and signature query params
 */
export function createSignedInstallUrl(baseUrl: string, uuid: string): string {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const expiresAt = nowSeconds + LINK_VALIDITY_SECONDS;
  const signature = generateLinkSignature(uuid, expiresAt);

  const url = new URL(`${baseUrl}/${uuid}.user.js`);
  url.searchParams.set("exp", String(expiresAt));
  url.searchParams.set("sig", signature);

  return url.toString();
}

/**
 * Get link validity duration in human-readable format
 */
export function getLinkValidityDescription(): string {
  const days = Math.floor(LINK_VALIDITY_SECONDS / (24 * 60 * 60));
  const hours = Math.floor(
    (LINK_VALIDITY_SECONDS % (24 * 60 * 60)) / (60 * 60),
  );

  if (days > 0 && hours > 0) {
    return `${days} day${days !== 1 ? "s" : ""} and ${hours} hour${hours !== 1 ? "s" : ""}`;
  } else if (days > 0) {
    return `${days} day${days !== 1 ? "s" : ""}`;
  } else if (hours > 0) {
    return `${hours} hour${hours !== 1 ? "s" : ""}`;
  } else {
    const minutes = Math.floor(LINK_VALIDITY_SECONDS / 60);
    return `${minutes} minute${minutes !== 1 ? "s" : ""}`;
  }
}
