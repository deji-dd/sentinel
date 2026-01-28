import { TORN_ERROR_CODES } from "@sentinel/shared";

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

interface TornUserProfileResponse {
  profile?: {
    id: number;
    name: string;
    donator_status: string;
  };
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

  // Fetch user profile to get name and donator status
  const userResponse = await fetch(
    `https://api.torn.com/v2/user/profile?key=${apiKey}`,
    {
      headers: { Accept: "application/json" },
    },
  );

  if (!userResponse.ok) {
    throw new Error("Failed to fetch user profile from Torn API");
  }

  const userData: TornUserProfileResponse = await userResponse.json();

  if (userData.error) {
    const errorMessage =
      TORN_ERROR_CODES[userData.error.code] ||
      `Error code ${userData.error.code}`;
    throw new Error(errorMessage);
  }

  if (!userData.profile?.name || !userData.profile?.id) {
    throw new Error("Invalid user profile response from Torn API");
  }

  return {
    playerId: userData.profile.id,
    playerName: userData.profile.name,
    isDonator: userData.profile.donator_status === "Donator",
    accessLevel: keyData.info.access.level,
  };
}
