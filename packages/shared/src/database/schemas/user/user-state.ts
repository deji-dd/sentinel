import { BaseDocument, Collection } from "../../collection.js";
import { sentinelDbEngine } from "../../engine.js";

export type UserStateDocument = BaseDocument &
  (
    | {
        id: "gym_perks";
        strength_gain_modifier: number;
        speed_gain_modifier: number;
        defense_gain_modifier: number;
        dexterity_gain_modifier: number;
        timestamp: number;
      }
    | {
        id: "bars";
        energy_maximum: number;
        happy_maximum: number;
        timestamp: number;
      }
    | {
        id: "gym_unlocks";
        strength_gym: number;
        defense_gym: number;
        speed_gym: number;
        dexterity_gym: number;
        timestamp: number;
      }
    | {
        id: "battlestats";
        strength: number;
        defense: number;
        speed: number;
        dexterity: number;
        timestamp: number;
      }
    | {
        id: "gym_build_preference";
        build_type: "balanced" | "hanks" | "baldrs";
        high_stat: "strength" | "defense" | "speed" | "dexterity";
      }
    | {
        id: "booster_perks";
        energy_drink_modifier: number;
        timestamp: number;
      }
  );

// Automatically creates the `nosql_user_state` table if it does not exist
export const UserState = new Collection<UserStateDocument>(
  sentinelDbEngine,
  "user_state",
);
