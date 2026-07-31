import React from "react";
import { auth } from "@/auth";
import { getGuildConfigFromApi } from "@/actions/guilds";
import { ModuleManager } from "./module-manager";
import { UnauthorizedView } from "../unauthorized";
import { Sliders } from "lucide-react";

export default async function ModulesPage({
  params,
}: {
  params: Promise<{ guildId: string }>;
}) {
  const session = await auth();
  const { guildId } = await params;

  // Bot Owner / Admin Guard for Module Manager
  const botOwnerId = process.env.SENTINEL_DISCORD_USER_ID;
  const isBotOwner = session?.user?.id === botOwnerId;

  if (!isBotOwner) {
    return (
      <UnauthorizedView
        guildId={guildId}
        guildName="Module Manager (Restricted to Sentinel Owner)"
      />
    );
  }

  const apiRes = await getGuildConfigFromApi(guildId);
  const enabledModules: string[] = apiRes?.config?.enabledModules || [];

  return (
    <div className="space-y-8">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-slate-800/80">
        <div>

          <h1 className="text-3xl font-extrabold tracking-tight text-white">
            Module Manager
          </h1>

        </div>
      </div>

      <ModuleManager
        guildId={guildId}
        initialEnabledModules={enabledModules}
      />
    </div>
  );
}
