import React from "react";
import Image from "next/image";
import { redirect } from "next/navigation";
import { auth, signOut } from "@/auth";
import { getMutualGuilds, refreshGuilds } from "@/actions/discord";
import { ToastNotifier } from "@/components/toast-notifier";
import { SignOutButton } from "@/components/action-buttons";
import { ServerSelector } from "./server-selector";

export default async function DashboardHome() {
  const session = await auth();

  if (!session?.user) {
    redirect("/login");
  }

  let mutualGuilds: Awaited<ReturnType<typeof getMutualGuilds>> = [];
  let fetchError: string | null = null;

  try {
    mutualGuilds = await getMutualGuilds();
  } catch (err) {
    fetchError = err instanceof Error ? err.message : String(err);
  }

  const clientId = process.env.DISCORD_CLIENT_ID;
  const inviteUrl = `https://discord.com/oauth2/authorize?client_id=${clientId}&permissions=8&integration_type=0&scope=bot`;

  const handleSignOut = async () => {
    "use server";
    await signOut({ redirectTo: "/login" });
  };

  const handleRefreshGuilds = async () => {
    "use server";
    await refreshGuilds();
  };

  return (
    <div className="min-h-screen bg-[#070a11] text-slate-100 flex flex-col font-sans">
      {/* Top Header */}
      <header className="sticky top-0 z-40 bg-[#070a11]/90 backdrop-blur-xl border-b border-slate-800/80">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Image
              src="/logo.png"
              alt="Sentinel Logo"
              width={32}
              height={32}
              className="object-contain rounded-full"
            />
            <div>
              <span className="text-base font-extrabold tracking-tight text-white block">
                Sentinel
              </span>

            </div>
          </div>

          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2.5 px-3 py-1.5 rounded-xl bg-slate-900/60 border border-slate-800 text-xs text-slate-300">
              {session.user.image ? (
                <Image
                  src={session.user.image}
                  alt={session.user.name || "User Avatar"}
                  width={24}
                  height={24}
                  className="rounded-full ring-1 ring-blue-500/40"
                />
              ) : (
                <div className="w-6 h-6 rounded-full bg-blue-600/30 flex items-center justify-center font-bold text-blue-400 text-[10px]">
                  {session.user.name?.charAt(0) || "U"}
                </div>
              )}
              <span className="font-semibold hidden sm:inline">
                {session.user.name}
              </span>
            </div>

            <form action={handleSignOut}>
              <SignOutButton />
            </form>
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="max-w-7xl mx-auto w-full px-6 py-8 flex-1 flex flex-col gap-6">
        <ToastNotifier message={fetchError} type="error" />

        <ServerSelector
          mutualGuilds={mutualGuilds}
          inviteUrl={inviteUrl}
          refreshAction={handleRefreshGuilds}
        />
      </main>
    </div>
  );
}
