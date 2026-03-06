/**
 * Assist Monitoring Module
 * Tracks abuse patterns and security metrics for assist proxy endpoints
 */

import { supabase } from "./supabase.js";

type SecurityEvent = {
  event_type: "proxy_auth_failure" | "payload_too_large" | "rate_limit_hit";
  severity: "low" | "medium" | "high";
  status_code: number;
  ip_address: string | null;
  user_agent: string | null;
  path: string;
  details: Record<string, unknown>;
};

/**
 * Log security/abuse events to console with structured format
 * In production, you could send these to a monitoring service (Sentry, Datadog, etc.)
 */
export function logSecurityEvent(event: SecurityEvent): void {
  const timestamp = new Date().toISOString();
  const logLevel = event.severity === "high" ? "error" : "warn";

  const logMessage = {
    timestamp,
    category: "assist_security",
    ...event,
  };

  console[logLevel](
    `[ASSIST_SECURITY] ${event.event_type} (${event.status_code}):`,
    JSON.stringify(logMessage),
  );

  // Optional: persist to database for analysis
  // persistSecurityEvent(event).catch(err => console.error('Failed to persist security event:', err));
}

/**
 * Log proxy authentication failure (401)
 */
export function logProxyAuthFailure(
  path: string,
  ipAddress: string | null,
  userAgent: string | null,
): void {
  logSecurityEvent({
    event_type: "proxy_auth_failure",
    severity: "high",
    status_code: 401,
    ip_address: ipAddress,
    user_agent: userAgent,
    path,
    details: {
      message: "Invalid or missing proxy secret header",
    },
  });
}

/**
 * Log payload size violation (413)
 */
export function logPayloadTooLarge(
  path: string,
  ipAddress: string | null,
  userAgent: string | null,
  payloadSize: number,
  maxAllowed: number,
): void {
  logSecurityEvent({
    event_type: "payload_too_large",
    severity: "medium",
    status_code: 413,
    ip_address: ipAddress,
    user_agent: userAgent,
    path,
    details: {
      payload_size_bytes: payloadSize,
      max_allowed_bytes: maxAllowed,
      message: "Request payload exceeded size limit",
    },
  });
}

/**
 * Log rate limit hit (429)
 */
export function logRateLimitHit(
  path: string,
  ipAddress: string | null,
  userAgent: string | null,
  uuid: string,
): void {
  logSecurityEvent({
    event_type: "rate_limit_hit",
    severity: "medium",
    status_code: 429,
    ip_address: ipAddress,
    user_agent: userAgent,
    path,
    details: {
      uuid,
      message: "Request rate limit exceeded (30s window)",
    },
  });
}

/**
 * Optional: Persist security events to database for analysis
 * Uncomment and implement if you want historical tracking
 */
/*
async function persistSecurityEvent(event: SecurityEvent): Promise<void> {
  await supabase
    .from('sentinel_assist_security_events')
    .insert({
      event_type: event.event_type,
      severity: event.severity,
      status_code: event.status_code,
      ip_address: event.ip_address,
      user_agent: event.user_agent,
      path: event.path,
      details: event.details,
      created_at: new Date().toISOString(),
    });
}
*/
