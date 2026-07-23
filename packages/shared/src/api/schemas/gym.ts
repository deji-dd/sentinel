import { LogBackfillProgressPayload } from "./status.js";
import { GymLedgerDocument, UserStateDocument, TornGymDocument, TornItemDocument } from "../../database/index.js";

export interface GymHistoryResponse {
  data: GymLedgerDocument[];
  initializing?: boolean;
  initTimestamp?: number;
}

export type BattlestatsDoc = Extract<UserStateDocument, { id: "battlestats" }>;
export type GymUnlocksDoc = Extract<UserStateDocument, { id: "gym_unlocks" }>;
export type GymPerksDoc = Extract<UserStateDocument, { id: "gym_perks" }>;
export type BoosterPerksDoc = Extract<UserStateDocument, { id: "booster_perks" }>;
export type BarsDoc = Extract<UserStateDocument, { id: "bars" }>;

export interface GymStateData {
  battlestats: BattlestatsDoc | null | undefined;
  gym_unlocks: GymUnlocksDoc | null | undefined;
  gym_perks: GymPerksDoc | null | undefined;
  booster_perks: BoosterPerksDoc | null | undefined;
  bars: BarsDoc | null | undefined;
  gym_build_preference: {
    build_type: "balanced" | "one_stat" | "two_stats" | "hanks" | "baldrs";
    high_stat: "strength" | "defense" | "speed" | "dexterity";
  };
  gyms: TornGymDocument[];
  items: TornItemDocument["data"][];
}

export interface GymStateResponse {
  data: GymStateData | null;
  initializing: boolean;
}

export interface UpdateGymBuildPreferencePayload {
  build_type: "balanced" | "one_stat" | "two_stats" | "hanks" | "baldrs";
  high_stat: "strength" | "defense" | "speed" | "dexterity";
}

