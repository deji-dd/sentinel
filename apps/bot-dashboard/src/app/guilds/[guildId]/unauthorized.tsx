"use client";

import React from "react";
import Link from "next/link";
import { ShieldOff, ArrowLeft } from "lucide-react";

export function UnauthorizedView({
  guildId,
  guildName,
}: {
  guildId: string;
  guildName: string;
}) {
  return (
    <div className="min-h-screen bg-[#070a11] text-slate-100 flex items-center justify-center p-6 font-sans">
      <div className="max-w-md w-full bg-[#0c111d] border border-slate-800/80 rounded-3xl p-8 shadow-2xl flex flex-col gap-6 text-center relative overflow-hidden">
        <div className="w-16 h-16 rounded-2xl bg-red-500/10 border border-red-500/20 flex items-center justify-center text-red-400 mx-auto">
          <ShieldOff className="w-8 h-8" />
        </div>

        <div className="space-y-2">
          <h1 className="text-2xl font-extrabold tracking-tight text-white">
            Access Denied
          </h1>
          <p className="text-xs text-slate-400 leading-relaxed">
            You do not have permission to manage this server&apos;s configuration. Access is restricted to configured administrator roles or guild owners.
          </p>
        </div>

        <div className="p-4 rounded-2xl bg-slate-900/80 border border-slate-800 text-xs font-mono text-slate-300 space-y-2.5 text-left">
          <div className="flex justify-between items-center">
            <span className="text-slate-500">SERVER NAME:</span>
            <span className="font-bold text-white truncate max-w-[180px]">
              {guildName}
            </span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-slate-500">GUILD ID:</span>
            <span className="text-slate-300">{guildId}</span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-slate-500">ACCESS ROLE:</span>
            <span className="text-red-400 font-bold px-2 py-0.5 rounded-md bg-red-500/10 border border-red-500/20 text-[10px]">
              UNAUTHORIZED
            </span>
          </div>
        </div>

        <Link
          href="/"
          prefetch={false}
          className="w-full py-3 px-4 rounded-2xl bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800 text-xs font-semibold transition-all flex items-center justify-center gap-2"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Server Selection
        </Link>
      </div>
    </div>
  );
}
