#!/usr/bin/env tsx
import { TornApiClient, encryptApiKey, hashApiKey } from "@sentinel/shared";
import { SystemApiKeys } from "@sentinel/shared";
import { randomUUID } from "crypto";

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY!;
const API_KEY_HASH_PEPPER = process.env.API_KEY_HASH_PEPPER!;

if (!ENCRYPTION_KEY || !API_KEY_HASH_PEPPER) {
  throw new Error("CRITICAL: Missing encryption environment variables.");
}

const bootstrapTornApi = new TornApiClient();

interface CliOptions {
  apiKey: string;
  keyType: "personal" | "system";
  isPrimary: boolean;
}

/**
 * Parses command line arguments to extract API key configuration.
 * @param argv Standard process.argv slice.
 * @returns Parsed CLI options.
 */
function parseArgs(argv: string[]): CliOptions {
  let apiKey = "";
  let keyType: "personal" | "system" = "system";
  let isPrimary = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === "--primary") {
      isPrimary = true;
      continue;
    }
    if (arg === "--api-key" && argv[i + 1]) {
      apiKey = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg.startsWith("--api-key=")) {
      apiKey = arg.split("=")[1] || "";
      continue;
    }
    if (arg === "--type" && argv[i + 1]) {
      keyType = argv[i + 1] as "personal" | "system";
      i += 1;
      continue;
    }
    if (arg.startsWith("--type=")) {
      keyType = arg.split("=")[1] as "personal" | "system";
      continue;
    }
  }

  return { apiKey, keyType, isPrimary };
}

/**
 * Executes the CLI workflow to encrypt and store a new API key into the NoSQL engine.
 * Bypasses the standard rate limiter to fetch the mapping user ID first.
 */
async function run(): Promise<void> {
  const { apiKey, keyType, isPrimary } = parseArgs(process.argv.slice(2));

  if (!apiKey || !/^[a-zA-Z0-9]{16}$/.test(apiKey)) {
    throw new Error(
      "Invalid or missing API key. Expected a 16-character alphanumeric string.",
    );
  }

  try {
    const data = await bootstrapTornApi.get("/user/basic", { apiKey });
    const userId = data.profile?.id;

    if (!userId) {
      throw new Error("Invalid API response: missing player id");
    }

    const encryptedKey = encryptApiKey(apiKey, ENCRYPTION_KEY);
    const keyHash = hashApiKey(apiKey, API_KEY_HASH_PEPPER);

    // If primary, demote existing primary keys for this user
    if (isPrimary) {
      const existingPrimaries = SystemApiKeys.findAll(
        (doc) => doc.user_id === userId && doc.is_primary,
      );
      for (const existing of existingPrimaries) {
        existing.is_primary = false;
        SystemApiKeys.insertOne(existing);
      }
    }

    SystemApiKeys.insertOne({
      id: randomUUID(),
      user_id: userId,
      api_key_encrypted: encryptedKey,
      api_key_hash: keyHash,
      is_primary: isPrimary,
      key_type: keyType,
      invalid_count: 0,
      last_invalid_at: null,
    });

    console.log(
      `✅ Saved ${keyType} key for player ${userId} ${isPrimary ? "(primary)" : ""}`,
    );
  } catch (error) {
    throw new Error(
      `Failed to add system API key: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

run().catch((error) => {
  console.error(
    `[AddSystemKey] ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exit(1);
});
