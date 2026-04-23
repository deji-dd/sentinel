import { useEffect, useState, useMemo, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { LoadingScreen } from "@/components/loading-screen";
import { LogOut, Sparkles, UserCircle, Zap } from "lucide-react";
import { ModeToggle } from "@/components/mode-toggle";
import { BotManagementConfig } from "@/components/config/BotManagementConfig";
import { performMasterLogout } from "@/lib/logout";
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
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

export default function AdminPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [hasSession, setHasSession] = useState<boolean | null>(null);
  const tokenPersistHandled = useRef(false);
  const authBootstrapStarted = useRef(false);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Derive session token directly from search params or localStorage
  const sessionToken = useMemo(() => {
    return (
      searchParams.get("session") || localStorage.getItem("sentinel_session")
    );
  }, [searchParams]);

  // Extract session param value for effect dependency
  const sessionParamValue = useMemo(
    () => searchParams.get("session"),
    [searchParams],
  );

  useEffect(() => {
    const tokenInParams = sessionParamValue;
    const savedToken = localStorage.getItem("sentinel_session");

    // Early exit: no token found anywhere
    if (!tokenInParams && !savedToken) {
      setHasSession(false);
      setLoading(false);
      return;
    }

    // Establish that we have a session (may be validating)
    setHasSession(true);

    // Phase 1: If session is in URL and not yet persisted, persist it and redirect
    if (tokenInParams && !tokenPersistHandled.current) {
      tokenPersistHandled.current = true;
      localStorage.setItem("sentinel_session", tokenInParams);
      setLoading(false); // Clear loading since we're redirecting
      navigate("/admin", { replace: true });
      return; // Return after Phase 1 since we're redirecting
    }

    // Phase 2: Validate token still exists before Phase 3
    const tokenForAuth = tokenInParams || savedToken;
    if (!tokenForAuth) {
      setHasSession(false);
      setLoading(false);
      return;
    }

    if (authBootstrapStarted.current) {
      setLoading(false); // Prevent endless loading if guard prevents execution
      return;
    }
    authBootstrapStarted.current = true;

    // Cancel any previous in-flight request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    // Phase 3: Validate session and fetch user info
    let isMounted = true;
    const validateAndFetch = async () => {
      const configuredBase = import.meta.env.VITE_API_URL;
      const apiBases = Array.from(
        new Set(
          [configuredBase, "http://127.0.0.1:3001", "http://localhost:3001"]
            .filter((base): base is string => Boolean(base))
            .map((base) => base.replace(/\/$/, "")),
        ),
      );

      if (!isMounted) {
        return;
      }

      setHasSession(true);

      try {
        let userRes: Response | null = null;
        let lastError: unknown = null;

        for (const base of apiBases) {
          if (!isMounted) {
            return;
          }

          const controller = new AbortController();
          abortControllerRef.current = controller;
          const timeoutId = setTimeout(() => {
            console.warn(`[AdminPage] Timeout for ${base}, aborting...`);
            controller.abort();
          }, 10000);
          const fetchUrl = `${base}/api/auth/me`;

          try {
            userRes = await fetch(fetchUrl, {
              headers: { Authorization: `Bearer ${savedToken}` },
              signal: controller.signal,
            });
            clearTimeout(timeoutId);
            break;
          } catch (error: any) {
            clearTimeout(timeoutId);
            lastError = error;
            console.warn(
              `[AdminPage] Fetch from ${base} failed:`,
              error?.message,
            );

            const isAbort = error?.name === "AbortError";
            const isNetworkLike = error instanceof TypeError;
            if (isAbort || isNetworkLike) {
              continue;
            }

            throw error;
          }
        }

        if (!userRes) {
          throw lastError || new Error("Unable to reach auth endpoint");
        }

        if (!userRes.ok) {
          console.error("[AdminPage] Auth check failed:", userRes.status);
          localStorage.removeItem("sentinel_session");
          if (isMounted) setHasSession(false);
          return;
        }

        const userData = await userRes.json();
        if (isMounted) {
          setUser(userData);

          if (!userData.is_owner) {
            console.error("[AdminPage] Access denied: User is not owner");
            navigate("/error?msg=Unauthorized: Bot owner only");
            return;
          }
        }
      } catch (error: any) {
        console.error("[AdminPage] Validation error:", error);
        if (error?.name === "AbortError") {
          console.error("[AdminPage] Auth request timed out after 10s");
        } else {
          console.error("[AdminPage] Fetch error:", error?.message || error);
        }
        localStorage.removeItem("sentinel_session");
        if (isMounted) setHasSession(false);
      } finally {
        if (isMounted) setLoading(false);
        abortControllerRef.current = null;
      }
    };

    // Start validation but ensure timeout if it hangs
    validateAndFetch().catch((err) => {
      console.error("[AdminPage] Uncaught validation error:", err);
      if (isMounted) {
        setLoading(false);
        setHasSession(false);
      }
    });

    // Cleanup: abort in-flight request if effect is unmounted
    return () => {
      isMounted = false;
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, [sessionParamValue]); // Only depend on the actual session param value, not the entire searchParams object

  // Effect to handle navigation for invalid sessions to avoid "update while rendering" errors
  useEffect(() => {
    if (hasSession === false && !loading) {
      navigate("/error?msg=Session expired or invalid");
    }
  }, [hasSession, loading, navigate]);

  const handleSignOut = async () => {
    await performMasterLogout({
      sessionToken,
      navigate,
      redirectTo: "/",
    });
  };

  if (loading) return <LoadingScreen subMessage="Authenticating Manager..." />;

  if (hasSession === false) return null; // Handled by useEffect redirect

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
              <h2 className="text-sm font-bold tracking-tight uppercase leading-none text-foreground">
                Sentinel
              </h2>
            </div>
          </div>
        </SidebarHeader>

        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupLabel className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground/50">
              Core Systems
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton isActive={true} className="h-11">
                    <Zap />
                    <span className="font-bold tracking-wide text-foreground/80">
                      Global Control
                    </span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>

        <SidebarFooter className="border-t border-border/50">
          {user && (
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3 min-w-0">
                <Avatar>
                  <AvatarImage
                    src={
                      user.id && user.avatar
                        ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png`
                        : undefined
                    }
                  />
                  <AvatarFallback className="bg-primary/5 rounded-lg flex items-center justify-center">
                    <UserCircle className="w-4 h-4 opacity-40 text-foreground" />
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0">
                  <p className="text-xs font-bold truncate text-foreground leading-none">
                    {user?.global_name || user?.username}
                  </p>
                </div>
              </div>
              <ModeToggle />
            </div>
          )}
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
            <div className="flex items-center gap-2 text-[9px] font-bold uppercase tracking-[0.25em] text-primary/70">
              <Sparkles className="w-3 h-3" />
              System Administration
            </div>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto z-10">
          <div className="max-w-5xl mx-auto px-8 py-10">
            <div className="grid gap-8 animate-in fade-in zoom-in-95 duration-1000 delay-200">
              <BotManagementConfig sessionToken={sessionToken!} />
            </div>
          </div>
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
