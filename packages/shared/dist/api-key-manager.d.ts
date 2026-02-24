/**
 * API Key Management
 * Handles encryption/decryption of Torn API keys for secure storage
 * Uses the same AES-256-GCM encryption as the main encryption module
 */
import type { SupabaseClient } from "@supabase/supabase-js";
/**
 * Encrypt an API key
 * Returns format: iv(32 hex) + tag(32 hex) + ciphertext(hex)
 */
export declare function encryptApiKey(apiKey: string, masterKey: string): string;
/**
 * Decrypt an API key
 * Expected format: iv(32 hex) + tag(32 hex) + ciphertext(hex)
 */
export declare function decryptApiKey(encrypted: string, masterKey: string): string;
/**
 * Hash API key for database tracking (non-reversible)
 * Used for rate limiting mapping
 */
export declare function hashApiKey(apiKey: string, pepper: string): string;
/**
 * Validate API key format
 */
export declare function isValidApiKey(key: string): boolean;
/**
 * Validate encryption key is properly formatted
 */
export declare function isValidMasterKey(key: string): boolean;
/**
 * Ensure API key is mapped to user in database
 * Fetches user ID from /user/basic endpoint and creates mapping if missing
 * Call this once during worker initialization to ensure rate limiting works
 */
export declare function ensureApiKeyMapped(apiKey: string, supabase: SupabaseClient, config: {
    tableName: string;
    hashPepper: string;
}): Promise<{
    userId: number | null;
    error: string | null;
}>;
//# sourceMappingURL=api-key-manager.d.ts.map