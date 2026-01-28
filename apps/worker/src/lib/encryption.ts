/**
 * Worker encryption wrapper - uses shared encryption with env var
 */
import {
  encrypt as sharedEncrypt,
  decrypt as sharedDecrypt,
} from "@sentinel/shared";

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY!;

if (!ENCRYPTION_KEY) {
  throw new Error("ENCRYPTION_KEY environment variable is not set");
}

export function encrypt(plaintext: string): string {
  return sharedEncrypt(plaintext, ENCRYPTION_KEY);
}

export function decrypt(encryptedData: string): string {
  return sharedDecrypt(encryptedData, ENCRYPTION_KEY);
}
