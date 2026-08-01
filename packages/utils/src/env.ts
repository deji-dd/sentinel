import dotenv from "dotenv";

/**
 * Loads environment variables from local .env file.
 */
export function ensureEnvLoaded(): void {
  try {
    dotenv.config();
  } catch {
    // Environment variables provided natively in production
  }
}

// Auto-execute environment resolution when @sentinel/utils is imported
ensureEnvLoaded();
