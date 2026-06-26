// src/lib/push-store.ts
// Simple file-based subscription store.
// In production, replace with your database (SQLite via bot's DB is ideal).

import { promises as fs } from "fs";
import path from "path";
import type webpush from "web-push";

export type StoredSubscription = webpush.PushSubscription;

const STORE_PATH = path.join(process.cwd(), "data", "push-subscriptions.json");

export async function readSubscriptions(): Promise<StoredSubscription[]> {
  try {
    const raw = await fs.readFile(STORE_PATH, "utf-8");
    return JSON.parse(raw) as StoredSubscription[];
  } catch {
    return [];
  }
}

export async function writeSubscriptions(subs: StoredSubscription[]): Promise<void> {
  await fs.mkdir(path.dirname(STORE_PATH), { recursive: true });
  await fs.writeFile(STORE_PATH, JSON.stringify(subs, null, 2), "utf-8");
}
