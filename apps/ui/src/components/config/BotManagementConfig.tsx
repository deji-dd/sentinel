import { useState, useEffect, forwardRef, useImperativeHandle } from "react";
import { LoadingScreen } from "@/components/loading-screen";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  CardFooter,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Database, Zap, Shield, Trash2, Plus } from "lucide-react";
import { toast } from "sonner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";

interface BotGuild {
  id: string;
  name: string;
  icon?: string;
  enabled_modules: string[];
  initialized_at: string;
}

export const BotManagementConfig = forwardRef(
  (
    {
      sessionToken,
    }: {
      sessionToken: string;
    },
    ref,
  ) => {
    const [loading, setLoading] = useState(true);
    const [guilds, setGuilds] = useState<BotGuild[]>([]);
    const [unconfiguredGuilds, setUnconfiguredGuilds] = useState<any[]>([]);
    const [triggeringBackup, setTriggeringBackup] = useState(false);
    const [deploying, setDeploying] = useState(false);
    const [teardownId, setTeardownId] = useState<string | null>(null);

    const fetchGuildData = async (silent = false) => {
      if (!silent) setLoading(true);
      try {
        const API_BASE =
          import.meta.env.VITE_API_URL || "http://localhost:3001";
        const [resGuilds, resUnconfigured] = await Promise.all([
          fetch(`${API_BASE}/api/admin/guilds`, {
            headers: { Authorization: `Bearer ${sessionToken}` },
          }),
          fetch(`${API_BASE}/api/admin/unconfigured-guilds`, {
            headers: { Authorization: `Bearer ${sessionToken}` },
          }),
        ]);

        if (!resGuilds.ok || !resUnconfigured.ok)
          throw new Error("Failed to fetch guilds");

        setGuilds(await resGuilds.json());
        setUnconfiguredGuilds(await resUnconfigured.json());
      } catch (err) {
        toast.error("Failed to load bot-configured guilds");
      } finally {
        if (!silent) setLoading(false);
      }
    };

    useEffect(() => {
      fetchGuildData();
    }, [sessionToken]);

    useImperativeHandle(ref, () => ({
      save: async () => {
        // No global save needed here as actions are immediate
        return true;
      },
    }));

    const handleBackup = async () => {
      setTriggeringBackup(true);
      try {
        const API_BASE =
          import.meta.env.VITE_API_URL || "http://localhost:3001";
        const res = await fetch(`${API_BASE}/api/admin/backups`, {
          method: "POST",
          headers: { Authorization: `Bearer ${sessionToken}` },
        });
        if (!res.ok) throw new Error("Backup failed");
        toast.success("Full database backup sent to your DMs");
      } catch (err) {
        toast.error("Failed to trigger backup");
      } finally {
        setTriggeringBackup(false);
      }
    };

    const handleDeploy = async () => {
      setDeploying(true);
      try {
        const API_BASE =
          import.meta.env.VITE_API_URL || "http://localhost:3001";
        const res = await fetch(`${API_BASE}/api/admin/deploy`, {
          method: "POST",
          headers: { Authorization: `Bearer ${sessionToken}` },
        });
        if (!res.ok) throw new Error("Deployment failed");
        toast.success("Commands refreshed across configured guilds");
      } catch (err) {
        toast.error("Failed to refresh commands");
      } finally {
        setDeploying(false);
      }
    };

    const handleTeardown = async () => {
      if (!teardownId) return;
      try {
        const API_BASE =
          import.meta.env.VITE_API_URL || "http://localhost:3001";
        const res = await fetch(`${API_BASE}/api/admin/guilds/${teardownId}`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${sessionToken}` },
        });
        if (!res.ok) throw new Error("Teardown failed");
        toast.success("Guild configuration removed");
        setTeardownId(null);
        await fetchGuildData(true);
      } catch (err) {
        toast.error("Failed to teardown guild");
      }
    };

    const handleSetupGuild = async (guildId: string) => {
      try {
        const API_BASE =
          import.meta.env.VITE_API_URL || "http://localhost:3001";
        const res = await fetch(`${API_BASE}/api/admin/guilds`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${sessionToken}`,
          },
          body: JSON.stringify({ guildId }),
        });
        if (!res.ok) throw new Error("Setup failed");
        toast.success("Guild initialized successfully");
        await fetchGuildData(true);
      } catch (err) {
        toast.error("Failed to setup guild");
      }
    };

    const toggleModule = async (
      guildId: string,
      moduleId: string,
      isEnabled: boolean,
    ) => {
      try {
        const guild = guilds.find((g) => g.id === guildId);
        if (!guild) return;

        const newModules = isEnabled
          ? [...guild.enabled_modules, moduleId]
          : guild.enabled_modules.filter((m) => m !== moduleId);

        const API_BASE =
          import.meta.env.VITE_API_URL || "http://localhost:3001";
        const res = await fetch(
          `${API_BASE}/api/admin/guilds/${guildId}/modules`,
          {
            method: "PATCH",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${sessionToken}`,
            },
            body: JSON.stringify({ modules: newModules }),
          },
        );

        if (!res.ok) throw new Error("Failed to update modules");
        toast.success(`Modules updated for ${guild.name}`);
        await fetchGuildData(true);
      } catch (err) {
        toast.error("Failed to update guild modules");
      }
    };

    if (loading)
      return (
        <LoadingScreen
          fullScreen={false}
          subMessage="Loading Bot Infrastructure"
        />
      );

    return (
      <div className="space-y-8 animate-in fade-in slide-in-from-bottom-2 duration-500 pb-12">
        {/* Global Actions */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Card className="border-border/50 bg-card/50 backdrop-blur-sm shadow-xl hover:shadow-2xl transition-all">
            <CardHeader>
              <div className="flex items-center gap-3 mb-2">
                <div className="p-2 rounded-lg bg-primary/10">
                  <Database className="w-5 h-5 text-primary" />
                </div>
                <CardTitle className="text-xl font-bold tracking-tight">
                  Database Backup
                </CardTitle>
              </div>
              <CardDescription>
                Generate a point-in-time snapshot of the SQLite database and
                deliver it via encrypted Discord DM.
              </CardDescription>
            </CardHeader>
            <CardFooter>
              <Button
                onClick={handleBackup}
                disabled={triggeringBackup}
                className="w-full font-bold h-11"
              >
                {triggeringBackup ? "GENERATING..." : "GENERATE FULL BACKUP"}
              </Button>
            </CardFooter>
          </Card>

          <Card className="border-border/50 bg-card/50 backdrop-blur-sm shadow-xl hover:shadow-2xl transition-all">
            <CardHeader>
              <div className="flex items-center gap-3 mb-2">
                <div className="p-2 rounded-lg bg-orange-500/10">
                  <Zap className="w-5 h-5 text-orange-500" />
                </div>
                <CardTitle className="text-xl font-bold tracking-tight">
                  Deploy Commands
                </CardTitle>
              </div>
              <CardDescription>
                Force-refresh slash command registrations across all active
                guilds. Use after adding new modules or fixing command
                definitions.
              </CardDescription>
            </CardHeader>
            <CardFooter>
              <Button
                onClick={handleDeploy}
                disabled={deploying}
                variant="outline"
                className="w-full font-bold h-11 border-orange-500/30 hover:bg-orange-500/10 hover:text-orange-400"
              >
                {deploying ? "DEPLOYING..." : "DEPLOY COMMANDS"}
              </Button>
            </CardFooter>
          </Card>
        </div>

        {/* Guild Management */}
        <div className="space-y-4 pt-4">
          <div className="flex justify-between items-center px-2">
            <div className="flex items-center gap-3">
              <h2 className="text-2xl font-black tracking-tight uppercase italic text-foreground/90">
                Managed Guilds
              </h2>
              <Badge variant="outline" className="font-mono bg-background/50">
                {guilds.length}
              </Badge>
            </div>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  className="gap-2 font-bold px-4 hover:bg-primary/10 hover:text-primary transition-colors"
                >
                  <Plus className="w-4 h-4" />
                  Initialize Guild
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-60 shadow-2xl bg-card border-border/50">
                <DropdownMenuLabel>Discoverable Guilds</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {unconfiguredGuilds.length > 0 ? (
                  unconfiguredGuilds.map((g) => (
                    <DropdownMenuItem
                      key={g.id}
                      onClick={() => handleSetupGuild(g.id)}
                      className="cursor-pointer font-bold"
                    >
                      {g.name}
                    </DropdownMenuItem>
                  ))
                ) : (
                  <div className="px-2 py-4 text-xs text-muted-foreground italic text-center">
                    No new guilds found
                  </div>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {guilds.map((guild) => (
              <Card
                key={guild.id}
                className="border-border/40 bg-card/30 hover:bg-card/50 transition-colors"
              >
                <CardHeader className="flex flex-row items-center gap-4 space-y-0 pb-4">
                  <div className="w-12 h-12 rounded-xl bg-muted/50 flex items-center justify-center overflow-hidden border border-border/20">
                    {guild.icon ? (
                      <img
                        src={guild.icon}
                        alt={guild.name}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <Shield className="w-6 h-6 text-muted-foreground opacity-50" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <CardTitle className="text-lg font-bold truncate tracking-tight">
                      {guild.name}
                    </CardTitle>
                    <CardDescription className="font-mono text-[10px] uppercase opacity-70 flex items-center gap-2">
                      {guild.id}
                      <Badge
                        variant="secondary"
                        className="text-[10px] px-1.5 py-0 h-4"
                      >
                        Initialized{" "}
                        {new Date(guild.initialized_at).toLocaleDateString()}
                      </Badge>
                    </CardDescription>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setTeardownId(guild.id)}
                    className="text-destructive hover:bg-destructive/10 hover:text-destructive shrink-0"
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-3">
                    <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">
                      Enabled Modules
                    </Label>
                    <div className="grid grid-cols-2 gap-2">
                      {[
                        "verify",
                        "territories",
                        "reaction_roles",
                        "revive",
                        "assist",
                        "mercenary",
                      ].map((modId) => (
                        <div
                          key={modId}
                          className="flex items-center space-x-2 bg-background/50 p-2 rounded-lg border border-border/50"
                        >
                          <Checkbox
                            id={`${guild.id}-${modId}`}
                            checked={guild.enabled_modules.includes(modId)}
                            onCheckedChange={(c) =>
                              toggleModule(guild.id, modId, !!c)
                            }
                          />
                          <Label
                            htmlFor={`${guild.id}-${modId}`}
                            className="text-xs font-bold capitalize cursor-pointer flex-1"
                          >
                            {modId.replace(/_/g, " ")}
                          </Label>
                        </div>
                      ))}
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>

        <AlertDialog
          open={!!teardownId}
          onOpenChange={(o) => !o && setTeardownId(null)}
        >
          <AlertDialogContent className="bg-card/95 border-border shadow-2xl backdrop-blur-xl">
            <AlertDialogHeader>
              <AlertDialogTitle className="text-xl font-bold">
                Teardown Guild Config?
              </AlertDialogTitle>
              <AlertDialogDescription>
                This will remove all configuration data for this guild from the
                database. The bot will no longer function in this guild until
                initialized again.
                <strong> This action is irreversible.</strong>
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter className="mt-4">
              <AlertDialogCancel>Keep it</AlertDialogCancel>
              <AlertDialogAction
                onClick={handleTeardown}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90 font-bold"
              >
                Confirm Teardown
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    );
  },
);
BotManagementConfig.displayName = "BotManagementConfig";
