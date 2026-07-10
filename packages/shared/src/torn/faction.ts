import { tornApi } from "./client.js";
import { TornFactions } from "../index.js";
import { Logger } from "../utils/logger.js";

const logger = new Logger("FactionUtils");

/**
 * Validates and fetches faction details from Torn API (with NoSQL caching)
 * Returns faction details (name, tag) if it exists, null if not
 */
export async function validateAndFetchFactionDetails(
  factionId: number,
  apiKey: string,
) {
  if (!apiKey) return null;

  try {
    // 1. Fast RAM check in NoSQL
    const factionIdStr = String(factionId);
    let factionData = TornFactions.findOne(factionIdStr);

    // 2. If missing, fetch from Torn API and cache it
    if (!factionData) {
      const response = await tornApi.get("/faction/{id}/basic", {
        apiKey,
        pathParams: { id: factionIdStr },
      });
      const basic = response.basic;

      if (basic.id && basic.name) {
        factionData = TornFactions.insertOne({
          id: factionIdStr,
          data: basic,
          updated_at: Date.now(),
        });
      }
    }

    return factionData;
  } catch (error) {
    logger.error(`Faction ${factionId} validation failed:`, error);
    return null;
  }
}
