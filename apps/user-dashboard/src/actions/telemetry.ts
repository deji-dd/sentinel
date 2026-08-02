"use server";

import { apiFetch } from "@sentinel/utils";

export async function getTelemetryDataAction() {
  try {
    const res = await apiFetch("/system/telemetry");
    if (!res.ok) {
      throw new Error(`Telemetry fetch failed with status ${res.status}`);
    }
    return await res.json();
  } catch (err) {
    console.error("Error in getTelemetryDataAction:", err);
    throw err;
  }
}

export async function getSystemLogsAction(service = "all", limit = 60) {
  try {
    const res = await apiFetch(`/system/logs?service=${encodeURIComponent(service)}&limit=${limit}`);
    if (!res.ok) {
      throw new Error(`Logs fetch failed with status ${res.status}`);
    }
    return await res.json();
  } catch (err) {
    console.error("Error in getSystemLogsAction:", err);
    throw err;
  }
}

export async function restartServiceAction(service: string) {
  try {
    const res = await apiFetch("/system/restart", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ service }),
    });
    if (!res.ok) {
      throw new Error(`Restart service failed with status ${res.status}`);
    }
    return await res.json();
  } catch (err) {
    console.error("Error in restartServiceAction:", err);
    throw err;
  }
}
