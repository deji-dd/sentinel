/**
 * Bot-specific Torn API service
 * Provides a simple wrapper for making Torn API calls without rate limiting
 * (Rate limiting is typically handled at the worker level)
 */

import { TornApiClient } from "@sentinel/shared";

/**
 * Basic Torn API client for the bot (no rate limiting)
 * For rate-limited operations, prefer using the worker service
 */
export const botTornApi = new TornApiClient();

export { TornApiClient };
