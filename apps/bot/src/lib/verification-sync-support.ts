import { TABLE_NAMES, type TornApiComponents } from "@sentinel/shared";
import { db } from "./db-client.js";

export type UserGenericResponse =
  TornApiComponents["schemas"]["UserDiscordResponse"] &
    TornApiComponents["schemas"]["UserFactionResponse"] &
    TornApiComponents["schemas"]["UserProfileResponse"];

export type factionGenericResponse =
  TornApiComponents["schemas"]["FactionBasicResponse"] &
    TornApiComponents["schemas"]["FactionMembersResponse"];

export interface FactionRoleMapping {
  guild_id: string;
  faction_id: number;
  member_role_ids: string[];
  leader_role_ids: string[];
  enabled: boolean;
}

export interface GuildSyncJob {
  guild_id: string;
  last_sync_at: string | null;
  next_sync_at: string;
  in_progress: boolean | number;
}

export interface VerifiedUserRecord {
  discord_id: string;
  torn_id: number;
  torn_name: string;
  faction_id: number | null;
  faction_tag: string | null;
  updated_at: string;
}

export function parseTextArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string");
  }

  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) {
        return parsed.filter(
          (item): item is string => typeof item === "string",
        );
      }
    } catch {
      return [];
    }
  }

  return [];
}

export function isTruthyBoolean(value: unknown): boolean {
  return value === true || value === 1 || value === "1";
}

export function applyNicknameTemplate(
  template: string,
  name: string,
  id: number,
  factionTag?: string,
): string {
  return template
    .replace("{name}", name)
    .replace("{id}", id.toString())
    .replace("{tag}", factionTag || "");
}

export function isVerificationRecordStale(
  updatedAt: string,
  verificationRefreshMs: number,
): boolean {
  const updatedTimestamp = new Date(updatedAt).getTime();
  if (Number.isNaN(updatedTimestamp)) {
    return true;
  }

  return Date.now() - updatedTimestamp >= verificationRefreshMs;
}

export async function loadVerifiedUsersByDiscordIds(
  discordIds: string[],
  queryChunkSize: number,
): Promise<Map<string, VerifiedUserRecord>> {
  const users = new Map<string, VerifiedUserRecord>();

  if (discordIds.length === 0) {
    return users;
  }

  for (let i = 0; i < discordIds.length; i += queryChunkSize) {
    const chunk = discordIds.slice(i, i + queryChunkSize);
    if (chunk.length === 0) {
      continue;
    }

    const rows = (await db
      .selectFrom(TABLE_NAMES.VERIFIED_USERS)
      .select([
        "discord_id",
        "torn_id",
        "torn_name",
        "faction_id",
        "faction_tag",
        "updated_at",
      ])
      .where("discord_id", "in", chunk)
      .execute()) as VerifiedUserRecord[];

    for (const row of rows) {
      users.set(row.discord_id, row);
    }
  }

  return users;
}
