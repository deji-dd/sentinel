import React from "react";
import { getGuildConfigFromApi } from "@/actions/guilds";
import { GuildSettingsForm } from "./settings-form";
import { Settings } from "lucide-react";

export default async function GuildSettingsPage({
  params,
}: {
  params: Promise<{ guildId: string }>;
}) {
  const { guildId } = await params;
  const botToken = process.env.DISCORD_BOT_TOKEN;

  let channels: { id: string; name: string; type: number }[] = [];
  let roles: { id: string; name: string; color: number }[] = [];

  try {
    if (botToken) {
      const [channelsRes, rolesRes] = await Promise.all([
        fetch(`https://discord.com/api/v10/guilds/${guildId}/channels`, {
          headers: { Authorization: `Bot ${botToken}` },
          next: { revalidate: 60 },
        }),
        fetch(`https://discord.com/api/v10/guilds/${guildId}/roles`, {
          headers: { Authorization: `Bot ${botToken}` },
          next: { revalidate: 60 },
        }),
      ]);

      if (channelsRes.ok) {
        channels = await channelsRes.json();
      }
      if (rolesRes.ok) {
        roles = await rolesRes.json();
      }
    }
  } catch (err) {
    console.error(`Failed to fetch channels/roles for ${guildId}:`, err);
  }

  const apiRes = await getGuildConfigFromApi(guildId);
  const guildConfig = apiRes?.config || {};

  return (
    <div className="space-y-8">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-slate-800/80">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight text-white">
            General Settings
          </h1>
          <p className="text-slate-400 text-xs sm:text-sm mt-1">
            Configure system audit logging, administrative role permissions, and active Torn API credentials.
          </p>
        </div>
      </div>

      <GuildSettingsForm
        guildId={guildId}
        guildName="Guild"
        initialConfig={{
          logChannelId: guildConfig.logChannelId || null,
          adminRoleIds: guildConfig.adminRoleIds || [],
          apiKeys: (apiRes?.apiKeys || []).map((k: any) => ({
            id: k.id,
            providedBy: k.providedBy,
            isValid: k.isValid,
            createdAt: new Date(k.createdAt),
          })),
        }}
        channels={channels}
        roles={roles}
      />
    </div>
  );
}
