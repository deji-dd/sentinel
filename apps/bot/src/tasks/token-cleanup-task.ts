import { db } from "../lib/db-client.js";
import { TABLE_NAMES } from "@sentinel/shared";

const TASK_NAME = "token_cleanup";
let cleanupInFlight = false;

/**
 * Clean up expired map sessions (UI access tokens)
 */
export async function performTokenCleanup(): Promise<void> {
  if (cleanupInFlight) {
    return;
  }

  cleanupInFlight = true;
  try {
    const now = new Date().toISOString();

    const result = await db
      .deleteFrom(TABLE_NAMES.MAP_SESSIONS)
      .where("expires_at", "<=", now)
      .executeTakeFirst();

    const deletedCount = Number(result.numDeletedRows || 0);
    if (deletedCount > 0) {
      console.log(
        `[${TASK_NAME}] Cleaned up ${deletedCount} expired UI access tokens.`,
      );
    }

    // Also cleanup assist tokens if they have an expiry (though most are long-lived)
    const assistResult = await db
      .updateTable(TABLE_NAMES.ASSIST_TOKENS)
      .set({ is_active: 0 })
      .where("expires_at", "<=", now)
      .where("is_active", "=", 1)
      .executeTakeFirst();

    const deactivatedAssistCount = Number(assistResult.numUpdatedRows || 0);
    if (deactivatedAssistCount > 0) {
      console.log(
        `[${TASK_NAME}] Deactivated ${deactivatedAssistCount} expired assist tokens.`,
      );
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`[${TASK_NAME}] Cleanup failed: ${errorMessage}`);
  } finally {
    cleanupInFlight = false;
  }
}


