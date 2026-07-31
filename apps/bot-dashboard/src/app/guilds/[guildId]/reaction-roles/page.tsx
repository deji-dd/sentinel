import React from "react";
import { checkModuleEnabled } from "../module-guard";
import { ModuleDisabledView } from "../module-disabled";
import { getReactionRoleMessages } from "@/actions/guilds";
import { ReactionRolesForm } from "./reaction-roles-form";
import { Smile } from "lucide-react";

export default async function ReactionRolesModulePage({
  params,
}: {
  params: Promise<{ guildId: string }>;
}) {
  const { guildId } = await params;
  const isEnabled = await checkModuleEnabled(guildId, "reaction_role");

  if (!isEnabled) {
    return <ModuleDisabledView guildId={guildId} moduleName="Reaction Roles" />;
  }

  // Fetch reaction role messages from Fastify API
  const messages = await getReactionRoleMessages(guildId);

  // Fetch Discord channels and roles from bot API
  const botToken = process.env.DISCORD_BOT_TOKEN;
  let channels: { id: string; name: string; type: number }[] = [];
  let roles: { id: string; name: string; color: number }[] = [];

  if (botToken) {
    try {
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
        const rawChannels = await channelsRes.json();
        // Filter text channels (type 0 = GUILD_TEXT, 5 = GUILD_ANNOUNCEMENT)
        channels = rawChannels.filter(
          (c: any) => c.type === 0 || c.type === 5,
        );
      }
      if (rolesRes.ok) {
        const rawRoles = await rolesRes.json();
        // Filter out @everyone
        roles = rawRoles.filter((r: any) => r.name !== "@everyone");
      }
    } catch (err) {
      console.error("Failed to fetch Discord guild data for reaction roles:", err);
    }
  }

  return (
    <div className="space-y-8">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-slate-800/80">
        <div>

          <h1 className="text-3xl font-extrabold tracking-tight text-white">
            Reaction Roles
          </h1>

        </div>
      </div>

      {/* Main Reaction Roles Form & Management Grid */}
      <ReactionRolesForm
        guildId={guildId}
        initialMessages={messages}
        channels={channels}
        roles={roles}
      />
    </div>
  );
}
