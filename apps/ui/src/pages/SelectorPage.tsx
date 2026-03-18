import {
  useEffect,
  useState,
  Suspense,
  lazy,
  useCallback,
  useMemo,
} from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { MapPainterState } from "@/types/painter";
import { ShieldAlert, ArrowLeft, History, RotateCcw } from "lucide-react";
import { LoadingScreen } from "@/components/loading-screen";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";

const TTSelector = lazy(() => import("@/components/painter/TTSelector"));

const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:3001";

type MapHistoryEntry = {
  id: string;
  created_at: string;
  created_by: string;
  created_by_name?: string | null;
  snapshot_json?: string;
};

type MapHistoryEntryWithDetails = MapHistoryEntry & {
  summary: {
    labels: number;
    territories: number;
    enabledLabels: number;
  };
};

export default function SelectorPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const sessionToken =
    searchParams.get("session") || localStorage.getItem("sentinel_session");
  const mapId = searchParams.get("mapId");
  const [initialState, setInitialState] =
    useState<Partial<MapPainterState> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [historyEntries, setHistoryEntries] = useState<MapHistoryEntry[]>([]);
  const [isHistoryLoading, setIsHistoryLoading] = useState(false);
  const [restoreTargetId, setRestoreTargetId] = useState<string | null>(null);
  const [isRestoring, setIsRestoring] = useState(false);

  const historyEntriesWithDetails = useMemo<
    MapHistoryEntryWithDetails[]
  >(() => {
    return historyEntries.map((entry) => {
      let labels = 0;
      let enabledLabels = 0;
      let territories = 0;

      try {
        const parsed = JSON.parse(entry.snapshot_json || "[]");
        if (Array.isArray(parsed)) {
          labels = parsed.length;
          enabledLabels = parsed.filter((l) => l?.enabled !== false).length;
          territories = parsed.reduce((acc: number, l: any) => {
            const count = Array.isArray(l?.territories)
              ? l.territories.length
              : 0;
            return acc + count;
          }, 0);
        }
      } catch {
        // Keep zeroed summary if snapshot json is malformed.
      }

      return {
        ...entry,
        summary: { labels, territories, enabledLabels },
      };
    });
  }, [historyEntries]);

  useEffect(() => {
    if (!sessionToken) {
      navigate("/territories");
      return;
    }

    if (searchParams.get("session")) {
      localStorage.setItem("sentinel_session", sessionToken);
      // Clean up URL
      window.history.replaceState(
        {},
        document.title,
        window.location.pathname + (mapId ? `?mapId=${mapId}` : ""),
      );
    }

    setError(null);
    setLoading(true);

    let cancelled = false;
    const controller = new AbortController();

    const fetchMap = async () => {
      try {
        const url = mapId
          ? `${API_BASE}/api/map?mapId=${mapId}`
          : `${API_BASE}/api/map`;
        const res = await fetch(url, {
          signal: controller.signal,
          headers: { Authorization: `Bearer ${sessionToken}` },
        });

        if (res.status === 401) {
          localStorage.removeItem("sentinel_session");
          navigate("/territories");
          return;
        }

        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(
            errData.error || `Server returned ${res.status}: ${res.statusText}`,
          );
        }

        const data = await res.json();
        if (cancelled) return;

        setInitialState({
          map: data.map,
          labels: data.labels,
          assignments: data.assignments,
          territoryMetadata: data.territoryMetadata,
          prices: data.prices,
        });
        setLoading(false);
      } catch (err: any) {
        if (cancelled || err.name === "AbortError") return;
        console.error("[SelectorPage] Fetch error:", err);
        setError(
          err instanceof Error ? err.message : "An unknown error occurred",
        );
        setLoading(false);
      }
    };

    fetchMap();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [sessionToken, mapId, navigate]);

  const handleSave = useCallback(
    async (state: MapPainterState) => {
      if (!sessionToken) return;
      try {
        const url = mapId
          ? `${API_BASE}/api/map?mapId=${mapId}`
          : `${API_BASE}/api/map`;
        const res = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${sessionToken}`,
          },
          body: JSON.stringify({
            labels: state.labels,
            assignments: state.assignments,
          }),
        });
        if (!res.ok) {
          if (res.status === 401) {
            localStorage.removeItem("sentinel_session");
            navigate("/territories");
            return;
          }
          throw new Error("Failed to save configuration");
        }
      } catch (err) {
        console.error("[SelectorPage] Save error:", err);
        throw err;
      }
    },
    [sessionToken, mapId, navigate],
  );

  const fetchHistory = useCallback(async () => {
    if (!sessionToken || !mapId) return;

    setIsHistoryLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/map/${mapId}/history`, {
        headers: { Authorization: `Bearer ${sessionToken}` },
      });

      if (res.status === 401) {
        localStorage.removeItem("sentinel_session");
        navigate("/territories");
        return;
      }

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || "Failed to load version history");
      }

      setHistoryEntries(data.history || []);
    } catch (err) {
      console.error("[SelectorPage] History fetch error:", err);
      toast.error("Failed to load version history");
    } finally {
      setIsHistoryLoading(false);
    }
  }, [sessionToken, mapId, navigate]);

  const handleRestore = useCallback(async () => {
    if (!sessionToken || !mapId || !restoreTargetId) return;

    setIsRestoring(true);
    try {
      const res = await fetch(`${API_BASE}/api/map/${mapId}/restore`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${sessionToken}`,
        },
        body: JSON.stringify({ historyId: restoreTargetId }),
      });

      if (res.status === 401) {
        localStorage.removeItem("sentinel_session");
        navigate("/territories");
        return;
      }

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || "Failed to restore version");
      }

      setRestoreTargetId(null);
      setIsHistoryOpen(false);
      toast.success("Version restored");
      window.location.reload();
    } catch (err) {
      console.error("[SelectorPage] Restore error:", err);
      toast.error("Failed to restore version");
    } finally {
      setIsRestoring(false);
    }
  }, [sessionToken, mapId, restoreTargetId, navigate]);

  useEffect(() => {
    if (!isHistoryOpen || !mapId) return;
    fetchHistory();
  }, [isHistoryOpen, mapId, fetchHistory]);

  if (loading) return <LoadingScreen />;

  if (error)
    return (
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
              onClick={() => navigate("/territories")}
              variant="secondary"
              className="rounded-xl px-8"
            >
              <ArrowLeft className="w-4 h-4 mr-2" />
              Map Vault
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
    <div className="w-full h-screen overflow-hidden bg-[#050505] relative flex flex-col dark">
      <div className="absolute top-4 right-4 z-50 flex items-center gap-3">
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-1.5 flex items-center gap-1 shadow-2xl">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setIsHistoryOpen(true)}
            className="font-black uppercase tracking-widest text-zinc-400 hover:text-white hover:bg-zinc-800!"
            disabled={!mapId}
          >
            <History className="w-3.5 h-3.5 mr-2" /> History
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate("/territories")}
            className="font-black uppercase tracking-widest text-zinc-400 hover:text-white hover:bg-zinc-800!"
          >
            <ArrowLeft className="w-3.5 h-3.5 mr-2" /> Exit Painter
          </Button>
        </div>
      </div>

      <div className="flex-1 min-h-0 relative">
        <Suspense fallback={<LoadingScreen />}>
          <TTSelector
            initialState={initialState || {}}
            onSave={handleSave}
            sessionToken={sessionToken!}
          />
        </Suspense>
      </div>

      <Dialog open={isHistoryOpen} onOpenChange={setIsHistoryOpen}>
        <DialogContent className="bg-zinc-950 border-zinc-800 text-zinc-100 sm:max-w-xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 uppercase tracking-wide">
              <History className="w-4 h-4 text-zinc-300" />
              Version History
            </DialogTitle>
            <DialogDescription>
              Restore a previous snapshot. This replaces current labels and
              assignments.
            </DialogDescription>
          </DialogHeader>

          {isHistoryLoading ? (
            <div className="py-8 text-center text-xs uppercase tracking-wider text-zinc-500">
              Loading snapshots...
            </div>
          ) : historyEntriesWithDetails.length === 0 ? (
            <div className="py-8 text-center text-sm text-zinc-500">
              No history entries found yet.
            </div>
          ) : (
            <ScrollArea className="max-h-96 pr-3">
              <div className="space-y-2">
                {historyEntriesWithDetails.map((entry) => (
                  <div
                    key={entry.id}
                    className="flex items-center justify-between rounded-lg border border-white/10 bg-zinc-900/40 px-3 py-2"
                  >
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-zinc-200 truncate">
                        {new Date(entry.created_at).toLocaleString()}
                      </p>
                      <p className="text-[11px] text-zinc-500 truncate">
                        By {entry.created_by_name || entry.created_by}
                      </p>
                      <p className="text-[10px] text-zinc-600 mt-0.5">
                        {entry.summary.labels} labels,{" "}
                        {entry.summary.enabledLabels} enabled,{" "}
                        {entry.summary.territories} territories
                      </p>
                    </div>

                    <Button
                      size="sm"
                      variant="ghost"
                      className=" text-amber-300 bg-zinc-800 hover:bg-zinc-700 hover:text-amber-200"
                      onClick={() => setRestoreTargetId(entry.id)}
                      disabled={isRestoring}
                    >
                      <RotateCcw className="w-3.5 h-3.5 mr-1.5" /> Restore
                    </Button>
                  </div>
                ))}
              </div>
            </ScrollArea>
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={!!restoreTargetId}
        onOpenChange={(open) => {
          if (!open) setRestoreTargetId(null);
        }}
      >
        <AlertDialogContent className="bg-zinc-950 border-zinc-800 text-zinc-100 sm:max-w-xl">
          <AlertDialogHeader>
            <AlertDialogTitle>Restore this version?</AlertDialogTitle>
            <AlertDialogDescription>
              This is a destructive action. Your current configuration will be
              replaced by the selected snapshot.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="bg-zinc-950 border-0">
            <AlertDialogCancel
              className="bg-zinc-800 hover:bg-zinc-700 text-zinc-200 hover:text-zinc-200 border-0"
              disabled={isRestoring}
            >
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={isRestoring}
              onClick={(e) => {
                e.preventDefault();
                handleRestore();
              }}
            >
              {isRestoring ? "Restoring..." : "Restore Version"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
