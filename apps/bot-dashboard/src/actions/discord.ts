"use server";

import { auth } from "@/auth";

import { revalidatePath } from "next/cache";

export interface DiscordGuild {
  id: string;
  name: string;
  icon: string | null;
  owner: boolean;
  permissions: string;
  features: string[];
}

export async function getMutualGuilds(): Promise<DiscordGuild[]> {
  const session = await auth();
  if (!session?.accessToken) {
    throw new Error("Not authenticated");
  }

  // Fetch user guilds
  const userGuildsRes = await fetch(
    "https://discord.com/api/users/@me/guilds",
    {
      headers: {
        Authorization: `Bearer ${session.accessToken}`,
      },
      cache: "no-store",
    },
  );

  if (!userGuildsRes.ok) {
    throw new Error("Failed to fetch user guilds");
  }
  const userGuilds: DiscordGuild[] = await userGuildsRes.json();

  // Fetch bot guilds
  const botGuildsRes = await fetch("https://discord.com/api/users/@me/guilds", {
    headers: {
      Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}`,
    },
    // Cache bot guilds for a minute to reduce API calls, but allow manual revalidation
    next: { revalidate: 60, tags: ["bot-guilds"] },
  });

  if (!botGuildsRes.ok) {
    throw new Error("Failed to fetch bot guilds");
  }
  const botGuilds: DiscordGuild[] = await botGuildsRes.json();

  const botGuildIds = new Set(botGuilds.map((g) => g.id));

  // Return mutual guilds (no native admin permission filtering)
  return userGuilds.filter((g) => botGuildIds.has(g.id));
}

export async function refreshGuilds() {
  revalidatePath("/");
}
