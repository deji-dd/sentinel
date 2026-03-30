import { useEffect, useState, useMemo, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarFooter,
  SidebarTrigger,
  SidebarInset
} from "@/components/ui/sidebar";
import { LoadingScreen, TacticalLoader } from "@/components/loading-screen";
import {
  Shield,
  Settings,
  Sparkles,
  ArrowLeft,
  Lock,
  HeartPulse,
  Crosshair,
  UserCircle,
  LogOut,
  AlertCircle,
  Save,
  MapPin
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ModeToggle } from "@/components/mode-toggle";
import { AdminConfig } from "@/components/config/AdminConfig";
import { VerificationConfig } from "@/components/config/VerificationConfig";
import { TerritoryNotificationsConfig } from "@/components/config/TerritoryNotificationsConfig";
import { ReactionRolesConfig } from "@/components/config/ReactionRolesConfig";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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

import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@/components/ui/avatar";

type ModuleId = "admin" | "verify" | "reaction_roles" | "revive" | "assist" | "territories";

export default function ConfigPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [hasSession, setHasSession] = useState<boolean | null>(null);
  const [activeTab, setActiveTab] = useState<ModuleId>(
    (searchParams.get("tab") as ModuleId) || "admin"
  );
  const [guildConfig, setGuildConfig] = useState<any>(null);
  const [isDirty, setIsDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const moduleRef = useRef<any>(null);
  const [pendingTab, setPendingTab] = useState<ModuleId | "logout" | null>(null);

  const sessionToken = useMemo(() => {
    return searchParams.get("session") || localStorage.getItem("sentinel_session");
  }, [searchParams]);

  useEffect(() => {
    if (!sessionToken) {
      setHasSession(false);
      setLoading(false);
      return;
    }

    setHasSession(true);

    if (searchParams.get("session")) {
      localStorage.setItem("sentinel_session", sessionToken);
      // Use react-router navigate instead of window.history.replaceState to ensure state consistency
      navigate(".", { replace: true });
      return; // dependencies will catch the change
    }

    const fetchData = async () => {
      try {
        const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:3001";
        const [userRes, configRes] = await Promise.all([
          fetch(`${API_BASE}/api/auth/me`, {
            headers: { Authorization: `Bearer ${sessionToken}` }
          }),
          fetch(`${API_BASE}/api/config`, {
            headers: { Authorization: `Bearer ${sessionToken}` }
          })
        ]);

        if (!userRes.ok) throw new Error("Session invalid");
        const userData = await userRes.json();
        setUser(userData);

        if (!configRes.ok) {
          // If config fetch fails, it's likely a scope mismatch or session expiry
          throw new Error("Configuration access denied");
        }

        const configData = await configRes.json();
        setGuildConfig(configData);
      } catch (err) {
        console.error("[ConfigPage] Auth/Config fetch failed:", err);
        localStorage.removeItem("sentinel_session");
        setHasSession(false);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [sessionToken, searchParams, navigate]);

  const hasApiKeys = useMemo(() => (guildConfig?.api_keys?.length || 0) > 0, [guildConfig]);

  const modules = useMemo(() => [
    {
      id: "admin" as const,
      name: "Admin Config",
      icon: Settings,
      desc: "Manage API keys, log channels, and admin roles.",
      category: "System",
      isEnabled: true,
      requiresKeys: false
    },
    {
      id: "verify" as const,
      name: "Verification",
      icon: Shield,
      desc: "Automated role assignment and nickname syncing.",
      category: "Modules",
      isEnabled: guildConfig?.enabled_modules?.includes("verify"),
      requiresKeys: true
    },
    {
      id: "reaction_roles" as const,
      name: "Reaction Roles",
      icon: Sparkles,
      desc: "Assign roles based on message reactions.",
      category: "Modules",
      isEnabled: guildConfig?.enabled_modules?.includes("reaction_roles"),
      requiresKeys: false
    },
    {
      id: "revive" as const,
      name: "Revives",
      icon: HeartPulse,
      desc: "Request and track faction revives.",
      category: "Modules",
      isEnabled: guildConfig?.enabled_modules?.includes("revive"),
      requiresKeys: true
    },
    {
      id: "assist" as const,
      name: "Assist",
      icon: Crosshair,
      desc: "Browser-based tools for faction operations.",
      category: "Modules",
      isEnabled: guildConfig?.enabled_modules?.includes("assist"),
      requiresKeys: true
    },
    {
      id: "territories" as const,
      name: "Territories",
      icon: MapPin,
      desc: "Territory and faction movement alerts.",
      category: "Modules",
      isEnabled: guildConfig?.enabled_modules?.includes("territories") || true,
    }
  ], [guildConfig]);

  const handleGlobalSave = async () => {
    if (!moduleRef.current?.save) return;
    setSaving(true);
    const success = await moduleRef.current.save();
    if (success) setIsDirty(false);
    setSaving(false);
  };

  const [isLoggedOut, setIsLoggedOut] = useState(false);

  const performLogout = async () => {
    try {
      const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:3001";
      await fetch(`${API_BASE}/api/auth/sign-out`, {
        method: "POST",
        headers: { Authorization: `Bearer ${sessionToken}` }
      });
    } catch (err) {
      console.error("Sign out failed:", err);
    }
    localStorage.removeItem("sentinel_session");
    setIsLoggedOut(true);
    setTimeout(() => {
      window.close();
    }, 500);
  };

  const confirmNavigate = () => {
    if (pendingTab === "logout") {
      performLogout();
    } else if (pendingTab) {
      setActiveTab(pendingTab);
      setIsDirty(false);
    }
    setPendingTab(null);
  };

  const handleTabSwitch = (id: ModuleId) => {
    if (isDirty) {
      setPendingTab(id);
    } else {
      setActiveTab(id);
    }
  };

  const handleSignOut = () => {
    if (isDirty) {
      setPendingTab("logout");
    } else {
      performLogout();
    }
  };

  if (isLoggedOut) {
    return (
      <div className="min-h-screen bg-background text-foreground flex flex-col items-center justify-center p-6 bg-[radial-gradient(ellipse_at_top,var(--tw-gradient-stops))] from-primary/10 via-background to-background relative overflow-hidden">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full h-full bg-[url('/grid.svg')] bg-center mask-[linear-gradient(180deg,white,rgba(255,255,255,0))] opacity-10 pointer-events-none" />
        <div className="max-w-md w-full text-center space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-1000 relative z-10">
          <div className="flex justify-center">
            <div className="w-24 h-24 bg-primary/10 border border-primary/20 rounded-3xl flex items-center justify-center shadow-2xl shadow-primary/20 p-5">
              <LogOut className="w-full h-full text-primary" />
            </div>
          </div>
          <div className="space-y-4">
            <h1 className="text-4xl font-black tracking-tighter text-foreground uppercase">
              SESSION TERMINATED
            </h1>
            <p className="text-muted-foreground text-lg leading-relaxed">
              Your command session has been securely closed and the access token has been burned.
            </p>
          </div>
          <div className="pt-4">
            <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/40">You can safely close this tactical window.</p>
          </div>
        </div>
      </div>
    );
  }

  if (loading)
    return <LoadingScreen />;

  if (hasSession === false) {
    return (
      <div className="min-h-screen bg-background text-foreground flex flex-col items-center justify-center p-6 bg-[radial-gradient(ellipse_at_top,var(--tw-gradient-stops))] from-primary/10 via-background to-background relative overflow-hidden">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full h-full bg-[url('/grid.svg')] bg-center mask-[linear-gradient(180deg,white,rgba(255,255,255,0))] opacity-10 pointer-events-none" />
        <div className="max-w-md w-full text-center space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-1000 relative z-10">
          <div className="flex justify-center">
            <div className="w-24 h-24 bg-destructive/10 border border-destructive/20 rounded-3xl flex items-center justify-center shadow-2xl shadow-destructive/20 p-5 group transition-transform duration-500">
              <Lock className="w-full h-full text-destructive" />
            </div>
          </div>
          <div className="space-y-4">
            <h1 className="text-4xl font-black tracking-tighter bg-clip-text text-transparent bg-linear-to-b from-foreground to-muted-foreground/50">
              ACCESS DENIED
            </h1>
            <p className="text-muted-foreground text-lg leading-relaxed">
              Sentinel uses secure, burn-on-read access links.
              Please generate a new link from Discord using the <code className="bg-secondary px-2 py-0.5 rounded-md text-primary font-mono text-sm">/config</code> command.
            </p>
          </div>
          <div className="pt-4">
            <Button variant="outline" className="w-full h-12 rounded-xl group transition-all cursor-pointer" onClick={() => window.location.reload()}>
              <ArrowLeft className="w-4 h-4 mr-2 group-hover:-translate-x-1 transition-transform" />
              Try Again
            </Button>
          </div>
        </div>
      </div>
    );
  }

  const activeModule = modules.find(m => m.id === activeTab);

  return (
    <SidebarProvider>
      <Sidebar variant="inset">
        <SidebarHeader className="border-b border-border/50 pb-3">
          <div className="flex items-center gap-3">
            <Avatar>
              <AvatarImage src="/logo.png" />
              <AvatarFallback>S</AvatarFallback>
            </Avatar>
            <div>
              <h2 className="text-sm font-bold tracking-tight uppercase leading-none text-foreground">Sentinel</h2>
            </div>
          </div>
        </SidebarHeader>

        <SidebarContent>
          {["System", "Modules"].map((cat) => (
            <SidebarGroup key={cat}>
              <SidebarGroupLabel className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground/50">
                {cat}
              </SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {modules.filter(m => m.category === cat).map((m) => {
                    const isLocked = m.requiresKeys && !hasApiKeys;
                    const isDisabled = !m.isEnabled || isLocked;

                    return (
                      <SidebarMenuItem key={m.id}>
                        <SidebarMenuButton
                          disabled={isDisabled}
                          onClick={() => handleTabSwitch(m.id)}
                          isActive={activeTab === m.id}
                          className="h-10"
                        >
                          <m.icon className={cn("w-4 h-4", activeTab === m.id ? "text-primary" : "text-muted-foreground")} />
                          <span className="font-semibold text-sm text-foreground/80">{m.name}</span>
                          {isLocked && (
                            <Lock className="ml-auto w-3 h-3 text-destructive/50" />
                          )}
                          {!m.isEnabled && !isLocked && (
                            <Badge variant="outline" className="ml-auto text-[8px] h-3 px-1 opacity-50">OFF</Badge>
                          )}
                        </SidebarMenuButton>
                      </SidebarMenuItem>)
                  })}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          ))}
        </SidebarContent>

        <SidebarFooter className="border-t border-border/50">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3 min-w-0">
              <Avatar>
                <AvatarImage src={`https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png`} />
                <AvatarFallback className="bg-primary/5 rounded-lg flex items-center justify-center">
                  <UserCircle className="w-4 h-4 opacity-40 text-foreground" />
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0">
                <p className="text-xs font-bold truncate text-foreground leading-none">{user?.global_name || user?.username}</p>
              </div>
            </div>
            <ModeToggle />
          </div>
          <Button
            variant="ghost"
            className="text-muted-foreground hover:text-destructive hover:bg-destructive/5 transition-colors"
            onClick={handleSignOut}
          >
            <LogOut className="w-3 h-3 mr-2" />
            Sign Out
          </Button>
        </SidebarFooter>
      </Sidebar>

      <SidebarInset className="h-screen overflow-hidden flex flex-col">

        <header className="h-16 flex items-center rounded-t-xl justify-between px-8 border-b border-border/50 shrink-0 z-20 bg-background/50 backdrop-blur-md">
          <div className="flex items-center gap-4">
            <SidebarTrigger className="cursor-pointer text-primary" />
            <div className="space-y-0.5">
              <div className="flex items-center gap-2 text-[9px] font-bold uppercase tracking-[0.25em] text-primary/70">
                <Sparkles className="w-3 h-3" />
                Live Command Center
              </div>
              <h1 className="text-xl font-black tracking-tight flex items-center gap-2 text-foreground">
                {activeModule?.name}
              </h1>
            </div>
          </div>
          <Badge variant="secondary">
            {guildConfig?.guild_name || "LOADING..."}
          </Badge>
        </header>

        <div className="flex-1 overflow-y-auto z-10">
          <div className="max-w-5xl mx-auto px-8 py-10">

            {!hasApiKeys && activeTab !== "admin" && (
              <div className="p-8 rounded-4xl bg-destructive/5 border border-destructive/20 flex flex-col items-center text-center space-y-4 mb-8 max-w-2xl mx-auto animate-in zoom-in-95 duration-500">
                <div className="w-16 h-16 rounded-2xl bg-destructive/10 flex items-center justify-center">
                  <AlertCircle className="w-8 h-8 text-destructive" />
                </div>
                <div className="space-y-2">
                  <h3 className="text-xl font-black uppercase tracking-tight text-foreground">API KEY MISSING</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    The current module <span className="text-destructive font-bold uppercase">{activeModule?.name}</span> requires an active Torn API key to function.
                    Please add a key in the <strong>Admin Config</strong> section to unlock this feature.
                  </p>
                </div>
                <Button onClick={() => setActiveTab("admin")} variant="destructive" className="rounded-xl px-8 font-bold cursor-pointer transition-transform hover:scale-105 active:scale-95">
                  GOTO ADMIN CONFIG
                </Button>
              </div>
            )}

            {activeTab === "admin" && (
              <AdminConfig
                ref={moduleRef}
                sessionToken={sessionToken!}
                onConfigUpdate={setGuildConfig}
                onDirtyChange={setIsDirty}
              />
            )}


            {activeTab === "verify" && (
              <VerificationConfig
                ref={moduleRef}
                sessionToken={sessionToken!}
                onConfigUpdate={setGuildConfig}
                onDirtyChange={setIsDirty}
              />
            )}

            {activeTab === "territories" && (
              <TerritoryNotificationsConfig
                ref={moduleRef}
                sessionToken={sessionToken!}
                initialData={guildConfig}
                onConfigUpdate={setGuildConfig}
                onDirtyChange={setIsDirty}
              />
            )}



            {activeTab === "reaction_roles" && (
              <ReactionRolesConfig
                sessionToken={sessionToken!}
                availableChannels={guildConfig?.channels || []}
                availableRoles={guildConfig?.roles || []}
              />
            )}

            {(activeTab !== "admin" && activeTab !== "verify" && activeTab !== "territories" && activeTab !== "reaction_roles" && hasApiKeys) && (
              <div className="py-24 flex flex-col items-center justify-center text-center space-y-6 animate-in zoom-in-95 duration-500 opacity-60">
                <div className="w-20 h-20 rounded-full bg-secondary flex items-center justify-center">
                  {activeModule && <activeModule.icon className="w-10 h-10 text-muted-foreground opacity-20" />}
                </div>
                <div className="space-y-2">
                  <h3 className="text-xl font-bold uppercase tracking-tight text-foreground">Module Under Construction</h3>
                  <p className="text-muted-foreground max-w-sm mx-auto text-sm leading-relaxed">
                    The configuration interface for <span className="text-primary font-black uppercase">{activeModule?.name}</span> is being migrated to the new design system.
                  </p>
                </div>
                <Button variant="secondary" onClick={() => setActiveTab("admin")} className="rounded-xl font-bold px-6 cursor-pointer">
                  Return to Admin Config
                </Button>
              </div>
            )}

          </div>
        </div>

        {/* Global Unsaved Changes Banner */}
        {isDirty && (
          <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 animate-in slide-in-from-bottom-8 duration-500 w-full max-w-xl px-6">
            <div className="bg-popover border border-border p-3 pl-6 pr-3 rounded-2xl shadow-2xl flex items-center justify-between gap-8 backdrop-blur-xl">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-yellow-500/20 flex items-center justify-center animate-pulse">
                  <AlertCircle className="w-4 h-4 text-yellow-500" />
                </div>
                <p className="text-sm font-bold text-foreground/80 tracking-tight">UNSAVED CHANGES</p>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    window.location.reload();
                  }}
                  className="text-primary"
                >
                  Discard
                </Button>
                <Button
                  onClick={handleGlobalSave}
                  disabled={saving}
                >
                  {saving ? (
                    <TacticalLoader
                      size="14"
                      stroke="3"
                      className="mr-2"
                    />
                  ) : <Save className="w-3 h-3 mr-2" />}
                  {saving ? "SAVING..." : "SAVE CHANGES"}
                </Button>
              </div>
            </div>
          </div>
        )}
      </SidebarInset>

      <AlertDialog open={pendingTab !== null} onOpenChange={(open) => !open && setPendingTab(null)}>
        <AlertDialogContent className="rounded-4xl border-border bg-background/95 backdrop-blur-xl">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-xl font-black uppercase tracking-tight text-foreground">Discard Changes?</AlertDialogTitle>
            <AlertDialogDescription className="text-muted-foreground font-medium">
              You have unsaved configuration changes. Switching sections or signing out will permanently discard them.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Stay Here</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmNavigate}
              variant={"destructive"}
            >
              Discard & Proceed
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SidebarProvider>
  );
}
