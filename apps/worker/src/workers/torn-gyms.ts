import { executeSync } from "../lib/sync.js";
import { startDbScheduledRunner } from "../lib/scheduler.js";
import { logError } from "../lib/logger.js";
import { getPersonalApiKey, supabase } from "../lib/supabase.js";
import { tornApi } from "../services/torn-client.js";

const WORKER_NAME = "torn_gyms_worker";
const DAILY_CADENCE_SECONDS = 86400; // 24h

function nextUtcThreeAm(): string {
  const now = new Date();
  const target = new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
      3,
      0,
      0,
      0,
    ),
  );
  if (target <= now) {
    target.setUTCDate(target.getUTCDate() + 1);
  }
  return target.toISOString();
}

interface GymRow {
  id: number;
  name: string;
  energy: number;
  strength: number;
  speed: number;
  dexterity: number;
  defense: number;
}

async function syncTornGyms(): Promise<void> {
  const apiKey = getPersonalApiKey();

  // Fetch gyms from Torn API
  const response = await tornApi.get("/torn", {
    apiKey,
    queryParams: { selections: ["gyms"] },
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const gymsData: any = (response as any).gyms;
  if (!gymsData || typeof gymsData !== "object") {
    logError(WORKER_NAME, "No gyms data received from Torn API");
    throw new Error("No gyms data in response");
  }

  // Convert gyms object to array, preserving IDs from object keys
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const gymsArray: any[] = Array.isArray(gymsData)
    ? gymsData
    : // eslint-disable-next-line @typescript-eslint/no-explicit-any
      Object.entries(gymsData).map(([id, gym]: [string, any]) => ({
        ...gym,
        id: Number(id),
      }));

  // Normalize gym data
  const gyms: GymRow[] = gymsArray
    .map((gym) => {
      const id = typeof gym.id === "number" ? gym.id : Number(gym.id);
      const name = typeof gym.name === "string" ? gym.name : null;
      if (!id || !name) return null;

      return {
        id,
        name,
        energy: typeof gym.energy === "number" ? gym.energy : 0,
        strength: typeof gym.strength === "number" ? gym.strength : 0,
        speed: typeof gym.speed === "number" ? gym.speed : 0,
        dexterity: typeof gym.dexterity === "number" ? gym.dexterity : 0,
        defense: typeof gym.defense === "number" ? gym.defense : 0,
      } as GymRow;
    })
    .filter((gym): gym is GymRow => Boolean(gym));

  if (gyms.length === 0) {
    logError(WORKER_NAME, "No valid gyms parsed from API response");
    throw new Error("No valid gyms parsed from response");
  }

  // Upsert gyms (replace existing)
  const { error } = await supabase
    .from("sentinel_torn_gyms")
    .upsert(gyms, { onConflict: "id" });

  if (error) {
    throw error;
  }
}

export function startTornGymsWorker(): void {
  startDbScheduledRunner({
    worker: WORKER_NAME,
    defaultCadenceSeconds: DAILY_CADENCE_SECONDS,
    pollIntervalMs: 5000,
    initialNextRunAt: nextUtcThreeAm(),
    handler: async () => {
      return await executeSync({
        name: WORKER_NAME,
        timeout: 300000, // 5 minutes
        handler: syncTornGyms,
      });
    },
  });
}
