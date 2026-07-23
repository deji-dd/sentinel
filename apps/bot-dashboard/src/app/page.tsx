import { getMutualGuilds } from "@/actions/discord";
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { RefreshButton } from "@/components/refresh-button";
import { buttonVariants } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Plus, Settings, ShieldAlert } from "lucide-react";
import { DynamicIslandHeader } from "@/components/dynamic-island-header";

export default async function DashboardHome() {
  const session = await auth();

  if (!session?.user) {
    redirect("/login");
  }

  const mutualGuilds = await getMutualGuilds();

  const inviteUrl = `https://discord.com/oauth2/authorize?client_id=${process.env.AUTH_DISCORD_ID}&permissions=8&integration_type=0&scope=bot`;

  return (
    <div className="relative flex min-h-screen flex-col bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-white selection:bg-primary/30 overflow-hidden">
      {/* Background Atmosphere (matching login page) */}
      <div className="fixed inset-0 z-0 pointer-events-none">
        <div className="absolute inset-0 bg-linear-to-br from-zinc-100 to-zinc-50 dark:from-zinc-900 dark:to-zinc-950" />
        <div className="absolute top-[-20%] left-[-10%] h-[700px] w-[700px] rounded-full bg-blue-500/10 dark:bg-blue-600/15 blur-[120px]" />
        <div className="absolute bottom-[-20%] right-[-10%] h-[700px] w-[700px] rounded-full bg-indigo-500/10 dark:bg-indigo-600/15 blur-[120px]" />

        {/* Subtle Grid overlay */}
        <div className="absolute inset-0 bg-[linear-gradient(to_right,#00000005_1px,transparent_1px),linear-gradient(to_bottom,#00000005_1px,transparent_1px)] dark:bg-[linear-gradient(to_right,#ffffff0a_1px,transparent_1px),linear-gradient(to_bottom,#ffffff0a_1px,transparent_1px)] bg-[size:4rem_4rem] [mask-image:radial-gradient(ellipse_80%_80%_at_50%_0%,#000_70%,transparent_100%)]" />
      </div>

      {/* Dynamic Island Header */}
      <DynamicIslandHeader user={session.user} mutualGuildsCount={mutualGuilds.length} />

      {/* Main Content */}
      <main className="relative z-10 container mx-auto flex-1 space-y-10 p-4 sm:p-8 pt-12 pb-20">
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-6">
          <div className="space-y-2">
            <h1 className="text-4xl font-bold tracking-tighter sm:text-5xl bg-clip-text text-transparent bg-linear-to-br from-zinc-900 to-zinc-600 dark:from-white dark:to-white/60">
              Server Selection
            </h1>
            <p className="text-lg text-zinc-600 dark:text-zinc-400 max-w-xl">
              Select a server to configure or manage access controls.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <RefreshButton />
            <Link href="/tt-selector" className={buttonVariants({ variant: "outline", size: "default" })}>
              TT Selector
            </Link>
            <a href={inviteUrl} target="_blank" rel="noopener noreferrer" className={buttonVariants({ variant: "default", size: "default" })}>
              <Plus className="mr-2 h-4 w-4" />
              Add to Server
            </a>
          </div>
        </div>

        {mutualGuilds.length === 0 ? (
          <div className="flex min-h-[400px] flex-col items-center justify-center rounded-2xl border border-dashed border-black/10 dark:border-white/10 bg-white/30 dark:bg-zinc-900/30 backdrop-blur-sm p-8 text-center animate-in fade-in-50 zoom-in-95 duration-500">
            <div className="mx-auto flex max-w-[420px] flex-col items-center justify-center text-center">
              <div className="flex size-20 items-center justify-center rounded-full bg-primary/10 mb-6 shadow-inner ring-1 ring-primary/20">
                <ShieldAlert className="size-10 text-primary" />
              </div>
              <h2 className="text-2xl font-semibold tracking-tight">No Mutual Servers</h2>
              <p className="mt-3 text-base text-zinc-600 dark:text-zinc-400 mb-8">
                You do not share any servers with the Sentinel bot. Invite the bot to your server to get started.
              </p>
              <a href={inviteUrl} target="_blank" className={buttonVariants({ variant: "default", size: "lg" })} rel="noopener noreferrer">
                <Plus className="mr-2 h-5 w-5" />
                Invite Sentinel
              </a>
            </div>
          </div>
        ) : (
          <div className="grid gap-5 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 animate-in fade-in-50 slide-in-from-bottom-4 duration-700">
            {mutualGuilds.map((guild) => (
              <Link key={guild.id} href={`/guilds/${guild.id}`}>
                <div className="group relative flex flex-col items-center justify-center gap-5 rounded-2xl border border-black/5 dark:border-white/5 bg-white/50 dark:bg-zinc-900/50 backdrop-blur-sm p-6 text-zinc-900 dark:text-zinc-100 shadow-sm transition-all hover:-translate-y-1 hover:border-primary/30 hover:bg-white/80 dark:hover:bg-zinc-800/80 hover:shadow-[0_8px_30px_rgb(0,0,0,0.04)] dark:hover:shadow-[0_8px_30px_rgba(255,255,255,0.04)] h-[240px]">
                  <Avatar className="size-[88px] shadow-sm transition-all group-hover:shadow-md ring-1 ring-black/10 dark:ring-white/10 group-hover:ring-primary/40">
                    {guild.icon ? (
                      <AvatarImage src={`https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.png?size=256`} alt={guild.name} />
                    ) : null}
                    <AvatarFallback className="bg-primary/10 text-3xl font-bold text-primary">
                      {guild.name.charAt(0)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="text-center space-y-1 w-full mt-2">
                    <h3 className="font-semibold text-lg tracking-tight truncate px-2" title={guild.name}>
                      {guild.name}
                    </h3>
                  </div>
                  <div className="absolute top-4 right-4 opacity-0 transition-all group-hover:opacity-100 scale-95 group-hover:scale-100">
                    <Settings className="size-5 text-zinc-400 dark:text-zinc-500 hover:text-primary transition-colors" />
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
