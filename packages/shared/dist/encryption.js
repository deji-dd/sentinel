import crypto from "crypto";
const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 16;
const TAG_LENGTH = 16;
// Derive a consistent key from the base key
function deriveKey(baseKey) {
    return crypto.createHash("sha256").update(baseKey).digest();
}
/**
 * Encrypt a plaintext string using AES-256-GCM.
 * @param plaintext - The text to encrypt
 * @param encryptionKey - The encryption key (required)
 * @returns Hex-encoded encrypted string: iv(32 hex) + tag(32 hex) + ciphertext
 */
export function encrypt(plaintext, encryptionKey) {
    if (!encryptionKey) {
        throw new Error("ENCRYPTION_KEY is required for encryption");
    }
    const key = deriveKey(encryptionKey);
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
    let encrypted = cipher.update(plaintext, "utf8", "hex");
    encrypted += cipher.final("hex");
    const tag = cipher.getAuthTag();
    // Return: iv(32 hex) + tag(32 hex) + ciphertext
    return iv.toString("hex") + tag.toString("hex") + encrypted;
}
/**
 * Decrypt an encrypted string using AES-256-GCM.
 * @param encryptedData - Hex-encoded encrypted string
 * @param encryptionKey - The encryption key (required)
 * @returns Decrypted plaintext
 */
export function decrypt(encryptedData, encryptionKey) {
    if (!encryptionKey) {
        throw new Error("ENCRYPTION_KEY is required for decryption");
    }
    const key = deriveKey(encryptionKey);
    // Extract components (each is hex encoded)
    const ivHex = encryptedData.slice(0, IV_LENGTH * 2);
    const tagHex = encryptedData.slice(IV_LENGTH * 2, IV_LENGTH * 2 + TAG_LENGTH * 2);
    const encrypted = encryptedData.slice(IV_LENGTH * 2 + TAG_LENGTH * 2);
    const iv = Buffer.from(ivHex, "hex");
    const tag = Buffer.from(tagHex, "hex");
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);
    let decrypted = decipher.update(encrypted, "hex", "utf8");
    decrypted += decipher.final("utf8");
    return decrypted;
}
//# sourceMappingURL=encryption.js.map