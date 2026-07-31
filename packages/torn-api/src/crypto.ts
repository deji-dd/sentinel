import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  createHash,
} from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 16; // 128 bits
const AUTH_TAG_LENGTH = 16; // 128 bits

/**
 * Derives a consistent 256-bit encryption key from a master key string.
 */
function deriveKeyFromMaster(masterKey: string): Buffer {
  return createHash("sha256").update(masterKey).digest();
}

/**
 * Encrypts a plaintext Torn API key using AES-256-GCM.
 * Format: iv(32 hex) + tag(32 hex) + ciphertext
 */
export function encryptApiKey(apiKey: string, masterKey: string): string {
  const derivedKey = deriveKeyFromMaster(masterKey);
  const iv = randomBytes(IV_LENGTH);

  const cipher = createCipheriv(ALGORITHM, derivedKey, iv);
  let encrypted = cipher.update(apiKey, "utf8", "hex");
  encrypted += cipher.final("hex");

  const authTag = cipher.getAuthTag();

  return iv.toString("hex") + authTag.toString("hex") + encrypted;
}

/**
 * Decrypts an AES-256-GCM encrypted Torn API key back to plaintext.
 * Safely handles plaintext keys or master key mismatches.
 */
export function decryptApiKey(encrypted: string, masterKey: string): string {
  if (!encrypted || isValidApiKey(encrypted)) {
    return encrypted;
  }
  if (!masterKey || encrypted.length < 64) {
    return encrypted;
  }

  try {
    const derivedKey = deriveKeyFromMaster(masterKey);

    const ivHex = encrypted.slice(0, IV_LENGTH * 2);
    const tagHex = encrypted.slice(
      IV_LENGTH * 2,
      IV_LENGTH * 2 + AUTH_TAG_LENGTH * 2,
    );
    const ciphertextHex = encrypted.slice(IV_LENGTH * 2 + AUTH_TAG_LENGTH * 2);

    const iv = Buffer.from(ivHex, "hex");
    const authTag = Buffer.from(tagHex, "hex");
    const ciphertext = Buffer.from(ciphertextHex, "hex");

    const decipher = createDecipheriv(ALGORITHM, derivedKey, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(ciphertext, undefined, "utf8");
    decrypted += decipher.final("utf8");

    return decrypted;
  } catch (err) {
    // If decryption fails (e.g. key was already plaintext or master key mismatch), return raw string
    return encrypted;
  }
}

/**
 * Generates a SHA-256 hash of an API key for safe indexing and rate-limit tracking.
 */
export function hashApiKey(apiKey: string, pepper: string): string {
  return createHash("sha256")
    .update(apiKey + pepper)
    .digest("hex");
}

/**
 * Validates whether a provided string matches the standard 16-character Torn API key format.
 */
export function isValidApiKey(key: string): boolean {
  return Boolean(key && /^[a-zA-Z0-9]{16}$/.test(key));
}

/**
 * Validates whether the master encryption key is strong enough (at least 32 characters).
 */
export function isValidMasterKey(key: string): boolean {
  return Boolean(key && key.length >= 32);
}
