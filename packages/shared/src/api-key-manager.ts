/**
 * API Key Management
 * Handles encryption/decryption of Torn API keys for secure storage
 * Uses the same AES-256-GCM encryption as the main encryption module
 */

import { createCipheriv, createDecipheriv, randomBytes, createHash } from "crypto";

const ALGORITHM = "aes-256-gcm";
const KEY_LENGTH = 32; // 256 bits
const IV_LENGTH = 16; // 128 bits
const AUTH_TAG_LENGTH = 16; // 128 bits

/**
 * Derive encryption key from master key
 */
function deriveKeyFromMaster(masterKey: string): Buffer {
  return createHash("sha256").update(masterKey).digest();
}

/**
 * Encrypt an API key
 * Returns format: iv(32 hex) + tag(32 hex) + ciphertext(hex)
 */
export function encryptApiKey(apiKey: string, masterKey: string): string {
  const derivedKey = deriveKeyFromMaster(masterKey);
  const iv = randomBytes(IV_LENGTH);

  const cipher = createCipheriv(ALGORITHM, derivedKey, iv);
  let encrypted = cipher.update(apiKey, "utf8", "hex");
  encrypted += cipher.final("hex");

  const authTag = cipher.getAuthTag();

  // Format: iv + tag + ciphertext (all in hex)
  return iv.toString("hex") + authTag.toString("hex") + encrypted;
}

/**
 * Decrypt an API key
 * Expected format: iv(32 hex) + tag(32 hex) + ciphertext(hex)
 */
export function decryptApiKey(encrypted: string, masterKey: string): string {
  const derivedKey = deriveKeyFromMaster(masterKey);

  // Extract components
  const ivHex = encrypted.slice(0, IV_LENGTH * 2);
  const tagHex = encrypted.slice(IV_LENGTH * 2, IV_LENGTH * 2 + AUTH_TAG_LENGTH * 2);
  const ciphertextHex = encrypted.slice(IV_LENGTH * 2 + AUTH_TAG_LENGTH * 2);

  const iv = Buffer.from(ivHex, "hex");
  const authTag = Buffer.from(tagHex, "hex");
  const ciphertext = Buffer.from(ciphertextHex, "hex");

  const decipher = createDecipheriv(ALGORITHM, derivedKey, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(ciphertext, undefined, "utf8");
  decrypted += decipher.final("utf8");

  return decrypted;
}

/**
 * Hash API key for database tracking (non-reversible)
 * Used for rate limiting mapping
 */
export function hashApiKey(apiKey: string, pepper: string): string {
  return createHash("sha256")
    .update(apiKey + pepper)
    .digest("hex");
}

/**
 * Validate API key format
 */
export function isValidApiKey(key: string): boolean {
  return /^[a-zA-Z0-9]{16}$/.test(key);
}

/**
 * Validate encryption key is properly formatted
 */
export function isValidMasterKey(key: string): boolean {
  return key && key.length >= 32; // Should be a strong key
}
