"use client";

import Image from "next/image";
import { ThemeToggle } from "@/components/theme-toggle";
import { SignOutButton } from "@/components/sign-out-button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Server } from "lucide-react";

interface DynamicIslandHeaderProps {
  user: {
    name?: string | null;
    image?: string | null;
  };
  mutualGuildsCount: number;
}

export function DynamicIslandHeader({
  user,
  mutualGuildsCount,
}: DynamicIslandHeaderProps) {
  return (
    <div className="sticky top-4 z-50 mx-auto w-[92%] max-w-4xl transition-all duration-300">
      <header className="group flex items-center justify-between gap-3 sm:gap-6 rounded-full bg-white/75 dark:bg-zinc-900/80 backdrop-blur-2xl border border-zinc-200/80 dark:border-zinc-800/80 p-2 pl-3 sm:pl-4 shadow-2xl shadow-black/5 dark:shadow-black/40 hover:border-zinc-300 dark:hover:border-zinc-700 hover:shadow-black/10 dark:hover:shadow-black/60 transition-all duration-300">
        {/* Left: Brand Identity */}
        <div className="flex items-center gap-2.5 shrink-0">
          <Image
            src="/logo.png"
            alt="Sentinel"
            width={26}
            height={26}
            className="object-contain rounded-full"
          />

          <div className="flex flex-col">
            <div className="flex items-center gap-1.5">
              <span className="font-bold text-sm text-zinc-900 dark:text-white tracking-tight">
                Sentinel
              </span>
            </div>
            <span className="text-[10px] text-zinc-500 dark:text-zinc-400 font-medium">
              Control Center
            </span>
          </div>
        </div>

        {/* Center: Dynamic Island Badge */}
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-zinc-100/80 dark:bg-zinc-800/80 border border-zinc-200/60 dark:border-zinc-700/60 text-xs font-semibold text-zinc-700 dark:text-zinc-300 shadow-inner shrink-0">
          <Server className="size-3.5 text-emerald-500 animate-pulse" />
          <span>{mutualGuildsCount} Servers</span>
        </div>

        {/* Right: Controls & User Profile */}
        <div className="flex items-center gap-2 shrink-0">
          <ThemeToggle />

          {user.image && (
            <Avatar className="size-8 ring-2 ring-emerald-500/20 dark:ring-emerald-500/30 shadow-xs">
              <AvatarImage src={user.image} alt={user.name || "User"} />
              <AvatarFallback className="text-xs font-bold bg-emerald-500/10 text-emerald-600">
                {user.name?.charAt(0) || "U"}
              </AvatarFallback>
            </Avatar>
          )}

          <div className="scale-90 sm:scale-100">
            <SignOutButton />
          </div>
        </div>
      </header>
    </div>
  );
}
