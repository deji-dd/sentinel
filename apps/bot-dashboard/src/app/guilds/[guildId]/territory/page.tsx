import React from "react";
import { checkModuleEnabled } from "../module-guard";
import { ModuleDisabledView } from "../module-disabled";
import { getGuildConfigFromApi, getTerritories } from "@/actions/guilds";
import { TerritoryForm } from "./territory-form";

export default async function TerritoryModulePage({
  params,
}: {
  params: Promise<{ guildId: string }>;
}) {
  const { guildId } = await params;
  const isEnabled = await checkModuleEnabled(guildId, "territory");

  if (!isEnabled) {
    return <ModuleDisabledView guildId={guildId} moduleName="Territory Assaults" />;
  }

  // Fetch guild config from Fastify API
  let apiRes: any = null;
  try {
    apiRes = await getGuildConfigFromApi(guildId);
  } catch (err) {
    console.error("Failed to fetch territory config:", err);
  }

  // Fetch DB territories
  let territories: { id: string; sector?: number }[] = [];
  try {
    territories = await getTerritories();
  } catch (err) {
    console.error("Failed to fetch territories:", err);
  }

  const config = apiRes?.config ?? {};

  // Fetch Discord channels from Bot API
  const botToken = process.env.DISCORD_BOT_TOKEN;
  let channels: { id: string; name: string; type: number }[] = [];

  if (botToken) {
    try {
      const channelsRes = await fetch(
        `https://discord.com/api/v10/guilds/${guildId}/channels`,
        {
          headers: { Authorization: `Bot ${botToken}` },
          next: { revalidate: 60 },
        },
      );

      if (channelsRes.ok) {
        channels = await channelsRes.json();
      }
    } catch (err) {
      console.error("Failed to fetch Discord guild channels:", err);
    }
  }

  const initialConfig = {
    ttFullChannelId: config.ttFullChannelId ?? null,
    ttFilteredChannelId: config.ttFilteredChannelId ?? null,
    ttTerritoryIds: config.ttTerritoryIds ?? [],
    ttFactionIds: config.ttFactionIds ?? [],
  };

  return (
    <div className="space-y-8">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-slate-800/80">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight text-white">
            Territory
          </h1>
        </div>
      </div>

      {/* Territory Settings Form */}
      <TerritoryForm
        guildId={guildId}
        initialConfig={initialConfig}
        channels={channels}
        territories={territories}
      />
    </div>
  );
}

