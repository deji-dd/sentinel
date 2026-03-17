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
import {
  Shield,
  Map as MapIcon,
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
  Loader2
} from "lucide-react";
import { LoadingScreen } from "@/components/loading-screen";
import { cn } from "@/lib/utils";
import { ModeToggle } from "@/components/mode-toggle";
import { AdminConfig } from "@/components/config/AdminConfig";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
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

type ModuleId = "admin" | "verify" | "territories" | "reaction_roles" | "revive" | "assist";

export default function ConfigPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [hasSession, setHasSession] = useState<boolean | null>(null);
  const [activeTab, setActiveTab] = useState<ModuleId>("admin");
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

        if (configRes.ok) {
          const configData = await configRes.json();
          setGuildConfig(configData);
        }
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
      id: "territories" as const,
      name: "Territories",
      icon: MapIcon,
      desc: "Map settings and immersive painter interface.",
      category: "Modules",
      isEnabled: guildConfig?.enabled_modules?.includes("territories"),
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
    }
  ], [guildConfig]);

  const handleGlobalSave = async () => {
    if (!moduleRef.current?.save) return;
    setSaving(true);
    const success = await moduleRef.current.save();
    if (success) setIsDirty(false);
    setSaving(false);
  };

  const confirmNavigate = () => {
    if (pendingTab === "logout") {
      localStorage.removeItem("sentinel_session");
      window.location.reload();
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
      localStorage.removeItem("sentinel_session");
      window.location.reload();
    }
  };

  if (loading) return <LoadingScreen />;

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
      <div className="flex h-screen w-full overflow-hidden bg-background">
        <Sidebar variant="inset">
          <SidebarHeader className="h-16 flex px-6 border-b border-border/50">
            <div className="flex items-center gap-3">
              <Avatar className="border border-primary/20 bg-primary/10">
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
                <SidebarGroupLabel className="px-4 text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground/50 py-4">
                  {cat}
                </SidebarGroupLabel>
                <SidebarGroupContent>
                  <SidebarMenu className="px-2">
                    {modules.filter(m => m.category === cat).map((m) => {
                      const isLocked = m.requiresKeys && !hasApiKeys;
                      const isDisabled = !m.isEnabled || isLocked;

                      const button = (
                        <SidebarMenuButton
                          onClick={() => handleTabSwitch(m.id)}
                          isActive={activeTab === m.id}
                          className={cn(
                            "h-10 px-3 rounded-xl transition-all duration-200 cursor-pointer",
                            isDisabled && "opacity-40 grayscale pointer-events-none"
                          )}
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
                      );

                      if (isDisabled) return <SidebarMenuItem key={m.id}>{button}</SidebarMenuItem>;

                      return (
                        <SidebarMenuItem key={m.id}>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              {button}
                            </TooltipTrigger>
                            <TooltipContent side="right" className="border-none bg-muted text-muted-foreground font-bold text-[10px] uppercase tracking-widest px-3 py-2">
                              Manage {m.name}
                            </TooltipContent>
                          </Tooltip>
                        </SidebarMenuItem>
                      );
                    })}
                  </SidebarMenu>
                </SidebarGroupContent>
              </SidebarGroup>
            ))}
          </SidebarContent>

          <SidebarFooter className="p-4 border-t border-border/50 bg-secondary/5">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3 min-w-0">
                <Avatar className="w-8 h-8 rounded-lg border border-border/50 bg-background shadow-sm">
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
              className="w-full justify-start text-xs text-muted-foreground hover:text-destructive hover:bg-destructive/5 h-8 rounded-lg px-2 transition-colors cursor-pointer"
              onClick={handleSignOut}
            >
              <LogOut className="w-3 h-3 mr-2" />
              Sign Out
            </Button>
          </SidebarFooter>
        </Sidebar>

        <SidebarInset className="bg-background">
          <div className="absolute inset-0 bg-grid-white/[0.02] pointer-events-none" />

          <header className="h-16 flex items-center justify-between px-8 border-b border-border/50 shrink-0 z-20 bg-background/50 backdrop-blur-md">
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
            <div className="flex items-center gap-3">
              <Badge variant="secondary" className="bg-primary/5 text-primary border-primary/20 font-bold px-3 py-1 text-xs">
                {guildConfig?.guild_name || "LOADING..."}
              </Badge>
            </div>
          </header>

          <div className="flex-1 overflow-y-auto z-10 pb-20">
            <div className="max-w-5xl mx-auto px-8 py-10">

              {!hasApiKeys && activeTab !== "admin" && (
                <div className="p-8 rounded-[2rem] bg-destructive/5 border border-destructive/20 flex flex-col items-center text-center space-y-4 mb-8 max-w-2xl mx-auto animate-in zoom-in-95 duration-500">
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

              {activeTab === "territories" && hasApiKeys && (
                <div className="animate-in fade-in slide-in-from-bottom-4 duration-500 py-12">
                  <div className="max-w-2xl mx-auto p-12 rounded-[2.5rem] bg-card border border-border shadow-2xl relative overflow-hidden text-center space-y-8">
                    <div className="absolute top-0 left-0 w-full h-1 bg-linear-to-r from-primary via-purple-500 to-primary" />
                    <div className="w-24 h-24 bg-primary rounded-3xl flex items-center justify-center shadow-xl shadow-primary/20 mx-auto transform -rotate-3 transition-transform hover:rotate-0 duration-500">
                      <MapIcon className="w-12 h-12 text-primary-foreground" />
                    </div>
                    <div className="space-y-4">
                      <h3 className="text-3xl font-black uppercase tracking-tight text-foreground">Launch Map Painter</h3>
                      <p className="text-muted-foreground leading-relaxed text-lg">
                        Managing complex territory mappings is best done in our specialized painting interface.
                      </p>
                    </div>
                    <div className="flex flex-col sm:flex-row gap-4 justify-center pt-4">
                      <Button onClick={() => navigate("/selector")} size="lg" className="h-14 px-10 rounded-2xl font-black text-lg bg-primary shadow-xl shadow-primary/20 hover:scale-[1.02] active:scale-[0.98] transition-all cursor-pointer">
                        OPEN PAINTER
                      </Button>
                      <Button variant="ghost" onClick={() => setActiveTab("admin")} className="h-14 px-10 rounded-2xl font-bold text-foreground/60 hover:text-foreground cursor-pointer">
                        BACK TO CONFIG
                      </Button>
                    </div>
                  </div>
                </div>
              )}

              {(activeTab !== "admin" && activeTab !== "territories" && hasApiKeys) && (
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
                    className="rounded-xl font-bold text-xs uppercase cursor-pointer"
                  >
                    Discard
                  </Button>
                  <Button
                    onClick={handleGlobalSave}
                    disabled={saving}
                    className="rounded-xl bg-primary shadow-lg shadow-primary/20 font-black text-xs uppercase cursor-pointer"
                  >
                    {saving ? <Loader2 className="w-3 h-3 animate-spin mr-2" /> : <Save className="w-3 h-3 mr-2" />}
                    {saving ? "SAVING..." : "SAVE CHANGES"}
                  </Button>
                </div>
              </div>
            </div>
          )}
        </SidebarInset>

        <AlertDialog open={pendingTab !== null} onOpenChange={(open) => !open && setPendingTab(null)}>
          <AlertDialogContent className="rounded-[2rem] border-border bg-background/95 backdrop-blur-xl">
            <AlertDialogHeader>
              <AlertDialogTitle className="text-xl font-black uppercase tracking-tight text-foreground">Discard Changes?</AlertDialogTitle>
              <AlertDialogDescription className="text-muted-foreground font-medium">
                You have unsaved configuration changes. Switching sections or signing out will permanently discard them.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter className="gap-2 sm:gap-0">
              <AlertDialogCancel className="rounded-xl font-bold border-none hover:bg-secondary cursor-pointer">Stay Here</AlertDialogCancel>
              <AlertDialogAction
                onClick={confirmNavigate}
                className="rounded-xl bg-destructive text-destructive-foreground font-black uppercase tracking-wide hover:bg-destructive/90 cursor-pointer"
              >
                Discard & Proceed
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </SidebarProvider>
  );
}
