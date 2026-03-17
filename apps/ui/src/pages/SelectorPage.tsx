import { useEffect, useState, Suspense, lazy, useCallback } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { MapPainterState } from "@/types/painter";
import { ShieldAlert, ArrowLeft } from "lucide-react";
import { ModeToggle } from "@/components/mode-toggle";
import { LoadingScreen } from "@/components/loading-screen";
import { Button } from "@/components/ui/button";

const TTSelector = lazy(() => import("@/components/painter/TTSelector"));

const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:3001";

export default function SelectorPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const sessionToken = searchParams.get("session") || localStorage.getItem("sentinel_session");
  const mapId = searchParams.get("mapId");
  const [initialState, setInitialState] = useState<Partial<MapPainterState> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!sessionToken) {
      navigate("/config");
      return;
    }

    if (searchParams.get("session")) {
      localStorage.setItem("sentinel_session", sessionToken);
      // Clean up URL
      window.history.replaceState({}, document.title, window.location.pathname + (mapId ? `?mapId=${mapId}` : ""));
    }

    setError(null);
    setLoading(true);

    let cancelled = false;
    const controller = new AbortController();

    const fetchMap = async () => {
      try {
        const url = mapId ? `${API_BASE}/api/map?mapId=${mapId}` : `${API_BASE}/api/map`;
        const res = await fetch(url, {
          signal: controller.signal,
          headers: { Authorization: `Bearer ${sessionToken}` }
        });

        if (res.status === 401) {
          localStorage.removeItem("sentinel_session");
          navigate("/config");
          return;
        }

        if (!res.ok) {
           const errData = await res.json().catch(() => ({}));
           throw new Error(errData.error || `Server returned ${res.status}: ${res.statusText}`);
        }

        const data = await res.json();
        if (cancelled) return;

        setInitialState({
          map: data.map,
          labels: data.labels,
          assignments: data.assignments,
          territoryMetadata: data.territoryMetadata,
          prices: data.prices
        });
        setLoading(false);
      } catch (err: any) {
        if (cancelled || err.name === 'AbortError') return;
        console.error("[SelectorPage] Fetch error:", err);
        setError(err instanceof Error ? err.message : "An unknown error occurred");
        setLoading(false);
      }
    };

    fetchMap();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [sessionToken, mapId, navigate]);

  const handleSave = useCallback(async (state: MapPainterState) => {
    if (!sessionToken) return;
    try {
      const url = mapId ? `${API_BASE}/api/map?mapId=${mapId}` : `${API_BASE}/api/map`;
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${sessionToken}`
        },
        body: JSON.stringify({
          labels: state.labels,
          assignments: state.assignments
        })
      });
      if (!res.ok) {
        if (res.status === 401) {
          localStorage.removeItem("sentinel_session");
          navigate("/config");
          return;
        }
        throw new Error("Failed to save configuration");
      }
    } catch (err) {
      console.error("[SelectorPage] Save error:", err);
      throw err;
    }
  }, [sessionToken, mapId, navigate]);

  if (loading) return <LoadingScreen />;

  if (error) return (
    <div className="h-screen flex items-center justify-center bg-background p-6 text-center">
      <div className="max-w-md w-full space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-500">
        <div className="w-16 h-16 bg-destructive/10 border border-destructive/20 rounded-2xl flex items-center justify-center mx-auto mb-4 text-destructive shadow-lg shadow-destructive/10">
          <ShieldAlert className="w-8 h-8" />
        </div>
        <h2 className="text-xl font-bold tracking-tight text-destructive uppercase">
          {error === "Missing map ID" ? "No Map Selected" : "Critical Error"}
        </h2>
        <p className="text-muted-foreground leading-relaxed">
          {error === "Missing map ID" 
            ? "You must select a specific map to configure. Please return to the module management page."
            : error}
        </p>
        <div className="flex gap-3 justify-center pt-4">
          <Button
            onClick={() => navigate("/config")}
            variant="secondary"
            className="rounded-xl px-8"
          >
            <ArrowLeft className="w-4 h-4 mr-2" />
            Dashboard
          </Button>
          {error !== "Missing map ID" && (
            <Button
              onClick={() => window.location.reload()}
              className="rounded-xl px-8"
            >
              Try Again
            </Button>
          )}
        </div>
      </div>
    </div>
  );

  return (
    <div className="w-full h-screen overflow-hidden bg-background relative">
      <div className="absolute top-4 right-4 z-50 flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={() => navigate("/config")} className="rounded-xl h-8 text-[10px] font-bold uppercase tracking-widest text-muted-foreground hover:text-foreground">
           <ArrowLeft className="w-3 h-3 mr-2" /> Close Painter
        </Button>
        <ModeToggle />
      </div>
      <Suspense fallback={<LoadingScreen />}>
        <TTSelector initialState={initialState || {}} onSave={handleSave} />
      </Suspense>
    </div>
  );
}
