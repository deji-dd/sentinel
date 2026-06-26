// apps/bot/src/lib/push-notify.ts
// Helper to send a push notification via the Next.js dashboard API.
// Both bot and worker import this; they run in the same Node.js environment.
// Reads UI_ORIGIN and PUSH_INTERNAL_SECRET from process.env (loaded by dotenv).

interface PushPayload {
  title: string;
  body: string;
  url?: string;
  icon?: string;
}

/**
 * Sends a push notification to all subscribed browsers via the dashboard API.
 * No-ops silently if the required env vars are not configured.
 *
 * Usage:
 *   import { sendPushNotification } from "./lib/push-notify.js";
 *   await sendPushNotification({ title: "Alert", body: "Something happened" });
 */
export async function sendPushNotification(payload: PushPayload): Promise<void> {
  const isDev = process.env.NODE_ENV !== "production";
  const uiOrigin = isDev
    ? (process.env.UI_ORIGIN_LOCAL ?? "http://localhost:3000")
    : (process.env.UI_ORIGIN ?? "");
  const secret = process.env.PUSH_INTERNAL_SECRET ?? "";

  if (!uiOrigin || !secret) {
    console.warn("[push] UI_ORIGIN or PUSH_INTERNAL_SECRET not set — skipping push notification");
    return;
  }

  try {
    const res = await fetch(`${uiOrigin}/api/push/send`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-push-secret": secret,
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      console.error("[push] Send failed:", res.status, await res.text());
    } else {
      const data = await res.json() as { sent: number };
      if (data.sent > 0) {
        console.log(`[push] Delivered to ${data.sent} subscriber(s)`);
      }
    }
  } catch (err) {
    console.error("[push] Network error sending push notification:", err);
  }
}
