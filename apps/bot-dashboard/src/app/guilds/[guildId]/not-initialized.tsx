"use client";

import React, { useState } from "react";
import Link from "next/link";
import { ShieldAlert, ArrowLeft, Send } from "lucide-react";
import { toast } from "sonner";

export function NotInitializedView({
  guildId,
  guildName,
}: {
  guildId: string;
  guildName: string;
}) {
  const [loading, setLoading] = useState(false);
  const [requested, setRequested] = useState(false);

  const handleRequestInit = async () => {
    setLoading(true);
    try {
      toast.success("Initialization request submitted to Sentinel administrator!");
      setRequested(true);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to submit request.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#070a11] text-slate-100 flex items-center justify-center p-6 font-sans">
      <div className="max-w-md w-full bg-[#0c111d] border border-slate-800/80 rounded-3xl p-8 shadow-2xl flex flex-col gap-6 text-center relative overflow-hidden">
        <div className="w-16 h-16 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400 mx-auto animate-pulse">
          <ShieldAlert className="w-8 h-8" />
        </div>

        <div className="space-y-2">
          <h1 className="text-2xl font-extrabold tracking-tight text-white">
            Sentinel Not Initialized
          </h1>
          <p className="text-xs text-slate-400 leading-relaxed">
            This server exists on Discord, but its Sentinel configuration database has not been initialized yet.
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
            <span className="text-slate-500">STATUS:</span>
            <span className="text-amber-400 font-bold px-2 py-0.5 rounded-md bg-amber-500/10 border border-amber-500/20 text-[10px]">
              UNINITIALIZED
            </span>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <Link
            href="/"
            className="flex-1 py-3 px-4 rounded-2xl bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800 text-xs font-semibold transition-all flex items-center justify-center gap-2"
          >
            <ArrowLeft className="w-4 h-4" />
            Dashboard
          </Link>

          <button
            type="button"
            onClick={handleRequestInit}
            disabled={loading || requested}
            className="flex-1 py-3 px-4 rounded-2xl bg-blue-600 hover:bg-blue-500 disabled:opacity-60 text-white text-xs font-semibold transition-all flex items-center justify-center gap-2 cursor-pointer shadow-lg shadow-blue-600/20"
          >
            <Send className="w-4 h-4" />
            {requested ? "Request Sent" : loading ? "Sending..." : "Request Init"}
          </button>
        </div>
      </div>
    </div>
  );
}
