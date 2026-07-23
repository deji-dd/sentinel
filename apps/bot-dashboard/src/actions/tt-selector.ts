"use server";

import { auth } from "@/auth";
import type {
  UserMapsResponse,
  TerritoryMetadataResponse,
  SaveMapPayload,
} from "@sentinel/shared";

function getApiHeaders() {
  const secret = process.env.SENTINEL_INTERNAL_SECRET || "";
  return {
    "Content-Type": "application/json",
    "x-sentinel-secret": secret,
  };
}

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:3001";

export async function getUserMaps(): Promise<UserMapsResponse> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");

  const res = await fetch(`${API_URL}/api/tt/maps?userId=${session.user.id}`, {
    headers: getApiHeaders(),
    cache: "no-store",
  });

  if (!res.ok) {
    throw new Error("Failed to fetch user maps");
  }

  return res.json();
}

export async function getTerritoryMetadata(): Promise<TerritoryMetadataResponse> {
  const res = await fetch(`${API_URL}/api/tt/metadata`, {
    headers: getApiHeaders(),
    next: { revalidate: 60 }, // Cache for 60s
  });

  if (!res.ok) {
    throw new Error("Failed to fetch territory metadata");
  }

  return res.json();
}

export async function saveUserMap(data: Omit<SaveMapPayload, "userId">) {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");

  const payload: SaveMapPayload = {
    ...data,
    userId: session.user.id,
  };

  const res = await fetch(`${API_URL}/api/tt/maps`, {
    method: "POST",
    headers: getApiHeaders(),
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    throw new Error("Failed to save user map");
  }

  // We intentionally do not call revalidatePath("/tt-selector") here
  // because the map client component manages its own state natively.
  // Revalidating causes Next.js to push new server props, which remounts
  // the entire Leaflet canvas map and wipes the visual assignment states.
}
