"use server";

import { apiFetch } from "@sentinel/utils";

export async function getPersonalLogsAnalyticsAction(days = 30) {
  try {
    const res = await apiFetch(`/personal-logs/analytics?days=${days}`);
    if (!res.ok) {
      throw new Error(`Personal logs analytics fetch failed with status ${res.status}`);
    }
    return await res.json();
  } catch (err) {
    console.error("Error in getPersonalLogsAnalyticsAction:", err);
    throw err;
  }
}

export async function getPersonalLogsByDateAction(options: {
  date?: string;
  category?: string;
  search?: string;
  page?: number;
  limit?: number;
}) {
  try {
    const params = new URLSearchParams();
    if (options.date) params.set("date", options.date);
    if (options.category) params.set("category", options.category);
    if (options.search) params.set("search", options.search);
    if (options.page) params.set("page", String(options.page));
    if (options.limit) params.set("limit", String(options.limit));

    const res = await apiFetch(`/personal-logs?${params.toString()}`);
    if (!res.ok) {
      throw new Error(`Personal logs fetch failed with status ${res.status}`);
    }
    return await res.json();
  } catch (err) {
    console.error("Error in getPersonalLogsByDateAction:", err);
    throw err;
  }
}

export async function resyncPersonalLogsAction(from: string | number, to: string | number) {
  try {
    const res = await apiFetch("/personal-logs/resync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ from, to }),
    });
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.message || `Re-sync failed with status ${res.status}`);
    }
    return await res.json();
  } catch (err) {
    console.error("Error in resyncPersonalLogsAction:", err);
    throw err;
  }
}
