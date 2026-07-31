import readline from "readline/promises";
import { stdin as input, stdout as output } from "process";
import { ensureEnvLoaded, Logger } from "../packages/utils/src/index.js";
import { db } from "../packages/database/src/index.js";
import {
  encryptApiKey,
  hashApiKey,
  isValidApiKey,
  tornApi,
} from "../packages/torn-api/src/index.js";

const logger = new Logger("ApiKeyCLI");

/**
 * Interactive CLI script for adding and managing Torn API keys (system/personal) in PostgreSQL.
 */
async function main() {
  ensureEnvLoaded();

  const masterKey = process.env.ENCRYPTION_KEY;
  const pepper = process.env.API_KEY_HASH_PEPPER ?? "";

  if (!masterKey || masterKey.length < 32) {
    logger.error(
      "ENCRYPTION_KEY environment variable must be set in root .env (minimum 32 characters).",
    );
    process.exit(1);
  }

  const rl = readline.createInterface({ input, output });

  console.log("\n==================================================");
  console.log(" 🔑  SENTINEL V2 - API KEY MANAGER CLI");
  console.log("==================================================\n");

  let keepGoing = true;

  while (keepGoing) {
    console.log("--------------------------------------------------");
    const rawApiKey = (
      await rl.question("Enter 16-character Torn API Key: ")
    ).trim();

    if (!rawApiKey) {
      console.log("❌ API Key cannot be empty.\n");
      continue;
    }

    if (!isValidApiKey(rawApiKey)) {
      console.log(
        "⚠️ Warning: Provided string does not match standard 16-character API key format.",
      );
      const proceed = (
        await rl.question("Proceed anyway? (y/N): ")
      ).toLowerCase();
      if (proceed !== "y") continue;
    }

    console.log("\n🔍 Verifying API key with Torn API...");

    let userId = 0;
    let userName = "Unknown";
    let isValid = true;

    try {
      const profileRes = await tornApi.get("/user/profile", {
        apiKey: rawApiKey,
      });

      if (profileRes.profile) {
        userId = profileRes.profile.id;
        userName = profileRes.profile.name;
        console.log(`✅ Key verified! User: ${userName} (ID: ${userId})`);
      } else {
        console.log("⚠️ Could not retrieve player ID automatically.");
      }
    } catch (err: any) {
      console.log(`⚠️ API Key verification failed: ${err.message || err}`);
      const manualIdStr = await rl.question(
        "Enter User ID manually (or press Enter for 0): ",
      );
      userId = parseInt(manualIdStr, 10) || 0;
      isValid = false;
    }

    if (userId === 0) {
      const inputId = await rl.question("Enter User ID (numeric): ");
      userId = parseInt(inputId, 10) || 0;
    }

    console.log("\nSelect Key Type:");
    console.log("  [1] personal (Tailored for repository owner/specific user)");
    console.log("  [2] system   (Shared pool for public background workers)");
    const typeChoice = (await rl.question("Choice (default: 1): ")).trim();

    const keyType =
      typeChoice === "2" || typeChoice.toLowerCase() === "system"
        ? "system"
        : "personal";

    console.log(`\nEncrypting key as type '${keyType}'...`);

    const encryptedKey = encryptApiKey(rawApiKey, masterKey);
    const keyHash = hashApiKey(rawApiKey, pepper);

    await db.apiKey.upsert({
      where: { apiKeyHash: keyHash },
      update: {
        userId,
        apiKeyEncrypted: encryptedKey,
        keyType,
        isValid,
        invalidCount: isValid ? 0 : 1,
        updatedAt: new Date(),
      },
      create: {
        userId,
        apiKeyEncrypted: encryptedKey,
        apiKeyHash: keyHash,
        keyType,
        isValid,
        invalidCount: isValid ? 0 : 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });

    console.log(`\n🎉 Successfully saved API Key to PostgreSQL database!`);
    console.log(`   User: ${userName} (ID: ${userId})`);
    console.log(`   Type: ${keyType}`);
    console.log(`   Status: ${isValid ? "Active / Valid" : "Unverified"}\n`);

    const answer = (
      await rl.question("Would you like to add another API key? (y/N): ")
    ).toLowerCase();
    keepGoing = answer === "y";
  }

  rl.close();
  await db.$disconnect();
  console.log("\nExited API Key Manager CLI. Goodbye!\n");
}

main().catch(async (err) => {
  logger.error("Fatal error in API Key Manager CLI:", err);
  await db.$disconnect();
  process.exit(1);
});
