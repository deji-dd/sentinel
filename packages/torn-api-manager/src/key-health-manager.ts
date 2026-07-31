import { db } from "@sentinel/database";
import { hashApiKey } from "@sentinel/torn-api";
import { Logger } from "@sentinel/utils";

const logger = new Logger("KeyHealthManager");
const INVALID_KEY_THRESHOLD = 3;

/**
 * Key Health Manager handling key invalidation counters and updating key status in PostgreSQL.
 */
export class KeyHealthManager {
  private pepper: string;

  constructor(pepper: string = process.env.API_KEY_HASH_PEPPER ?? "") {
    this.pepper = pepper;
  }

  /**
   * Handles invalid key error responses (Torn Error Code 2).
   * Increments invalid attempt counter and soft disables key if threshold is reached.
   */
  async handleInvalidKey(apiKey: string, errorCode: number): Promise<void> {
    if (errorCode !== 2) return;

    const keyHash = hashApiKey(apiKey, this.pepper);
    const existingKey = await db.apiKey.findUnique({
      where: { apiKeyHash: keyHash },
    });

    if (!existingKey) return;

    const newInvalidCount = existingKey.invalidCount + 1;
    const shouldDisable = newInvalidCount >= INVALID_KEY_THRESHOLD;

    await db.apiKey.update({
      where: { id: existingKey.id },
      data: {
        invalidCount: newInvalidCount,
        lastInvalidAt: new Date(),
        isValid: shouldDisable ? false : existingKey.isValid,
      },
    });

    if (shouldDisable) {
      logger.warn(
        `API Key for User ${existingKey.userId} disabled after ${newInvalidCount} consecutive Error Code 2 failures.`,
      );
    }
  }

  /**
   * Resets invalid count for a key when a request succeeds.
   */
  async recordSuccessfulUse(apiKey: string): Promise<void> {
    const keyHash = hashApiKey(apiKey, this.pepper);
    const existingKey = await db.apiKey.findUnique({
      where: { apiKeyHash: keyHash },
    });

    if (existingKey && existingKey.invalidCount > 0) {
      await db.apiKey.update({
        where: { id: existingKey.id },
        data: {
          invalidCount: 0,
          lastUsedAt: new Date(),
        },
      });
    }
  }
}
