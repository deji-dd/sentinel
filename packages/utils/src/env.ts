import dotenv from "dotenv";

/**
 * Loads environment variables from local .env file.
 */
export function ensureEnvLoaded(): void {
  dotenv.config();
}

// Auto-execute environment resolution when @sentinel/utils is imported
ensureEnvLoaded();
