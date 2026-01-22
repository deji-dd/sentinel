const TORN_API_BASE = "https://api.torn.com/v2";
const REQUEST_TIMEOUT = 10000; // 10 seconds

const TORN_ERROR_CODES: Record<number, string> = {
  0: "Unknown error: An unhandled error occurred",
  1: "Key is empty: API key is empty in current request",
  2: "Incorrect Key: API key is wrong/incorrect format",
  3: "Wrong type: Requesting an incorrect basic type",
  4: "Wrong fields: Requesting incorrect selection fields",
  5: "Too many requests: Rate limited (max 100 per minute)",
  6: "Incorrect ID: Wrong ID value",
  7: "Incorrect ID-entity relation: A requested selection is private",
  8: "IP block: Current IP is banned for a period of time due to abuse",
  9: "API disabled: API system is currently disabled",
  10: "Key owner in federal jail: Current key cannot be used",
  11: "Key change error: Can only change API key once every 60 seconds",
  12: "Key read error: Error reading key from database",
  13: "Key temporarily disabled: Owner hasn't been online for more than 7 days",
  14: "Daily read limit reached: Too many records pulled today",
  15: "Temporary error: Testing error code",
  16: "Access level insufficient: Key does not have permission for this selection",
  17: "Backend error: Please try again",
  18: "API key paused: Key has been paused by the owner",
  19: "Must be migrated to crimes 2.0",
  20: "Race not yet finished",
  21: "Incorrect category: Wrong cat value",
  22: "Only available in API v1",
  23: "Only available in API v2",
  24: "Closed temporarily",
};

export interface TornUserBasic {
  profile?: {
    id: number;
    name: string;
  };
  error?: {
    code: number;
    error: string;
  };
}

export interface TornUserTravel {
  travel?: {
    destination?: string | null;
    method?: string | null;
    departed_at?: number | null;
    arrival_at?: number | null;
    time_left?: number | null;
  };
  error?: {
    code: number;
    error: string;
  };
}

export async function fetchTornUserBasic(
  apiKey: string,
): Promise<TornUserBasic> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

  try {
    const response = await fetch(`${TORN_API_BASE}/user/basic?key=${apiKey}`, {
      signal: controller.signal,
      headers: {
        Accept: "application/json",
      },
    });

    const data = (await response.json()) as TornUserBasic;

    // Handle Torn API errors
    if (data.error) {
      const errorMessage =
        TORN_ERROR_CODES[data.error.code] || `Error code ${data.error.code}`;
      throw new Error(errorMessage);
    }

    // Validate response structure
    if (!data.profile?.id || !data.profile?.name) {
      throw new Error("Invalid response from Torn API: missing profile data");
    }

    // Check HTTP status after parsing (some errors return 200 with error object)
    if (!response.ok) {
      throw new Error(`Torn API returned status ${response.status}`);
    }

    return data;
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function fetchTornUserTravel(
  apiKey: string,
): Promise<TornUserTravel> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

  try {
    const response = await fetch(`${TORN_API_BASE}/user/travel?key=${apiKey}`, {
      signal: controller.signal,
      headers: {
        Accept: "application/json",
      },
    });

    const data = (await response.json()) as TornUserTravel;

    if (data.error) {
      const errorMessage =
        TORN_ERROR_CODES[data.error.code] || `Error code ${data.error.code}`;
      throw new Error(errorMessage);
    }

    if (!response.ok) {
      throw new Error(`Torn API returned status ${response.status}`);
    }

    return data;
  } finally {
    clearTimeout(timeoutId);
  }
}
