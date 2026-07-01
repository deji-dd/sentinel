// src/lib/push-store.ts
// DB-backed subscription store communicating via bot's HTTP server.

import type webpush from "web-push";
import { getServerEnv } from "@/lib/server-config";

export type StoredSubscription = webpush.PushSubscription;

export async function readSubscriptions(): Promise<StoredSubscription[]> {
  try {
    const env = getServerEnv();
    const botOrigin = env.BOT_ORIGIN || env.NEXT_PUBLIC_BOT_ORIGIN;
    const secret = env.SENTINEL_INTERNAL_SECRET || env.PUSH_INTERNAL_SECRET;

    if (!botOrigin) {
      console.warn("[push-store] BOT_ORIGIN is not configured. Cannot read subscriptions.");
      return [];
    }

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (secret) {
      headers["x-sentinel-secret"] = secret;
    }

    const res = await fetch(`${botOrigin.replace(/\/$/, "")}/api/push/subscriptions`, {
      method: "GET",
      headers,
    });

    if (!res.ok) {
      console.error("[push-store] Failed to fetch subscriptions from bot:", res.status, await res.text());
      return [];
    }

    return await res.json() as StoredSubscription[];
  } catch (err) {
    console.error("[push-store] Error in readSubscriptions:", err);
    return [];
  }
}

export async function writeSubscriptions(subs: StoredSubscription[]): Promise<void> {
  try {
    const env = getServerEnv();
    const botOrigin = env.BOT_ORIGIN || env.NEXT_PUBLIC_BOT_ORIGIN;
    const secret = env.SENTINEL_INTERNAL_SECRET || env.PUSH_INTERNAL_SECRET;

    if (!botOrigin) {
      console.warn("[push-store] BOT_ORIGIN is not configured. Cannot write subscriptions.");
      return;
    }

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (secret) {
      headers["x-sentinel-secret"] = secret;
    }

    const res = await fetch(`${botOrigin.replace(/\/$/, "")}/api/push/subscriptions`, {
      method: "POST",
      headers,
      body: JSON.stringify(subs),
    });

    if (!res.ok) {
      console.error("[push-store] Failed to write subscriptions to bot:", res.status, await res.text());
    }
  } catch (err) {
    console.error("[push-store] Error in writeSubscriptions:", err);
  }
}
