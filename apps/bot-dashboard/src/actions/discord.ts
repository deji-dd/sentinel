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

  const botToken = process.env.DISCORD_BOT_TOKEN;

  if (!botToken) {
    throw new Error("Missing bot token configuration");
  }

  // 1. Fetch user's guilds
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
    throw new Error(
      `Failed to fetch user guilds (HTTP ${userGuildsRes.status})`,
    );
  }
  const userGuilds: DiscordGuild[] = await userGuildsRes.json();

  // 2. Fetch bot's guilds
  const botGuildsRes = await fetch("https://discord.com/api/users/@me/guilds", {
    headers: {
      Authorization: `Bot ${botToken}`,
    },
    next: { revalidate: 60, tags: ["bot-guilds"] },
  });

  if (!botGuildsRes.ok) {
    throw new Error(`Failed to fetch bot guilds (HTTP ${botGuildsRes.status})`);
  }
  const botGuilds: DiscordGuild[] = await botGuildsRes.json();
  const botGuildIds = new Set(botGuilds.map((g) => g.id));

  // 3. Filter mutual guilds where user and bot are both present
  return userGuilds.filter((g) => botGuildIds.has(g.id));
}

export async function refreshGuilds(): Promise<void> {
  revalidatePath("/");
}
