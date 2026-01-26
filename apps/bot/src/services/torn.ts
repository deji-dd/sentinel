import { TORN_ERROR_CODES } from "../lib/constants.js";

interface TornKeyInfoResponse {
  info?: {
    user?: {
      id: string;
    };
    access?: {
      level: number;
    };
  };
  error?: {
    code: number;
    error: string;
  };
}

interface TornUserBasicResponse {
  name?: string;
  player_id?: number;
  donator?: number;
  error?: {
    code: number;
    error: string;
  };
}

export interface ValidatedKeyInfo {
  playerId: number;
  playerName: string;
  isDonator: boolean;
  accessLevel: number;
}

/**
 * Validates a Torn API key and returns key info.
 * @throws Error if validation fails
 */
export async function validateTornApiKey(
  apiKey: string,
): Promise<ValidatedKeyInfo> {
  // Validate API key format
  if (!/^[a-zA-Z0-9]{16}$/.test(apiKey)) {
    throw new Error("API Key must be exactly 16 alphanumeric characters");
  }

  // Fetch key info from Torn API
  const keyInfoResponse = await fetch(
    `https://api.torn.com/v2/key/info?key=${apiKey}`,
    {
      headers: { Accept: "application/json" },
    },
  );

  if (!keyInfoResponse.ok) {
    throw new Error("Failed to fetch from Torn API");
  }

  const keyData: TornKeyInfoResponse = await keyInfoResponse.json();

  // Handle Torn API errors
  if (keyData.error) {
    const errorMessage =
      TORN_ERROR_CODES[keyData.error.code] ||
      `Error code ${keyData.error.code}`;
    throw new Error(errorMessage);
  }

  // Validate response structure
  if (!keyData.info?.user?.id || keyData.info.access === undefined) {
    throw new Error("Invalid response from Torn API");
  }

  // Check access level (must be 3 or 4)
  if (keyData.info.access.level < 3) {
    throw new Error(
      `Insufficient permissions: Access level ${keyData.info.access.level}. Required: Limited Access (3) or Full Access (4)`,
    );
  }

  const playerId = parseInt(keyData.info.user.id, 10);

  // Fetch user basic info to get name and donator status
  const userResponse = await fetch(
    `https://api.torn.com/v2/user?selections=profile&key=${apiKey}`,
    {
      headers: { Accept: "application/json" },
    },
  );

  if (!userResponse.ok) {
    throw new Error("Failed to fetch user profile from Torn API");
  }

  const userData: TornUserBasicResponse = await userResponse.json();

  if (userData.error) {
    const errorMessage =
      TORN_ERROR_CODES[userData.error.code] ||
      `Error code ${userData.error.code}`;
    throw new Error(errorMessage);
  }

  if (!userData.name || !userData.player_id) {
    throw new Error("Invalid user profile response from Torn API");
  }

  return {
    playerId: userData.player_id,
    playerName: userData.name,
    isDonator: userData.donator === 1,
    accessLevel: keyData.info.access.level,
  };
}
