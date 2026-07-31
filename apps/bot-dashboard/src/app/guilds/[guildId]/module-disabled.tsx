"use client";

import React from "react";
import Link from "next/link";
import { Lock, ArrowLeft } from "lucide-react";

export function ModuleDisabledView({
  guildId,
  moduleName,
}: {
  guildId: string;
  moduleName: string;
}) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center p-8 text-center min-h-[60vh]">
      <div className="max-w-md w-full bg-[#0c111d] border border-slate-800/80 rounded-3xl p-8 shadow-2xl flex flex-col gap-6 text-center relative overflow-hidden">
        <div className="w-16 h-16 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400 mx-auto">
          <Lock className="w-8 h-8 text-amber-400" />
        </div>

        <div className="space-y-2">
          <h1 className="text-2xl font-extrabold tracking-tight text-white">
            Module Disabled
          </h1>
          <p className="text-xs text-slate-400 leading-relaxed">
            The <span className="font-bold text-white font-mono uppercase">{moduleName}</span> module is currently disabled for this server. Please contact a Sentinel administrator to enable this feature in the Module Manager.
          </p>
        </div>

        <Link
          href={`/guilds/${guildId}`}
          className="w-full py-3 px-4 rounded-2xl bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800 text-xs font-semibold transition-all flex items-center justify-center gap-2"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to General Settings
        </Link>
      </div>
    </div>
  );
}
