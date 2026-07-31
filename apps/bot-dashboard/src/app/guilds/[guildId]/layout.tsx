import React from "react";
import { redirect } from "next/navigation";
import { auth, signOut } from "@/auth";
import { getMutualGuilds } from "@/actions/discord";
import { getGuildConfigFromApi } from "@/actions/guilds";
import { NotInitializedView } from "./not-initialized";
import { UnauthorizedView } from "./unauthorized";
import { GuildLayoutShell } from "./layout-shell";

export default async function GuildLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ guildId: string }>;
}) {
  const session = await auth();

  if (!session?.user) {
    redirect("/login");
  }

  const { guildId } = await params;
  const botToken = process.env.DISCORD_BOT_TOKEN;

  // 1. Fetch Discord details
  let guildData: { name: string; icon: string | null } | null = null;
  try {
    if (botToken) {
      const guildRes = await fetch(
        `https://discord.com/api/v10/guilds/${guildId}`,
        {
          headers: { Authorization: `Bot ${botToken}` },
          next: { revalidate: 60 },
        },
      );
      if (guildRes.ok) {
        const raw = await guildRes.json();
        guildData = { name: raw.name, icon: raw.icon };
      }
    }
  } catch (err) {
    console.error(`Failed to fetch Discord info for ${guildId}:`, err);
  }

  const guildName = guildData?.name || `Server (${guildId})`;

  // 2. Fetch GuildConfig from Fastify API
  let apiRes: any = null;
  try {
    apiRes = await getGuildConfigFromApi(guildId);
  } catch (err) {
    console.error(`Failed to fetch config from API for ${guildId}:`, err);
  }

  const guildConfig = apiRes?.config;

  if (!apiRes?.initialized || !guildConfig) {
    return <NotInitializedView guildId={guildId} guildName={guildName} />;
  }

  // 3. Authorization Check
  const botOwnerId = process.env.SENTINEL_DISCORD_USER_ID;
  const isBotOwner = session.user.id === botOwnerId;
  let isAuthorized = isBotOwner;

  if (!isAuthorized) {
    try {
      const mutualGuilds = await getMutualGuilds();
      const userGuild = mutualGuilds.find((g) => g.id === guildId);

      if (userGuild) {
        const permissions = BigInt(userGuild.permissions || "0");
        const isGuildAdmin =
          userGuild.owner ||
          (permissions & BigInt("8")) === BigInt("8") ||
          (permissions & BigInt("32")) === BigInt("32");

        const adminRoleIds = guildConfig.adminRoleIds || [];

        if (adminRoleIds.length === 0) {
          if (isGuildAdmin) isAuthorized = true;
        } else {
          if (botToken) {
            const memberRes = await fetch(
              `https://discord.com/api/v10/guilds/${guildId}/members/${session.user.id}`,
              {
                headers: { Authorization: `Bot ${botToken}` },
                next: { revalidate: 0 },
              },
            );

            if (memberRes.ok) {
              const member = await memberRes.json();
              const userRoleIds = (member.roles || []) as string[];
              const hasAdminRole = userRoleIds.some((roleId) =>
                adminRoleIds.includes(roleId),
              );

              if (hasAdminRole || isGuildAdmin) {
                isAuthorized = true;
              }
            }
          }
        }
      }
    } catch (err) {
      console.error("Authorization check failed:", err);
    }
  }

  if (!isAuthorized) {
    return <UnauthorizedView guildId={guildId} guildName={guildName} />;
  }

  const handleSignOut = async () => {
    "use server";
    await signOut({ redirectTo: "/login" });
  };

  return (
    <GuildLayoutShell
      guildId={guildId}
      guildName={guildName}
      guildIcon={guildData?.icon || null}
      user={{
        name: session.user.name,
        image: session.user.image,
      }}
      enabledModules={guildConfig.enabledModules || []}
      isBotOwner={isBotOwner}
      signOutAction={handleSignOut}
    >
      {children}
    </GuildLayoutShell>
  );
}
