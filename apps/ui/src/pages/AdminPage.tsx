import { useEffect, useState, useMemo } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { LoadingScreen } from "@/components/loading-screen";
import {
  Shield,
  LogOut,
  Zap,
} from "lucide-react";
import { ModeToggle } from "@/components/mode-toggle";
import { BotManagementConfig } from "@/components/config/BotManagementConfig";
import { Button } from "@/components/ui/button";
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
  SidebarInset,
  SidebarTrigger
} from "@/components/ui/sidebar";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@/components/ui/avatar";

export default function AdminPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [hasSession, setHasSession] = useState<boolean | null>(null);

  // Derive session token directly from search params or localStorage
  const sessionToken = useMemo(() => {
    return searchParams.get("session") || localStorage.getItem("sentinel_session");
  }, [searchParams]);

  useEffect(() => {
    const tokenInParams = searchParams.get("session");

    // Phase 1: If session is in URL, persist it and redirect to clean URL
    if (tokenInParams) {
      console.log("[AdminPage] Token found in URL, persisting...");
      localStorage.setItem("sentinel_session", tokenInParams);
      navigate("/admin", { replace: true });
      return;
    }

    // Phase 2: No session in URL, check localStorage
    const savedToken = localStorage.getItem("sentinel_session");
    if (!savedToken) {
      console.log("[AdminPage] No session found in localStorage");
      setHasSession(false);
      setLoading(false);
      return;
    }

    // Phase 3: Validate session and fetch user info
    const validateAndFetch = async () => {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000); // 10s timeout
      
      const API_BASE = import.meta.env.VITE_API_URL || "http://127.0.0.1:3001";
      const FETCH_URL = `${API_BASE}/api/auth/me`;
      
      console.log(`[AdminPage] Fetching auth from: ${FETCH_URL}`);
      setHasSession(true);

      try {
        const userRes = await fetch(FETCH_URL, {
          headers: { Authorization: `Bearer ${savedToken}` },
          signal: controller.signal
        });
        clearTimeout(timeoutId);

        if (!userRes.ok) {
          console.error("[AdminPage] Auth check failed:", userRes.status);
          localStorage.removeItem("sentinel_session");
          setHasSession(false);
          return;
        }

        const userData = await userRes.json();
        console.log("[AdminPage] User authenticated:", userData.tag || userData.username);
        setUser(userData);

        if (!userData.is_owner) {
          console.error("[AdminPage] Access denied: User is not owner");
          navigate("/error?msg=Unauthorized: Bot owner only");
          return;
        }
      } catch (error: any) {
        if (error.name === 'AbortError') {
          console.error("[AdminPage] Auth request timed out after 10s");
        } else {
          console.error("[AdminPage] Fetch error:", error);
        }
        setHasSession(false);
      } finally {
        setLoading(false);
      }
    };

    validateAndFetch();
  }, [searchParams, navigate]);

  // Effect to handle navigation for invalid sessions to avoid "update while rendering" errors
  useEffect(() => {
    if (hasSession === false && !loading) {
      navigate("/error?msg=Session expired or invalid");
    }
  }, [hasSession, loading, navigate]);

  const handleLogout = () => {
    localStorage.removeItem("sentinel_session");
    navigate("/");
  };

  if (loading) return <LoadingScreen subMessage="Authenticating Manager..." />;

  if (hasSession === false) return null; // Handled by useEffect redirect

  return (
    <SidebarProvider>
      <div className="flex h-screen w-full bg-background overflow-hidden selection:bg-primary/30">
        <Sidebar className="border-r border-border/50 bg-card/30 backdrop-blur-xl">
          <SidebarHeader className="border-b border-border/50 px-6 py-5">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 ring-1 ring-primary/20 shadow-lg shadow-primary/10">
                <Shield className="h-6 w-6 text-primary" />
              </div>
              <div>
                <h1 className="text-lg font-bold font-orbitron leading-none tracking-tight">Sentinel</h1>
                <p className="text-[10px] font-medium uppercase tracking-[0.2em] text-muted-foreground/60">Bot Admin Panel</p>
              </div>
            </div>
          </SidebarHeader>

          <SidebarContent className="px-3 pt-6">
            <SidebarGroup>
              <SidebarGroupLabel className="px-3 text-[10px] font-black uppercase tracking-[0.3em] text-muted-foreground/40 mb-2">
                Core Systems
              </SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  <SidebarMenuItem>
                    <SidebarMenuButton
                      isActive={true}
                      className="h-11 px-4 transition-all duration-300 hover:bg-primary/10 hover:text-primary rounded-xl group"
                    >
                      <Zap className="mr-3 h-4 w-4 group-hover:scale-110 transition-transform text-primary" />
                      <span className="font-bold tracking-wide text-foreground/80">Global Control</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          </SidebarContent>

          <SidebarFooter className="border-t border-border/50 p-6 bg-background/20">
            <div className="flex items-center gap-3 px-1 mb-6">
              <Avatar className="h-10 w-10 border-2 border-primary/20 p-0.5 shadow-xl">
                <AvatarImage src={user?.avatar_url} />
                <AvatarFallback className="bg-primary/10 text-primary font-bold">
                  {user?.tag?.charAt(0).toUpperCase() || "A"}
                </AvatarFallback>
              </Avatar>
              <div className="flex flex-col min-w-0">
                <span className="truncate text-sm font-black tracking-tight">{user?.tag || user?.username}</span>
                <span className="truncate text-[10px] font-bold uppercase tracking-widest text-primary/70">Master User</span>
              </div>
            </div>
            <div className="flex items-center justify-between gap-2">
              <ModeToggle />
              <Button
                variant="ghost"
                size="icon"
                onClick={handleLogout}
                className="rounded-lg h-10 w-10 hover:bg-red-500/10 hover:text-red-500 transition-all active:scale-90"
              >
                <LogOut className="h-4 w-4" />
              </Button>
            </div>
          </SidebarFooter>
        </Sidebar>

        <SidebarInset className="flex-1 flex flex-col min-w-0 bg-[radial-gradient(ellipse_at_top,var(--tw-gradient-stops))] from-primary/5 via-background to-background">
          <header className="flex h-16 shrink-0 items-center justify-between border-b border-border/50 px-8 backdrop-blur-md sticky top-0 z-30">
            <div className="flex items-center gap-4">
              <SidebarTrigger className="h-9 w-9 text-primary hover:bg-primary/10 rounded-lg transition-colors shadow-sm" />
              <div className="h-4 w-px bg-border/50" />
              <h2 className="text-sm font-orbitron font-medium tracking-[0.2em] text-muted-foreground uppercase flex items-center gap-2">
                System Administration
              </h2>
            </div>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-primary/10 border border-primary/20">
                <span className="flex h-2 w-2 rounded-full bg-primary animate-pulse shadow-[0_0_8px_rgba(var(--primary),0.5)]" />
                <span className="text-[10px] font-black uppercase tracking-widest text-primary">Live Terminal</span>
              </div>
            </div>
          </header>

          <main className="flex-1 overflow-y-auto custom-scrollbar">
            <div className="mx-auto w-full max-w-6xl p-8 md:p-12">
              <div className="mb-12 space-y-3 animate-in fade-in slide-in-from-left-4 duration-700">
                <h1 className="text-4xl font-black font-orbitron tracking-tighter text-foreground sm:text-5xl lg:text-6xl bg-clip-text bg-linear-to-b from-foreground to-foreground/50">
                  Command Hub
                </h1>
                <p className="text-muted-foreground text-xl max-w-3xl leading-relaxed font-medium">
                  Centralized administration for deployment updates, database maintenance, and global server management.
                </p>
              </div>

              <div className="grid gap-8 animate-in fade-in zoom-in-95 duration-1000 delay-200">
                <BotManagementConfig sessionToken={sessionToken!} />
              </div>
            </div>
          </main>
        </SidebarInset>
      </div>
    </SidebarProvider>
  );
}
