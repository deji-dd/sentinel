import React from "react";
import Link from "next/link";
import { checkModuleEnabled } from "../module-guard";
import { ModuleDisabledView } from "../module-disabled";
import { getGuildConfigFromApi } from "@/actions/guilds";
import { VerificationForm } from "./verification-form";
import { UserCheck, KeyRound, ShieldAlert, ArrowRight } from "lucide-react";

export default async function VerificationModulePage({
  params,
}: {
  params: Promise<{ guildId: string }>;
}) {
  const { guildId } = await params;
  const isEnabled = await checkModuleEnabled(guildId, "verification");

  if (!isEnabled) {
    return <ModuleDisabledView guildId={guildId} moduleName="Verification Engine" />;
  }

  // Fetch guild config from Fastify API
  let apiRes: any = null;
  try {
    apiRes = await getGuildConfigFromApi(guildId);
  } catch (err) {
    console.error("Failed to fetch verification config:", err);
  }

  const config = apiRes?.config ?? {};
  const validApiKeys = (apiRes?.apiKeys || []).filter((k: any) => k.isValid);
  const hasValidApiKey = validApiKeys.length > 0;

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

      if (channelsRes.ok) channels = await channelsRes.json();
      if (rolesRes.ok) {
        const rawRoles = await rolesRes.json();
        // Filter out @everyone
        roles = rawRoles.filter((r: any) => r.name !== "@everyone");
      }
    } catch (err) {
      console.error("Failed to fetch Discord guild data:", err);
    }
  }

  const initialConfig = {
    verifiedRoleIds: config.verifiedRoleIds ?? [],
    nicknameTemplate: config.nicknameTemplate ?? "[{tag}] {name} [{id}]",
    verifyOnJoin: config.verifyOnJoin ?? false,
    verifyCron: config.verifyCron ?? false,
    verifyCronInterval: config.verifyCronInterval ?? 24,
    protectedRoleIds: config.protectedRoleIds ?? [],
    factionListChannelId: config.factionListChannelId ?? null,
    factionRoleMappings: config.factionRoleMappings ?? [],
  };

  return (
    <div className="space-y-8">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-slate-800/80">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight text-white">
            Verification
          </h1>
        </div>
      </div>

      {!hasValidApiKey && (
        <div className="p-6 sm:p-8 rounded-3xl bg-amber-500/5 border border-amber-500/20 backdrop-blur-xl relative overflow-hidden shadow-2xl">
          <div className="absolute -top-12 -right-12 w-48 h-48 bg-amber-500/10 rounded-full blur-3xl pointer-events-none" />

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-6 relative z-10">
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 rounded-2xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400 shrink-0 shadow-inner">
                <KeyRound className="w-6 h-6" />
              </div>
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <h3 className="text-lg font-bold text-amber-200 tracking-wide">
                    Torn API Key Required
                  </h3>
                  <span className="px-2 py-0.5 rounded-md bg-amber-500/20 text-amber-300 text-[10px] font-mono font-semibold uppercase tracking-wider">
                    Action Needed
                  </span>
                </div>
                <p className="text-sm text-slate-300 max-w-2xl leading-relaxed">
                  Verification engine requires at least one active, valid Torn API Key registered to this guild to query player profile data and automate role syncs.
                </p>
              </div>
            </div>

            <Link
              href={`/guilds/${guildId}`}
              className="inline-flex items-center justify-center gap-2 px-5 py-3 rounded-2xl bg-amber-500 text-slate-950 font-bold text-sm shadow-lg shadow-amber-500/20 hover:bg-amber-400 transition-all shrink-0 hover:scale-[1.02] active:scale-[0.98]"
            >
              Configure API Key
              <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        </div>
      )}

      <VerificationForm
        guildId={guildId}
        initialConfig={initialConfig}
        roles={roles}
        channels={channels}
      />
    </div>
  );
}
