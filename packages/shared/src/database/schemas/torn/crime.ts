import { TornSchema } from "../../../torn/torn.js";
import { BaseDocument, Collection } from "../../collection.js";
import { sentinelDbEngine } from "../../engine.js";

type SingleTornCrime = TornSchema<"TornCrime">;

export type TornCrimeDocument = BaseDocument & {
  data: SingleTornCrime;
};

export const TornCrimes = new Collection<TornCrimeDocument>(
  sentinelDbEngine,
  "torn_crimes",
);
