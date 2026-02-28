import { executeSync } from "../lib/sync.js";
import { startDbScheduledRunner } from "../lib/scheduler.js";
import { logDuration, logError } from "../lib/logger.js";
import { getSystemApiKey } from "../lib/api-keys.js";
import { supabase } from "../lib/supabase.js";
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

function calculateGymUnlocked(
  gymId: number,
  stage: number,
  userStats: UserStats,
): boolean {
  // Gyms with stage < 4 are always unlocked
  if (stage < 4) {
    return true;
  }

  // Gyms 31 and 32 are always locked
  if (gymId === 31 || gymId === 32) {
    return false;
  }

  // For gyms 25-30, check stat requirements
  const { strength, speed, defense, dexterity } = userStats;

  switch (gymId) {
    case 25:
      // Defense + Dexterity 25% higher than Strength + Speed
      return defense + dexterity > (strength + speed) * 1.25;
    case 26:
      // Strength + Speed 25% higher than Dexterity + Defense
      return strength + speed > (defense + dexterity) * 1.25;
    case 27: {
      // Strength 25% higher than second highest stat
      const stats = [strength, speed, defense, dexterity].sort((a, b) => b - a);
      return strength > stats[1] * 1.25;
    }
    case 28: {
      // Defense 25% higher than second highest stat
      const stats = [strength, speed, defense, dexterity].sort((a, b) => b - a);
      return defense > stats[1] * 1.25;
    }
    case 29: {
      // Speed 25% higher than second highest stat
      const stats = [strength, speed, defense, dexterity].sort((a, b) => b - a);
      return speed > stats[1] * 1.25;
    }
    case 30: {
      // Dexterity 25% higher than second highest stat
      const stats = [strength, speed, defense, dexterity].sort((a, b) => b - a);
      return dexterity > stats[1] * 1.25;
    }
    default:
      // Gyms 1-24 are unlocked based on stage only (stage < 4)
      return false;
  }
}

interface GymRow {
  id: number;
  name: string;
  energy: number;
  strength: number;
  speed: number;
  dexterity: number;
  defense: number;
  unlocked: boolean;
}

interface UserStats {
  strength: number;
  speed: number;
  defense: number;
  dexterity: number;
}

interface TornGym {
  name: string;
  stage: number;
  cost: number;
  energy: number;
  strength: number;
  speed: number;
  defense: number;
  dexterity: number;
  note: string;
}

interface TornGymsResponse {
  gyms: Record<string, TornGym>;
}

async function syncTornGyms(): Promise<void> {
  const startTime = Date.now();

  try {
    const apiKey = await getSystemApiKey("personal");

    // Fetch gyms from Torn API
    const gymsResponse = await tornApi.get<TornGymsResponse>("/torn", {
      apiKey,
      queryParams: { selections: ["gyms"] },
    });

    // Extract gyms data (getRaw throws on API errors, so no need to check)
    const gymsData = gymsResponse.gyms;
    if (!gymsData || typeof gymsData !== "object") {
      throw new Error("No gyms data in response");
    }

    // Fetch user stats from most recent snapshot in database
    const { data: snapshotData, error: snapshotError } = await supabase
      .from("sentinel_user_snapshots")
      .select("strength, speed, defense, dexterity")
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    if (snapshotError) {
      logError(
        WORKER_NAME,
        `Failed to fetch user snapshot: ${snapshotError.message}`,
      );
      throw snapshotError;
    }

    const userStats: UserStats = {
      strength: snapshotData?.strength || 0,
      speed: snapshotData?.speed || 0,
      defense: snapshotData?.defense || 0,
      dexterity: snapshotData?.dexterity || 0,
    };

    // Convert gyms object to array, preserving IDs from object keys
    const gymsArray = Object.entries(gymsData).map(([id, gym]) => ({
      ...gym,
      id: Number(id),
    }));

    // Normalize gym data
    const gyms: GymRow[] = gymsArray
      .map((gym) => {
        const id = typeof gym.id === "number" ? gym.id : Number(gym.id);
        const name = typeof gym.name === "string" ? gym.name : null;
        if (!id || !name) return null;

        const stage = typeof gym.stage === "number" ? gym.stage : 0;
        const unlocked = calculateGymUnlocked(id, stage, userStats);

        return {
          id,
          name,
          energy: typeof gym.energy === "number" ? gym.energy : 0,
          strength: typeof gym.strength === "number" ? gym.strength : 0,
          speed: typeof gym.speed === "number" ? gym.speed : 0,
          dexterity: typeof gym.dexterity === "number" ? gym.dexterity : 0,
          defense: typeof gym.defense === "number" ? gym.defense : 0,
          unlocked,
        } as GymRow;
      })
      .filter((gym): gym is GymRow => Boolean(gym));

    if (gyms.length === 0) {
      throw new Error("No valid gyms parsed from response");
    }

    // Upsert gyms (replace existing)
    const { error } = await supabase
      .from("sentinel_torn_gyms")
      .upsert(gyms, { onConflict: "id" });

    if (error) {
      throw error;
    }

    const duration = Date.now() - startTime;
    logDuration(
      WORKER_NAME,
      `Sync completed for ${gyms.length} gyms`,
      duration,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logError(WORKER_NAME, `Sync failed: ${message}`);
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
