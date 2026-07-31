"use client";

import React from "react";
import { useFormStatus } from "react-dom";
import { RefreshCw, LogOut, Loader2 } from "lucide-react";

export function RefreshButton() {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      className="py-2.5 px-4 rounded-xl bg-slate-900/80 hover:bg-slate-800 disabled:opacity-60 text-slate-300 hover:text-white text-xs font-semibold border border-slate-800 flex items-center gap-2 transition-all cursor-pointer shadow-md"
    >
      <RefreshCw className={`w-3.5 h-3.5 ${pending ? "animate-spin text-blue-400" : ""}`} />
      {pending ? "Refreshing..." : "Refresh Servers"}
    </button>
  );
}

export function SignOutButton() {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      className="p-2.5 rounded-xl bg-slate-900/80 hover:bg-red-500/15 disabled:opacity-60 text-slate-400 hover:text-red-400 transition-all border border-slate-800 hover:border-red-500/30 cursor-pointer flex items-center justify-center min-w-[36px] min-h-[36px]"
      title="Sign Out"
    >
      {pending ? (
        <Loader2 className="w-4 h-4 animate-spin text-red-400" />
      ) : (
        <LogOut className="w-4 h-4" />
      )}
    </button>
  );
}

export function LoginSubmitButton() {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full py-3.5 px-5 rounded-2xl bg-blue-600 hover:bg-blue-500 disabled:opacity-75 text-white font-semibold text-sm transition-all duration-150 flex items-center justify-center gap-2.5 shadow-lg shadow-blue-600/30 hover:shadow-blue-600/40 cursor-pointer"
    >
      {pending ? (
        <>
          <Loader2 className="w-4 h-4 animate-spin" />
          Signing in with Discord...
        </>
      ) : (
        "Sign In with Discord"
      )}
    </button>
  );
}
