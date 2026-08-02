"use client";

import React, { useState, useTransition } from "react";
import Link from "next/link";
import { updateGuildGeneralSettings } from "@/actions/guilds";
import {
  UserCheck,
  MapPin,
  Smile,
  Loader2,
  ChevronRight,
  CheckCircle2,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";

interface ModuleManagerProps {
  guildId: string;
  initialEnabledModules: string[];
}

export function ModuleManager({
  guildId,
  initialEnabledModules,
}: ModuleManagerProps) {
  const [enabledModules, setEnabledModules] = useState<string[]>(
    initialEnabledModules,
  );
  const [isSaving, startSaving] = useTransition();

  const availableModules = [
    {
      key: "verification",
      name: "Verification",
      icon: UserCheck,
      href: `/guilds/${guildId}/verification`,
      color: "text-blue-400 border-blue-500/30 bg-blue-500/10",
      accentBorder: "hover:border-blue-500/40",
      glow: "hover:shadow-blue-500/10",
    },
    {
      key: "territory",
      name: "Territory Assaults",
      icon: MapPin,
      href: `/guilds/${guildId}/territory`,
      color: "text-purple-400 border-purple-500/30 bg-purple-500/10",
      accentBorder: "hover:border-purple-500/40",
      glow: "hover:shadow-purple-500/10",
    },
    {
      key: "reaction_role",
      name: "Reaction Roles",
      icon: Smile,
      href: `/guilds/${guildId}/reaction-roles`,
      color: "text-amber-400 border-amber-500/30 bg-amber-500/10",
      accentBorder: "hover:border-amber-500/40",
      glow: "hover:shadow-amber-500/10",
    },
  ];

  const handleToggle = (moduleKey: string) => {
    const nextModules = enabledModules.includes(moduleKey)
      ? enabledModules.filter((m) => m !== moduleKey)
      : [...enabledModules, moduleKey];

    setEnabledModules(nextModules);

    startSaving(async () => {
      const res = await updateGuildGeneralSettings(guildId, {
        enabledModules: nextModules,
      });

      if (res.success) {
        toast.success(
          `Module configuration updated! (${nextModules.length} active)`,
        );
      } else {
        toast.error(res.error || "Failed to update module settings.");
      }
    });
  };

  return (
    <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
      {availableModules.map((mod) => {
        const Icon = mod.icon;
        const isEnabled = enabledModules.includes(mod.key);

        return (
          <div
            key={mod.key}
            className={`p-6 rounded-3xl border transition-all duration-200 flex flex-col justify-between gap-6 shadow-xl ${isEnabled
              ? `bg-[#0c111d] border-slate-800/80 ${mod.accentBorder} ${mod.glow}`
              : "bg-slate-900/30 border-slate-800/40 opacity-70"
              }`}
          >
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div
                  className={`w-11 h-11 rounded-2xl border flex items-center justify-center ${mod.color}`}
                >
                  <Icon className="w-5 h-5" />
                </div>

                {/* Animated iOS Toggle Switch */}
                <button
                  type="button"
                  onClick={() => handleToggle(mod.key)}
                  disabled={isSaving}
                  className={`w-14 h-7 rounded-full transition-all duration-200 relative cursor-pointer p-0.5 border ${isEnabled
                    ? "bg-blue-600 border-blue-500 shadow-md shadow-blue-600/30"
                    : "bg-slate-800 border-slate-700"
                    }`}
                  aria-label={`Toggle ${mod.name}`}
                >
                  <span
                    className={`w-5 h-5 rounded-full bg-white transition-transform duration-200 flex items-center justify-center shadow-md ${isEnabled ? "translate-x-7" : "translate-x-0.5"
                      }`}
                  >
                    {isSaving && (
                      <Loader2 className="w-3 h-3 text-slate-800 animate-spin" />
                    )}
                  </span>
                </button>
              </div>

              <div>
                <div className="flex items-center gap-2">
                  <h3 className="font-extrabold text-white text-base">
                    {mod.name}
                  </h3>
                </div>

              </div>
            </div>

            <div className="pt-4 border-t border-slate-800/60 flex items-center text-xs">


              {isEnabled && (
                <Link
                  href={mod.href}
                  prefetch={false}
                  className="flex items-center gap-1 text-xs font-semibold text-blue-400 hover:text-blue-300 transition-colors"
                >
                  <span>Configure</span>
                  <ChevronRight className="w-3.5 h-3.5" />
                </Link>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
