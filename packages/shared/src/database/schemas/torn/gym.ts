import { BaseDocument, Collection } from "../../collection.js";
import { sentinelDbEngine } from "../../engine.js";

export type TornGymDocument = BaseDocument & {
  name: string;
  stage: number;
  cost: number;
  energy: number;
  strength: number;
  speed: number;
  defense: number;
  dexterity: number;
  note: string;
};

export const TornGyms = new Collection<TornGymDocument>(
  sentinelDbEngine,
  "torn_gyms",
);
