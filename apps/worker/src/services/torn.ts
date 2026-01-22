const TORN_API_BASE = "https://api.torn.com/v2";
const REQUEST_TIMEOUT = 10000; // 10 seconds

export interface TornUserBasic {
  profile: {
    id: number;
    name: string;
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

    if (!response.ok) {
      throw new Error(`Torn API returned status ${response.status}`);
    }

    const data = (await response.json()) as TornUserBasic;
    return data;
  } finally {
    clearTimeout(timeoutId);
  }
}
