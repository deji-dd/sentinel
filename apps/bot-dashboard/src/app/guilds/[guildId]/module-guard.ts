import { getGuildConfigFromApi } from "@/actions/guilds";
import { isModuleEnabled } from "@sentinel/utils";

export async function checkModuleEnabled(
  guildId: string,
  moduleKey: string,
): Promise<boolean> {
  try {
    const apiRes = await getGuildConfigFromApi(guildId);
    const enabledModules: string[] = apiRes?.config?.enabledModules || [];
    return isModuleEnabled(enabledModules, moduleKey);
  } catch {
    return false;
  }
}
