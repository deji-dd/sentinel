import crypto from "crypto";

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY!;
const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 16;
const TAG_LENGTH = 16;

if (!ENCRYPTION_KEY) {
  throw new Error("ENCRYPTION_KEY environment variable is not set");
}

// Derive a consistent key from the base key
function deriveKey(baseKey: string): Buffer {
  return crypto.createHash("sha256").update(baseKey).digest();
}

export function decrypt(encryptedData: string): string {
  const key = deriveKey(ENCRYPTION_KEY);

  // Extract components (each is hex encoded)
  const ivHex = encryptedData.slice(0, IV_LENGTH * 2);
  const tagHex = encryptedData.slice(
    IV_LENGTH * 2,
    IV_LENGTH * 2 + TAG_LENGTH * 2,
  );
  const encrypted = encryptedData.slice(IV_LENGTH * 2 + TAG_LENGTH * 2);

  const iv = Buffer.from(ivHex, "hex");
  const tag = Buffer.from(tagHex, "hex");

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);

  let decrypted = decipher.update(encrypted, "hex", "utf8");
  decrypted += decipher.final("utf8");

  return decrypted;
}
