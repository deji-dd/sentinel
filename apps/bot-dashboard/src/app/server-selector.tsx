"use client";

import React, { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import {
  Search,
  Shield,
  Plus,
  Settings,
  ShieldAlert,
  MapPin,
  Zap,
  ChevronRight,
} from "lucide-react";
import { RefreshButton } from "@/components/action-buttons";

interface GuildItem {
  id: string;
  name: string;
  icon: string | null;
  owner?: boolean;
  permissions?: string;
}

interface ServerSelectorProps {
  mutualGuilds: GuildItem[];
  inviteUrl: string;
  refreshAction: () => Promise<void>;
}

export function ServerSelector({
  mutualGuilds,
  inviteUrl,
  refreshAction,
}: ServerSelectorProps) {
  const [search, setSearch] = useState("");

  const filteredGuilds = mutualGuilds.filter(
    (g) =>
      g.name.toLowerCase().includes(search.toLowerCase()) ||
      g.id.includes(search),
  );

  return (
    <div className="space-y-8">
      {/* Top Banner / Actions Bar */}
      <div className="p-6 lg:p-8 rounded-3xl bg-gradient-to-r from-[#0c1322] via-[#0f172a] to-[#0c1322] border border-slate-800/80 shadow-2xl relative overflow-hidden">
        {/* Glow ambient background */}
        <div className="absolute top-0 right-0 w-96 h-96 bg-blue-600/10 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute bottom-0 left-0 w-80 h-80 bg-purple-600/10 rounded-full blur-3xl pointer-events-none" />

        <div className="relative z-10 flex flex-col lg:flex-row lg:items-center justify-between gap-6">
          <div className="space-y-2">
            <h1 className="text-3xl lg:text-4xl font-extrabold tracking-tight text-white">
              Server Selection
            </h1>
            <p className="text-slate-400 text-sm max-w-2xl leading-relaxed">
              Manage configurations for Discord servers.
            </p>
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            <form action={refreshAction}>
              <RefreshButton />
            </form>

            <Link
              href="/tt-selector"
              className="py-2.5 px-4 rounded-xl bg-purple-600/15 hover:bg-purple-600/25 text-purple-300 text-xs font-semibold border border-purple-500/30 flex items-center gap-2 transition-all shadow-lg shadow-purple-900/10"
            >
              <MapPin className="w-4 h-4 text-purple-400" />
              TT Selector
            </Link>

            <a
              href={inviteUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="py-2.5 px-4 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold flex items-center gap-2 transition-all shadow-lg shadow-blue-600/25 hover:shadow-blue-600/40"
            >
              <Plus className="w-4 h-4" />
              Add to Server
            </a>
          </div>
        </div>
      </div>

      {/* Search Bar & Grid Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search server name or ID..."
            className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-slate-900/80 border border-slate-800 text-white text-xs placeholder:text-slate-500 focus:outline-none focus:border-blue-500/50 transition-colors"
          />
        </div>

        <span className="text-xs text-slate-500 font-mono">
          Showing {filteredGuilds.length} of {mutualGuilds.length} servers
        </span>
      </div>

      {/* Mutual Guilds Grid */}
      {filteredGuilds.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 px-6 rounded-3xl bg-slate-900/40 border border-slate-800/80 text-center gap-4">
          <div className="w-16 h-16 rounded-2xl bg-slate-800/80 border border-slate-700/80 flex items-center justify-center text-slate-400">
            <ShieldAlert className="w-8 h-8 text-amber-400" />
          </div>
          <div className="space-y-1 max-w-md">
            <h2 className="text-lg font-extrabold text-white">No Servers Found</h2>
            <p className="text-xs text-slate-400 leading-relaxed">
              {search
                ? `No mutual servers match "${search}". Try searching with another term.`
                : "You don't currently share any servers with Sentinel. Invite the bot to your Discord server to manage configuration settings."}
            </p>
          </div>
          <a
            href={inviteUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-2 py-2.5 px-5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold flex items-center gap-2 transition-all shadow-lg shadow-blue-600/20"
          >
            <Plus className="w-4 h-4" />
            Invite Sentinel
          </a>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-5">
          {filteredGuilds.map((guild) => (
            <Link
              key={guild.id}
              href={`/guilds/${guild.id}`}
              className="group relative p-5 rounded-2xl bg-[#0c111d] hover:bg-[#111728] border border-slate-800/80 hover:border-blue-500/40 transition-all duration-200 flex flex-col justify-between gap-5 shadow-xl hover:shadow-2xl hover:shadow-blue-500/5 hover:-translate-y-0.5"
            >
              <div className="flex items-center gap-3.5">
                <div className="relative w-12 h-12 rounded-xl overflow-hidden bg-slate-800 border border-slate-700/80 flex items-center justify-center text-lg font-bold text-blue-400 shrink-0 shadow-md">
                  {guild.icon ? (
                    <Image
                      src={`https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.png?size=128`}
                      alt={guild.name}
                      fill
                      className="object-cover"
                    />
                  ) : (
                    guild.name.charAt(0)
                  )}
                </div>

                <div className="min-w-0 flex-1">
                  <h3
                    className="font-bold text-sm text-white tracking-tight truncate group-hover:text-blue-400 transition-colors"
                    title={guild.name}
                  >
                    {guild.name}
                  </h3>
                  <span className="text-[10px] font-mono text-slate-500 block truncate mt-0.5">
                    ID: {guild.id}
                  </span>
                </div>
              </div>

              <div className="pt-3 border-t border-slate-800/60 flex items-center justify-between text-xs text-slate-400">
                <span className="text-[11px] font-mono text-slate-500">
                  {guild.owner ? "OWNER" : "ADMIN"}
                </span>
                <span className="flex items-center gap-1 text-xs font-semibold text-slate-300 group-hover:text-blue-400 transition-colors">
                  <Settings className="w-3.5 h-3.5" />
                  Manage
                  <ChevronRight className="w-3.5 h-3.5 transition-transform group-hover:translate-x-0.5" />
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
