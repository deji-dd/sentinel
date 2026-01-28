/**
 * Encrypt a plaintext string using AES-256-GCM.
 * @param plaintext - The text to encrypt
 * @param encryptionKey - The encryption key (required)
 * @returns Hex-encoded encrypted string: iv(32 hex) + tag(32 hex) + ciphertext
 */
export declare function encrypt(plaintext: string, encryptionKey: string): string;
/**
 * Decrypt an encrypted string using AES-256-GCM.
 * @param encryptedData - Hex-encoded encrypted string
 * @param encryptionKey - The encryption key (required)
 * @returns Decrypted plaintext
 */
export declare function decrypt(encryptedData: string, encryptionKey: string): string;
//# sourceMappingURL=encryption.d.ts.map