"use server";

import { apiFetch } from "@sentinel/utils";

export async function getCrimesAnalyticsAction(days = 30) {
  try {
    const res = await apiFetch(`/crimes/analytics?days=${days}`);
    if (!res.ok) {
      throw new Error(`Crimes analytics fetch failed with status ${res.status}`);
    }
    return await res.json();
  } catch (err) {
    console.error("Error in getCrimesAnalyticsAction:", err);
    throw err;
  }
}

export async function getCrimesCategoriesAction() {
  try {
    const res = await apiFetch("/crimes/categories");
    if (!res.ok) {
      throw new Error(`Crimes categories fetch failed with status ${res.status}`);
    }
    return await res.json();
  } catch (err) {
    console.error("Error in getCrimesCategoriesAction:", err);
    throw err;
  }
}

export async function getCrimesLogsAction(options: {
  date?: string;
  crimeId?: string | number;
  search?: string;
  page?: number;
  limit?: number;
}) {
  try {
    const params = new URLSearchParams();
    if (options.date) params.set("date", options.date);
    if (options.crimeId !== undefined && options.crimeId !== "") {
      params.set("crimeId", String(options.crimeId));
    }
    if (options.search) params.set("search", options.search);
    if (options.page) params.set("page", String(options.page));
    if (options.limit) params.set("limit", String(options.limit));

    const res = await apiFetch(`/crimes/logs?${params.toString()}`);
    if (!res.ok) {
      throw new Error(`Crimes logs fetch failed with status ${res.status}`);
    }
    return await res.json();
  } catch (err) {
    console.error("Error in getCrimesLogsAction:", err);
    throw err;
  }
}

export async function categorizeCrimeAction(action: string, targetCrimeId: number) {
  try {
    const res = await apiFetch("/crimes/categorize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, targetCrimeId }),
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.message || `Categorization failed with status ${res.status}`);
    }
    return await res.json();
  } catch (err) {
    console.error("Error in categorizeCrimeAction:", err);
    throw err;
  }
}

export async function initCrimesLedgerAction() {
  try {
    const res = await apiFetch("/crimes/init", {
      method: "POST",
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.message || `Crimes ledger init failed with status ${res.status}`);
    }
    return await res.json();
  } catch (err) {
    console.error("Error in initCrimesLedgerAction:", err);
    throw err;
  }
}
