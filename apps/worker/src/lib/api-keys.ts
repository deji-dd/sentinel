/**
 * DEPRECATED: This module is maintained for backward compatibility only.
 *
 * All workers should migrate to system-api-keys.ts which provides:
 * - getSystemApiKey(type): Get personal or system keys
 * - getSystemApiKeys(userId): Get all system keys for user
 * - storeSystemApiKey(): Store encrypted keys
 * - deleteSystemApiKey(): Remove keys
 *
 * Backward compatibility layer: getPersonalApiKey() still works
 * This function reads from env var TORN_API_KEY as before,
 * allowing gradual migration of workers.
 */

// Re-export all system API key functions
export {
  getSystemApiKey,
  getSystemApiKeys,
  getPrimarySystemApiKey,
  storeSystemApiKey,
  deleteSystemApiKey,
  markSystemApiKeyInvalid,
  getPersonalApiKey, // Synchronous version for backward compatibility
} from "./system-api-keys.js";
