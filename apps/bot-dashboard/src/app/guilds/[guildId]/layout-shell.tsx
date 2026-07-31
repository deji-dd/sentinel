"use client";

import React, { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { ArrowLeft, Menu, X } from "lucide-react";
import { GuildSidebar } from "./sidebar";
import { SignOutButton } from "@/components/action-buttons";

interface GuildLayoutShellProps {
  guildId: string;
  guildName: string;
  guildIcon: string | null;
  user: {
    name?: string | null;
    image?: string | null;
  };
  enabledModules: string[];
  isBotOwner: boolean;
  signOutAction: () => Promise<void>;
  children: React.ReactNode;
}

export function GuildLayoutShell({
  guildId,
  guildName,
  guildIcon,
  user,
  enabledModules,
  isBotOwner,
  signOutAction,
  children,
}: GuildLayoutShellProps) {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="min-h-screen bg-[#070a11] text-slate-100 flex flex-col font-sans">
      {/* Top Navigation Bar */}
      <header className="sticky top-0 z-40 bg-[#070a11]/90 backdrop-blur-xl border-b border-slate-800/80">
        <div className="w-full px-4 lg:px-8 h-16 flex items-center justify-between">
          {/* Left: Mobile Toggle + Server Identity */}
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setMobileOpen(!mobileOpen)}
              className="lg:hidden p-2 rounded-xl bg-slate-900 border border-slate-800 text-slate-400 hover:text-white transition-colors"
              aria-label="Toggle Navigation Menu"
            >
              {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>

            <Link
              href="/"
              className="p-2 rounded-xl bg-slate-900/80 hover:bg-slate-800 text-slate-400 hover:text-white transition-colors border border-slate-800 flex items-center gap-1.5 text-xs font-medium"
              title="Back to Server Selection"
            >
              <ArrowLeft className="w-4 h-4" />
              <span className="hidden sm:inline">Servers</span>
            </Link>

            <div className="h-5 w-px bg-slate-800 mx-1 hidden sm:block" />

            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-xl overflow-hidden bg-slate-800 border border-slate-700/80 flex items-center justify-center font-bold text-blue-400 text-xs shadow-md">
                {guildIcon ? (
                  <Image
                    src={`https://cdn.discordapp.com/icons/${guildId}/${guildIcon}.png?size=128`}
                    alt={guildName}
                    width={32}
                    height={32}
                    className="object-cover w-full h-full"
                  />
                ) : (
                  guildName.charAt(0)
                )}
              </div>
              <div>
                <span className="text-sm font-extrabold tracking-tight block text-white">
                  {guildName}
                </span>
                <span className="text-[10px] font-mono text-slate-500 block -mt-0.5">
                  ID: {guildId}
                </span>
              </div>
            </div>
          </div>

          {/* Right: User Profile & Actions */}
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2.5 px-3 py-1.5 rounded-xl bg-slate-900/60 border border-slate-800">
              {user.image ? (
                <Image
                  src={user.image}
                  alt={user.name || "User Avatar"}
                  width={24}
                  height={24}
                  className="rounded-full ring-1 ring-blue-500/40"
                />
              ) : (
                <div className="w-6 h-6 rounded-full bg-blue-600/30 flex items-center justify-center font-bold text-blue-400 text-[10px]">
                  {user.name?.charAt(0) || "U"}
                </div>
              )}
              <span className="text-xs font-semibold text-slate-200 hidden md:inline">
                {user.name}
              </span>
            </div>

            <form action={signOutAction}>
              <SignOutButton />
            </form>
          </div>
        </div>
      </header>

      {/* Main Body Grid: Edge-to-Edge Sidebar + Main Content */}
      <div className="flex-1 w-full flex relative">
        {/* Desktop Sidebar (Flush to left screen edge) */}
        <div className="hidden lg:block sticky top-16 h-[calc(100vh-4rem)]">
          <GuildSidebar
            guildId={guildId}
            enabledModules={enabledModules}
            isBotOwner={isBotOwner}
          />
        </div>

        {/* Mobile Slide-Out Navigation Drawer */}
        {mobileOpen && (
          <div className="fixed inset-0 z-50 lg:hidden flex">
            <div
              className="fixed inset-0 bg-black/70 backdrop-blur-sm"
              onClick={() => setMobileOpen(false)}
            />
            <div className="relative w-72 bg-[#0c111d] h-full z-10 shadow-2xl flex flex-col">
              <div className="p-4 border-b border-slate-800 flex items-center justify-between">
                <span className="text-xs font-mono uppercase tracking-wider text-slate-400 font-bold">
                  Navigation Menu
                </span>
                <button
                  type="button"
                  onClick={() => setMobileOpen(false)}
                  className="p-1 rounded-lg text-slate-400 hover:text-white"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto">
                <GuildSidebar
                  guildId={guildId}
                  enabledModules={enabledModules}
                  isBotOwner={isBotOwner}
                  onNavigate={() => setMobileOpen(false)}
                />
              </div>
            </div>
          </div>
        )}

        {/* Main Content Viewport */}
        <main className="flex-1 min-w-0 p-6 lg:p-10 max-w-6xl">
          {children}
        </main>
      </div>
    </div>
  );
}
