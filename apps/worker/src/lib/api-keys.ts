/**
 * DEPRECATED: This module is maintained for backward compatibility only.
 *
 * All workers should migrate to system-api-keys.ts which provides:
 * - getSystemApiKey(type): Get personal or system keys
 * - getSystemApiKeys(userId): Get all system keys for user
 * - getAllSystemApiKeys(): Get pooled system keys
 * - storeSystemApiKey(): Store encrypted keys
 * - deleteSystemApiKey(): Remove keys
 *
 * Backward compatibility layer for legacy imports only.
 */

// Re-export all system API key functions
export {
  getSystemApiKey,
  getSystemApiKeys,
  getAllSystemApiKeys,
  getPrimarySystemApiKey,
  storeSystemApiKey,
  deleteSystemApiKey,
  markSystemApiKeyInvalid,
} from "./system-api-keys.js";
