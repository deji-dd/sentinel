import { TornApiClient, type TornApiComponents } from "@sentinel/shared";

/**
 * Torn API client for the bot
 */
export const botTornApi = new TornApiClient();

type UserProfileResponse = TornApiComponents["schemas"]["UserProfileResponse"] &
  TornApiComponents["schemas"]["UserFactionResponse"];

/**
 * Fetch Torn user profile data (name, faction)
 * @param tornId The Torn player ID
 * @param apiKey The API key to use
 * @returns Profile data or null if failed
 */
export async function fetchTornProfileData(
  tornId: number,
  apiKey: string,
): Promise<UserProfileResponse | null> {
  try {
    const response = await botTornApi.get<UserProfileResponse>(`/user`, {
      apiKey,
      queryParams: {
        selections: ["profile", "faction"],
        id: tornId,
      },
    });

    return response;
  } catch (error) {
    console.error(`[TornAPI] Failed to fetch profile for ${tornId}:`, error);
    return null;
  }
}
