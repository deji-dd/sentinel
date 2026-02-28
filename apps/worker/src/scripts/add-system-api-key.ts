import { storeSystemApiKey } from "../lib/system-api-keys.js";
import { tornApi } from "../services/torn-client.js";

interface CliOptions {
  apiKey: string;
  keyType: "personal" | "system";
  isPrimary: boolean;
}

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
      const value = argv[i + 1] as "personal" | "system";
      keyType = value;
      i += 1;
      continue;
    }

    if (arg.startsWith("--type=")) {
      const value = arg.split("=")[1] as "personal" | "system";
      keyType = value;
      continue;
    }
  }

  return { apiKey, keyType, isPrimary };
}

function validateApiKey(apiKey: string): void {
  if (!/^[a-zA-Z0-9]{16}$/.test(apiKey)) {
    throw new Error(
      "Invalid API key format. Expected a 16-character alphanumeric key.",
    );
  }
}

async function run(): Promise<void> {
  const { apiKey, keyType, isPrimary } = parseArgs(process.argv.slice(2));

  if (!apiKey) {
    throw new Error("Missing --api-key argument.");
  }

  if (keyType !== "personal" && keyType !== "system") {
    throw new Error("Invalid --type. Use 'personal' or 'system'.");
  }

  validateApiKey(apiKey);

  try {
    const data = await tornApi.get("/user/basic", { apiKey });
    const userId = data.profile?.id;

    if (!userId) {
      throw new Error("Invalid API response: missing player id");
    }

    await storeSystemApiKey(apiKey, userId, keyType, isPrimary);

    console.log(
      `Saved ${keyType} key for player ${userId} ${isPrimary ? "(primary)" : ""}`,
    );
  } catch (error) {
    // TornApiClient throws errors (including Torn API errors like invalid key)
    throw new Error(
      `Failed to add system API key: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

run().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[AddSystemKey] ${message}`);
  process.exit(1);
});
