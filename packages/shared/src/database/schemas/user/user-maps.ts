import { BaseDocument, Collection } from "../../collection.js";
import { sentinelDbEngine } from "../../engine.js";

export type UserMapDocument = BaseDocument & {
  user_id: string; // The discord user ID
  name: string;
  labels: {
    id: string;
    text: string;
    color: string;
    enabled: boolean;
    territories: string[];
    respect: number;
    sectors: number;
    rackets: number;
  }[];
  assignments: Record<string, string>;
  created_at: number;
  updated_at: number;
};

export const UserMaps = new Collection<UserMapDocument>(
  sentinelDbEngine,
  "user_maps",
  [
    { key: "user_id", type: "TEXT" }
  ]
);
