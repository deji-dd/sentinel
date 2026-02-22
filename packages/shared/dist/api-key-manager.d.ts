/**
 * API Key Management
 * Handles encryption/decryption of Torn API keys for secure storage
 * Uses the same AES-256-GCM encryption as the main encryption module
 */
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
//# sourceMappingURL=api-key-manager.d.ts.map