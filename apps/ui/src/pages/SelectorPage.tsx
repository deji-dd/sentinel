import { useEffect, useState, Suspense, lazy, useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import { MapPainterState } from "@/types/painter";
import { Loader2 } from "lucide-react";

const TTSelector = lazy(() => import("@/components/painter/TTSelector"));

const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:3001";

export default function SelectorPage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token");
  const [initialState, setInitialState] = useState<Partial<MapPainterState> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      setError("Missing session token");
      setLoading(false);
      return;
    }

    setError(null);
    setLoading(true);

    // Use a local flag to guard state updates; more reliable than
    // controller.signal.aborted after async awaits in Strict Mode dev.
    let cancelled = false;
    const controller = new AbortController();
    let isTimeout = false;
    const timeout = setTimeout(() => {
      isTimeout = true;
      controller.abort();
    }, 60000);

    fetch(`${API_BASE}/api/map?token=${token}`, { signal: controller.signal })
      .then(res => {
        if (!res.ok) throw new Error(`Server returned ${res.status}: ${res.statusText}`);
        return res.json();
      })
      .then(data => {
        if (cancelled) return;
        setInitialState({
          labels: data.labels,
          assignments: data.assignments,
          territoryMetadata: data.territoryMetadata,
          prices: data.prices
        });
        setLoading(false);
      })
      .catch(err => {
        if (cancelled) return;

        const isAbort = err.name === 'AbortError';
        if (isAbort && !isTimeout) return; // Component unmounted — silent

        if (isAbort) {
          setError("Connection timed out. The server might be busy or offline.");
        } else if (err.message.includes("401")) {
          setError("Your session has expired. Please return to Discord and regenerate a link.");
        } else {
          console.error("[SelectorPage] Fetch error:", err);
          setError(err instanceof Error ? err.message : "An unknown error occurred");
        }
        setLoading(false);
      })
      .finally(() => clearTimeout(timeout));

    return () => {
      cancelled = true;
      controller.abort();
      clearTimeout(timeout);
    };
  }, [token]);

  const handleSave = useCallback(async (state: MapPainterState) => {
    if (!token) return;
    try {
      const res = await fetch(`${API_BASE}/api/map?token=${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          labels: state.labels,
          assignments: state.assignments
        })
      });
      if (!res.ok) {
        if (res.status === 401) {
          window.location.reload(); // Trigger re-auth/error screen
          return;
        }
        throw new Error("Failed to save configuration");
      }
    } catch (err) {
      console.error("[SelectorPage] Save error:", err);
    }
  }, [token]);

  if (loading) return (
    <div className="h-screen flex flex-col items-center justify-center bg-[#0a0a0a] text-white">
      <Loader2 className="w-10 h-10 text-blue-500 animate-spin mb-4" />
      <p className="text-zinc-400 font-medium">Initializing Sentinel...</p>
    </div>
  );
  if (error) return <div className="h-screen flex items-center justify-center bg-[#0a0a0a] text-red-500">{error}</div>;

  return (
    <div className="w-full h-screen overflow-hidden">
      <Suspense fallback={
        <div className="h-screen flex flex-col items-center justify-center bg-[#0a0a0a] text-white">
          <Loader2 className="w-8 h-8 text-blue-500 animate-spin mb-2" />
          <p className="text-zinc-500 text-sm">Loading Map Assets...</p>
        </div>
      }>
        <TTSelector initialState={initialState || {}} onSave={handleSave} />
      </Suspense>
    </div>
  );
}
