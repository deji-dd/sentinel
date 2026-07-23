import { auth } from "@/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ArrowLeft, ShieldAlert } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { GuildConfigScaffold } from "./client-scaffold";
import { getMutualGuilds } from "@/actions/discord";
import { NotInitializedView } from "./not-initialized";
import { UnauthorizedView } from "./unauthorized";
import type { GuildConfigResponse, SystemModulesListResponse } from "@sentinel/shared";

export default async function GuildConfigPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();

  if (!session?.user?.id) {
    redirect("/login");
  }

  const { id } = await params;
  const mutualGuilds = await getMutualGuilds();

  // 1. Fetch Guild details, channels, and roles from Discord Bot API first
  let guildData: { name: string; icon: string | null; memberCount?: number } | null = null;
  let channels: { id: string; name: string; type: number }[] = [];
  let roles: { id: string; name: string; color: number; position: number }[] = [];
  try {
    const botToken = process.env.DISCORD_BOT_TOKEN;
    const guildRes = await fetch(`https://discord.com/api/v10/guilds/${id}?with_counts=true`, {
      headers: {
        Authorization: `Bot ${botToken}`,
      },
      next: { revalidate: 60 },
    });

    if (guildRes.ok) {
      const raw = await guildRes.json();
      guildData = {
        name: raw.name,
        icon: raw.icon,
        memberCount: raw.approximate_member_count,
      };
    }

    const channelsRes = await fetch(`https://discord.com/api/v10/guilds/${id}/channels`, {
      headers: {
        Authorization: `Bot ${botToken}`,
      },
      next: { revalidate: 60 },
    });
    if (channelsRes.ok) {
      channels = await channelsRes.json();
    }

    const rolesRes = await fetch(`https://discord.com/api/v10/guilds/${id}/roles`, {
      headers: {
        Authorization: `Bot ${botToken}`,
      },
      next: { revalidate: 60 },
    });
    if (rolesRes.ok) {
      roles = await rolesRes.json();
    }
  } catch (err) {
    console.error(`Failed to fetch guild details/channels/roles for ${id}:`, err);
  }

  const guildName = guildData?.name || "Server Profile";
  const guildIcon = guildData?.icon || null;

  // 2. Fetch Guild Configuration from Fastify API
  let configData: GuildConfigResponse | null = null;
  let dbErrorMsg: string | null = null;

  try {
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:3001";
    const res = await fetch(`${apiUrl}/api/guilds/${id}/config`, {
      headers: {
        "x-sentinel-secret": process.env.SENTINEL_INTERNAL_SECRET || "",
      },
      next: { revalidate: 0 }, // Do not cache
    });

    if (!res.ok) {
      throw new Error(`API returned status ${res.status}`);
    }

    configData = await res.json();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    console.error("Failed to fetch guild config from Fastify API:", err);
    dbErrorMsg = err.message || String(err);
  }

  // Render database connection errors outside try/catch
  if (dbErrorMsg) {
    return (
      <div className="relative flex min-h-screen flex-col bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100 overflow-hidden selection:bg-emerald-500/30">
        {/* Background Atmosphere (Mirroring Login Page) */}
        <div className="fixed inset-0 z-0 pointer-events-none">
          <div className="absolute inset-0 bg-linear-to-br from-zinc-100 to-zinc-50 dark:from-zinc-900 dark:to-zinc-950" />
          <div className="absolute top-[-10%] left-[-10%] h-[500px] w-[500px] rounded-full bg-red-500/10 dark:bg-red-600/20 blur-[120px]" />
          <div className="absolute bottom-[-10%] right-[-10%] h-[500px] w-[500px] rounded-full bg-orange-500/10 dark:bg-orange-600/20 blur-[120px]" />

          {/* Subtle Grid overlay */}
          <div className="absolute inset-0 bg-[linear-gradient(to_right,#00000005_1px,transparent_1px),linear-gradient(to_bottom,#00000005_1px,transparent_1px)] dark:bg-[linear-gradient(to_right,#ffffff0a_1px,transparent_1px),linear-gradient(to_bottom,#ffffff0a_1px,transparent_1px)] bg-[size:4rem_4rem] [mask-image:radial-gradient(ellipse_60%_60%_at_50%_50%,#000_70%,transparent_100%)]" />
        </div>

        <div className="relative z-10 flex flex-1 flex-col items-center justify-center p-6 md:p-12 w-full">
          <Card className="max-w-[448px] w-full bg-white/60 dark:bg-zinc-900/60 border border-black/5 dark:border-white/5 backdrop-blur-xl shadow-[0_20px_50px_rgba(0,0,0,0.05)] dark:shadow-[0_20px_50px_rgba(0,0,0,0.3)] hover:border-red-500/20 transition-all duration-500">
            <CardHeader className="text-center pb-6 border-b border-black/5 dark:border-white/5">
              <div className="mx-auto flex size-14 items-center justify-center rounded-full bg-red-500/10 border border-red-500/20 mb-4">
                <ShieldAlert className="size-6 text-red-600 dark:text-red-400" />
              </div>
              <CardTitle className="text-xl font-bold tracking-tight text-zinc-900 dark:text-white">
                Database Connection Error
              </CardTitle>
              <CardDescription className="text-xs text-zinc-500 dark:text-zinc-400 mt-2 max-w-xs mx-auto">
                Unable to connect to the configuration API. Please ensure the API service is running.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6 pt-6">
              <div className="rounded-xl bg-black/5 dark:bg-black/40 border border-black/5 dark:border-white/5 p-4 text-xs font-mono text-red-500 space-y-2">
                <div className="flex flex-col">
                  <span className="text-zinc-400 dark:text-zinc-500">ERROR DIAGNOSTIC:</span>
                  <span className="font-bold whitespace-pre-wrap break-all mt-1">{dbErrorMsg}</span>
                </div>
              </div>

              <Link href="/" className="block">
                <Button className="w-full h-11 bg-zinc-900 dark:bg-white text-white dark:text-black hover:bg-zinc-800 dark:hover:bg-zinc-100 font-bold shadow-[0_4px_20px_rgba(0,0,0,0.15)] dark:shadow-[0_4px_20px_rgba(255,255,255,0.1)] transition-all">
                  <ArrowLeft className="size-4 mr-2" />
                  Back to Dashboard
                </Button>
              </Link>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  // 3. If Guild is not initialized, render request initialization view
  if (!configData || !configData.initialized) {
    return <NotInitializedView guildId={id} guildName={guildName} />;
  }

  // Find or fetch bot owner ID
  let botOwnerId = process.env.SENTINEL_DISCORD_USER_ID;
  if (!botOwnerId) {
    try {
      const botToken = process.env.DISCORD_BOT_TOKEN;
      const appRes = await fetch("https://discord.com/api/v10/oauth2/applications/@me", {
        headers: { Authorization: `Bot ${botToken}` },
      });
      if (appRes.ok) {
        const appInfo = await appRes.json();
        botOwnerId = appInfo.owner?.id;
      }
    } catch (err) {
      console.error("Failed to dynamically fetch bot owner:", err);
    }
  }

  const isBotOwner = session.user.id === botOwnerId;

  // 4. Guild is initialized, perform access verification
  let isAuthorized = isBotOwner;
  try {
    const mutualGuilds = await getMutualGuilds();
    const userGuild = mutualGuilds.find((g) => g.id === id);

    if (userGuild) {
      // Check if the user is the Guild Owner or has Admin permissions (Manage Server/Administrator)
      const permissions = BigInt(userGuild.permissions || "0");
      const isGuildAdmin =
        userGuild.owner ||
        (permissions & BigInt("8")) === BigInt("8") || // ADMINISTRATOR
        (permissions & BigInt("32")) === BigInt("32"); // MANAGE_GUILD

      const adminRoleIds = configData.config?.admin_role_ids || [];

      if (adminRoleIds.length === 0) {
        // If no admin roles are explicitly configured, only Guild Owners/Administrators can configure the bot
        if (isGuildAdmin) {
          isAuthorized = true;
        }
      } else {
        // If admin roles are configured, user MUST have one of the admin roles.
        // Fetch member details from Discord Bot API to check roles.
        const botToken = process.env.DISCORD_BOT_TOKEN;
        const memberRes = await fetch(`https://discord.com/api/v10/guilds/${id}/members/${session.user.id}`, {
          headers: {
            Authorization: `Bot ${botToken}`,
          },
          next: { revalidate: 0 },
        });

        if (memberRes.ok) {
          const member = await memberRes.json();
          const userRoleIds = (member.roles || []) as string[];
          const hasAdminRole = userRoleIds.some((roleId) => adminRoleIds.includes(roleId));

          if (hasAdminRole) {
            isAuthorized = true;
          }
        } else {
          console.error(`Failed to fetch member details for ${session.user.id} in ${id}:`, await memberRes.text());
        }
      }
    }
  } catch (err) {
    console.error("Access verification check crashed:", err);
  }

  // Render unauthorized states outside try/catch
  if (!isAuthorized) {
    return <UnauthorizedView guildId={id} guildName={guildName} />;
  }

  // Fetch System Modules from Fastify API
  let systemModules: SystemModulesListResponse = [];
  try {
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:3001";
    const modulesRes = await fetch(`${apiUrl}/api/guilds/modules/list`, {
      headers: {
        "x-sentinel-secret": process.env.SENTINEL_INTERNAL_SECRET || "",
      },
      next: { revalidate: 60 },
    });

    if (modulesRes.ok) {
      systemModules = await modulesRes.json();
    }
  } catch (err) {
    console.error("Failed to fetch system modules list:", err);
  }

  // 5. Authorized - Render configuration dashboard
  return (
    <div className="relative flex h-screen flex-col bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100 overflow-hidden selection:bg-emerald-500/30">
      {/* Background Atmosphere */}
      <div className="fixed inset-0 z-0 pointer-events-none">
        <div className="absolute inset-0 bg-linear-to-br from-zinc-100 to-zinc-50 dark:from-zinc-900 dark:to-zinc-950" />
        <div className="absolute top-[-20%] left-[-10%] h-[800px] w-[800px] rounded-full bg-emerald-500/10 dark:bg-emerald-500/5 blur-[120px]" />
        <div className="absolute bottom-[-20%] right-[-10%] h-[800px] w-[800px] rounded-full bg-blue-500/10 dark:bg-blue-500/5 blur-[120px]" />
        <div className="absolute inset-0 bg-[linear-gradient(to_right,#00000005_1px,transparent_1px),linear-gradient(to_bottom,#00000005_1px,transparent_1px)] dark:bg-[linear-gradient(to_right,#ffffff05_1px,transparent_1px),linear-gradient(to_bottom,#ffffff05_1px,transparent_1px)] bg-[size:4rem_4rem] [mask-image:radial-gradient(ellipse_80%_80%_at_50%_0%,#000_70%,transparent_100%)]" />
      </div>

      <div className="flex-1 w-full flex flex-col relative z-10">
        <GuildConfigScaffold
          guildId={id}
          guildName={guildName}
          guildIcon={guildIcon}
          initialConfig={configData?.config || {}}
          hasApiKey={configData?.hasApiKey || false}
          apiKeys={configData?.apiKeys || []}
          systemModules={systemModules}
          isBotOwner={isBotOwner}
          channels={channels}
          roles={roles}
          mutualGuilds={mutualGuilds}
        />
      </div>
    </div>
  );
}
