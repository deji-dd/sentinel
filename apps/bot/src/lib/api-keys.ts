import { decrypt } from "./encryption.js";

type ApiKeyEntry = {
  key?: string;
  isActive?: boolean;
};

const roundRobinIndex = new Map<string, number>();

function getEncryptedKeys(guildConfig: {
  api_keys?: ApiKeyEntry[] | null;
  api_key?: string | null;
}): string[] {
  const apiKeys = Array.isArray(guildConfig.api_keys)
    ? guildConfig.api_keys
    : [];
  const activeKeys = apiKeys
    .filter((entry) => entry?.isActive && entry.key)
    .map((entry) => entry.key as string);
  const allKeys = apiKeys
    .filter((entry) => entry?.key)
    .map((entry) => entry.key as string);

  if (activeKeys.length > 0) {
    return activeKeys;
  }

  if (allKeys.length > 0) {
    return allKeys;
  }

  if (guildConfig.api_key) {
    return [guildConfig.api_key];
  }

  return [];
}

export function resolveApiKeysForGuild(
  guildId: string,
  guildConfig: {
    api_keys?: ApiKeyEntry[] | null;
    api_key?: string | null;
  },
): { keys: string[]; error?: string } {
  const encryptedKeys = getEncryptedKeys(guildConfig);

  if (encryptedKeys.length === 0) {
    return { keys: [], error: "No API keys configured." };
  }

  const decryptedKeys: string[] = [];
  let failed = 0;

  for (const encryptedKey of encryptedKeys) {
    try {
      decryptedKeys.push(decrypt(encryptedKey));
    } catch (error) {
      failed += 1;
      console.warn(
        `[API Keys] Failed to decrypt key for guild ${guildId}:`,
        error,
      );
    }
  }

  if (decryptedKeys.length === 0) {
    return {
      keys: [],
      error:
        failed > 0
          ? "Failed to decrypt any API keys."
          : "No API keys configured.",
    };
  }

  return { keys: decryptedKeys };
}

export function getNextApiKey(guildId: string, keys: string[]): string {
  if (keys.length === 1) {
    return keys[0];
  }

  const currentIndex = roundRobinIndex.get(guildId) ?? 0;
  const nextIndex = currentIndex % keys.length;
  roundRobinIndex.set(guildId, nextIndex + 1);

  return keys[nextIndex];
}
