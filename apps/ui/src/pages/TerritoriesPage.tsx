import { useEffect, useState, useMemo } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Map as MapIcon, ArrowLeft, Lock, LogOut } from "lucide-react";
import { LoadingScreen } from "@/components/loading-screen";
import { ModeToggle } from "@/components/mode-toggle";
import { TerritoriesConfig } from "@/components/config/TerritoriesConfig";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

export default function TerritoriesPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [hasSession, setHasSession] = useState<boolean | null>(null);
  const [guildConfig, setGuildConfig] = useState<any>(null);
  const [isLoggedOut, setIsLoggedOut] = useState(false);

  const sessionToken = useMemo(() => {
    return (
      searchParams.get("session") || localStorage.getItem("sentinel_session")
    );
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
      // Ensure we navigate after updating localStorage to trigger re-renders if necessary
      // and clean the URL of the sensitive token.
      navigate("/territories", { replace: true });
      return;
    }

    const fetchData = async () => {
      try {
        const API_BASE =
          import.meta.env.VITE_API_URL || "http://localhost:3001";
        const userRes = await fetch(`${API_BASE}/api/auth/me`, {
          headers: { Authorization: `Bearer ${sessionToken}` },
        });

        if (!userRes.ok) {
          localStorage.removeItem("sentinel_session");
          setHasSession(false);
          return;
        }

        const userData = await userRes.json();
        setUser(userData);

        const channelsRes = await fetch(`${API_BASE}/api/map/channels`, {
          headers: { Authorization: `Bearer ${sessionToken}` },
        });

        if (channelsRes.ok) {
          const channelsData = await channelsRes.json();
          setGuildConfig({ channels: channelsData });
        }
      } catch (err) {
        console.error("Failed to fetch Map Vault data:", err);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [sessionToken, navigate, searchParams]);

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
              Sentinel uses secure, burn-on-read access links. Please generate a
              new link from Discord using the{" "}
              <code className="bg-secondary px-2 py-0.5 rounded-md text-primary font-mono text-sm">
                /tt-selector
              </code>{" "}
              command.
            </p>
          </div>
          <div className="pt-4">
            <Button
              variant="outline"
              className="w-full h-12 rounded-xl group transition-all cursor-pointer"
              onClick={() => window.location.reload()}
            >
              <ArrowLeft className="w-4 h-4 mr-2 group-hover:-translate-x-1 transition-transform" />
              Try Again
            </Button>
          </div>
        </div>
      </div>
    );
  }

  const handleSignOut = async () => {
    try {
      const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:3001";
      await fetch(`${API_BASE}/api/auth/sign-out`, {
        method: "POST",
        headers: { Authorization: `Bearer ${sessionToken}` },
      });
    } catch (err) {
      console.error("Sign out request failed:", err);
    }

    localStorage.removeItem("sentinel_session");
    setIsLoggedOut(true);

    // Attempt to close the tab
    setTimeout(() => {
      window.close();
    }, 500);
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
              Your command session has been securely closed and the access token
              has been burned.
            </p>
          </div>
          <div className="pt-4">
            <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/40">
              You can safely close this tactical window.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="h-20 flex items-center justify-between px-8 border-b border-border/50 sticky top-0 z-50 bg-background/80 backdrop-blur-md">
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-3">
            <Avatar className="w-10 h-10 border border-primary/20 bg-primary/10">
              <AvatarImage src="/logo.png" />
              <AvatarFallback>S</AvatarFallback>
            </Avatar>
            <div className="hidden sm:block">
              <h2 className="text-sm font-bold tracking-tight uppercase leading-none text-foreground">
                Sentinel
              </h2>
              <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mt-1">
                Map Vault
              </p>
            </div>
          </div>
          <div className="h-6 w-px bg-border/50" />
          <nav className="flex items-center gap-2">
            <div className="flex items-center gap-2 px-4 py-2 bg-secondary/50 rounded-xl border border-border/50">
              <MapIcon className="w-4 h-4 text-primary" />
              <span className="text-xs font-black uppercase tracking-widest text-foreground">
                Dashboard
              </span>
            </div>
          </nav>
        </div>

        <div className="flex items-center gap-4">
          <ModeToggle />
          <div className="h-6 w-px bg-border/50" />
          <div className="flex items-center gap-3 pl-2">
            <div className="text-right hidden sm:block">
              <p className="text-xs font-black uppercase tracking-tight text-foreground">
                {user?.username || "Authorized"}
              </p>
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Avatar className="w-9 h-9 border border-primary/20 cursor-pointer hover:ring-2 hover:ring-primary/20 transition-all">
                  <AvatarImage
                    src={`https://cdn.discordapp.com/avatars/${user?.id}/${user?.avatar}.png`}
                  />
                  <AvatarFallback className="text-foreground">
                    {user?.username?.substring(0, 2).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="end"
                className="w-56 rounded-2xl border-border/50 p-2 shadow-2xl backdrop-blur-xl mt-2"
              >
                <div className="px-3 py-2 border-b border-border/50 mb-2">
                  <p className="text-xs font-black uppercase text-foreground">
                    {user?.username}
                  </p>
                  <p className="text-[10px] text-muted-foreground truncate">
                    {user?.id}
                  </p>
                </div>
                <DropdownMenuItem
                  onClick={handleSignOut}
                  className="rounded-xl p-3 focus:bg-destructive/10 text-destructive focus:text-destructive cursor-pointer"
                >
                  <LogOut className="w-4 h-4 mr-3" />
                  Sign Out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </header>

      <main className="flex-1 p-8 lg:p-12 bg-[radial-gradient(circle_at_bottom_left,var(--primary-foreground),transparent_40%)]">
        <div className="max-w-7xl mx-auto space-y-12">
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <div className="h-px w-8 bg-primary/30" />
                <span className="text-[10px] font-black uppercase tracking-[0.4em] text-primary/70">
                  Strategic Assets
                </span>
              </div>
              <h1 className="text-5xl lg:text-6xl font-black tracking-tighter text-foreground uppercase">
                Map <span className="text-primary italic">Vault</span>
              </h1>
            </div>
          </div>

          <TerritoriesConfig
            sessionToken={sessionToken!}
            channels={guildConfig?.channels || []}
            currentUserId={user?.id}
          />
        </div>
      </main>

      <footer className="py-8 px-8 border-t border-border/10 bg-secondary/5 text-foreground flex items-ccenter justify-center">
        <span className="text-xs font-bold uppercase tracking-widest">
          Sentinel &copy; 2026
        </span>
      </footer>
    </div>
  );
}

// Re-using common components for simplicity
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
