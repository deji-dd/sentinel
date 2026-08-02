"use client";

import * as React from "react";
import { toast } from "sonner";
import {
  getTelemetryDataAction,
  getSystemLogsAction,
  restartServiceAction,
} from "@/actions/telemetry";
import { cn } from "@/lib/utils/cn";
import {
  Cpu,
  RefreshCw,
  RotateCcw,
  Terminal,
  Server,
  AlertTriangle,
  AlertCircle,
  Search,
  Pause,
  Play,
  Zap,
} from "lucide-react";

interface ProcessInfo {
  id: string;
  name: string;
  serviceName: string;
  pid: number | null;
  status: "online" | "offline" | "restarting";
  environment: string;
  runner: string;
  uptimeSeconds: number;
  memory: {
    rssBytes: number;
    heapTotalBytes: number;
    heapUsedBytes: number;
    externalBytes: number;
  };
}

interface TelemetryData {
  status: string;
  timestamp: string;
  environment: string;
  runner: string;
  system: {
    platform: string;
    arch: string;
    uptimeSeconds: number;
    loadAvg: number[];
    cpusCount: number;
    cpuModel: string;
    totalMemoryBytes: number;
    freeMemoryBytes: number;
    usedMemoryBytes: number;
    memoryUsagePct: number;
  };
  processes: ProcessInfo[];
}

interface LogEntry {
  id: string;
  timestamp: string;
  service: string;
  level: "info" | "warn" | "error";
  message: string;
}

function formatBytes(bytes?: number): string {
  if (!bytes || bytes === 0) return "0 MB";
  const mb = bytes / (1024 * 1024);
  if (mb < 1000) return `${mb.toFixed(1)} MB`;
  return `${(mb / 1024).toFixed(2)} GB`;
}

function formatDuration(seconds?: number): string {
  if (!seconds || seconds <= 0) return "0s";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

export function LiveTelemetryDashboard() {
  const [telemetry, setTelemetry] = React.useState<TelemetryData | null>(null);
  const [logs, setLogs] = React.useState<LogEntry[]>([]);
  const [loading, setLoading] = React.useState<boolean>(true);
  const [error, setError] = React.useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = React.useState<boolean>(true);
  const [manualRefreshing, setManualRefreshing] = React.useState<boolean>(false);

  // Log controls
  const [selectedService, setSelectedService] = React.useState<string>("all");
  const [logFilterText, setLogFilterText] = React.useState<string>("");
  const [pauseScroll, setPauseScroll] = React.useState<boolean>(false);

  // Restart modal state
  const [restartTarget, setRestartTarget] = React.useState<string | null>(null);
  const [restarting, setRestarting] = React.useState<boolean>(false);

  const logsContainerRef = React.useRef<HTMLDivElement>(null);

  // Fetch telemetry data from API via Server Action
  const fetchTelemetry = React.useCallback(async () => {
    try {
      const data: TelemetryData = await getTelemetryDataAction();
      if (!data || !data.system) {
        throw new Error("Invalid telemetry data structure returned from API");
      }
      setTelemetry(data);
      setError(null);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      setError(errMsg);
      setTelemetry(null);
    } finally {
      setLoading(false);
    }
  }, []);

  // Fetch process logs from API via Server Action
  const fetchLogs = React.useCallback(async () => {
    try {
      const data = await getSystemLogsAction(selectedService, 60);
      if (Array.isArray(data?.logs)) {
        setLogs(data.logs);
      }
    } catch (err) {
      console.warn("Failed to fetch system logs:", err);
    }
  }, [selectedService]);

  // Polling loop (5-second cadence)
  React.useEffect(() => {
    fetchTelemetry();
    fetchLogs();

    if (!autoRefresh) return;
    const interval = setInterval(() => {
      fetchTelemetry();
      fetchLogs();
    }, 5000);

    return () => clearInterval(interval);
  }, [autoRefresh, fetchTelemetry, fetchLogs]);

  // Auto-scroll log console
  React.useEffect(() => {
    if (!pauseScroll && logsContainerRef.current) {
      logsContainerRef.current.scrollTop = logsContainerRef.current.scrollHeight;
    }
  }, [logs, pauseScroll]);

  // Trigger service restart via Server Action
  const handleRestartService = async (serviceName: string) => {
    setRestarting(true);
    toast.info(`Issuing restart request for ${serviceName === "all" ? "all services" : serviceName}...`);
    try {
      const data = await restartServiceAction(serviceName);
      const successMsg = data.message || `Restart command issued for ${serviceName}`;
      toast.success(successMsg);
      setTimeout(() => {
        fetchTelemetry();
        fetchLogs();
      }, 1500);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      toast.error(`Restart failed`, { description: errorMsg });
    } finally {
      setRestarting(false);
      setRestartTarget(null);
    }
  };

  const filteredLogs = React.useMemo(() => {
    return logs.filter((log) => {
      if (selectedService !== "all" && log.service !== selectedService) return false;
      if (logFilterText.trim()) {
        const query = logFilterText.toLowerCase();
        return (
          log.message.toLowerCase().includes(query) ||
          log.service.toLowerCase().includes(query) ||
          log.level.toLowerCase().includes(query)
        );
      }
      return true;
    });
  }, [logs, selectedService, logFilterText]);

  const handleManualPoll = async () => {
    setManualRefreshing(true);
    try {
      await Promise.all([fetchTelemetry(), fetchLogs()]);
      toast.success("Telemetry & logs updated");
    } catch (err) {
      toast.error("Telemetry refresh failed", {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setTimeout(() => setManualRefreshing(false), 400);
    }
  };

  return (
    <div className="space-y-6">
      {/* Telemetry Control Header Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 rounded-2xl bg-card border border-border/70 shadow-xs backdrop-blur-md relative overflow-hidden">
        {/* Ambient subtle glow background accent */}
        <div className="absolute -top-12 -left-12 size-36 bg-cyan-500/5 rounded-full blur-2xl pointer-events-none" />

        {/* Left Telemetry Status Indicators */}
        <div className="flex flex-wrap items-center gap-3 relative z-10">
          <div className="flex items-center gap-1.5 text-xs font-mono">
            <span className="text-muted-foreground">Env:</span>
            <span className="px-2 py-0.5 rounded-md bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 font-semibold uppercase">
              {telemetry ? (telemetry.runner === "systemd" ? "Production" : "Development") : "UNAVAILABLE"}
            </span>
          </div>

          {telemetry?.system?.platform && (
            <div className="hidden md:flex items-center gap-1.5 text-xs font-mono">
              <span className="text-muted-foreground">Host:</span>
              <span className="px-2 py-0.5 rounded-md bg-secondary text-secondary-foreground border border-border/40 font-medium">
                {telemetry.system.platform} ({telemetry.system.arch})
              </span>
            </div>
          )}
        </div>

        {/* Right Sync Control Toolbar */}
        <div className="flex items-center gap-2.5 relative z-10">
          <button
            type="button"
            onClick={() => setAutoRefresh(!autoRefresh)}
            className={cn(
              "flex items-center gap-2 px-3.5 py-1.5 text-xs font-medium rounded-xl border transition-all duration-200 active:scale-95 cursor-pointer",
              autoRefresh
                ? "bg-secondary/80 text-secondary-foreground border-border/60 hover:bg-secondary hover:border-border"
                : "bg-amber-500/10 text-amber-400 border-amber-500/30 hover:bg-amber-500/20"
            )}
          >
            {autoRefresh ? <Pause className="size-3.5 text-muted-foreground" /> : <Play className="size-3.5" />}
            <span>{autoRefresh ? "Pause Sync" : "Resume Sync"}</span>
          </button>

          <button
            type="button"
            onClick={handleManualPoll}
            disabled={manualRefreshing}
            className="flex items-center gap-2 px-3.5 py-1.5 text-xs font-medium rounded-xl bg-primary text-primary-foreground hover:bg-primary/90 active:scale-95 transition-all duration-200 shadow-xs border border-primary-foreground/15 cursor-pointer disabled:opacity-70"
          >
            <RefreshCw className={cn("size-3.5", manualRefreshing && "animate-spin")} />
            <span>Poll Now</span>
          </button>
        </div>
      </div>

      {/* Offline API Error Alert Banner */}
      {error && !telemetry && (
        <div className="p-6 rounded-2xl bg-destructive/10 border border-destructive/30 text-foreground space-y-4">
          <div className="flex items-start gap-3">
            <div className="p-2 rounded-xl bg-destructive/20 text-destructive shrink-0">
              <AlertCircle className="size-6" />
            </div>
            <div>
              <h3 className="text-base font-bold text-destructive">Telemetry API Gateway Offline</h3>
              <p className="text-xs text-muted-foreground mt-1">
                Unable to fetch system telemetry metrics from <code className="font-mono text-foreground font-semibold">/system/telemetry</code>.
                Make sure the API server is active on port 3001.
              </p>
              <p className="text-xs font-mono text-destructive/80 mt-2 bg-destructive/5 p-2 rounded-lg border border-destructive/20">
                Error details: {error}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3 pt-1">
            <button
              type="button"
              onClick={handleManualPoll}
              disabled={manualRefreshing}
              className="flex items-center gap-2 px-4 py-2 text-xs font-semibold rounded-xl bg-primary text-primary-foreground hover:bg-primary/90 transition-colors shadow-xs cursor-pointer"
            >
              <RefreshCw className={cn("size-3.5", manualRefreshing && "animate-spin")} />
              <span>Retry Connection</span>
            </button>
          </div>
        </div>
      )}

      {/* 3 High-Impact Metric Gauges */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* CPU & RAM Usage */}
        <div className="p-4 rounded-2xl bg-card border border-border/70 shadow-xs border-l-4 border-l-cyan-500">
          <div className="flex items-center justify-between gap-2 mb-2">
            <div className="flex items-center gap-2">
              <div className="p-1.5 rounded-lg bg-cyan-500/10 text-cyan-500">
                <Cpu className="size-4" />
              </div>
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                CPU & Memory
              </span>
            </div>
            <span className="px-2 py-0.5 text-[10px] font-mono font-medium rounded-full bg-secondary text-secondary-foreground border border-border/40">
              {telemetry?.system ? `${telemetry.system.cpusCount} CORES` : "N/A"}
            </span>
          </div>
          <div className="mt-1">
            <div className="text-2xl font-bold font-mono tracking-tight text-foreground">
              {telemetry?.system ? formatBytes(telemetry.system.usedMemoryBytes) : "N/A"}
            </div>
            <div className="w-full bg-muted rounded-full h-1.5 mt-2 overflow-hidden">
              <div
                className="bg-cyan-500 h-full rounded-full transition-all duration-500"
                style={{ width: `${Math.min(telemetry?.system?.memoryUsagePct || 0, 100)}%` }}
              />
            </div>
            <p className="text-xs text-muted-foreground mt-1.5">
              Load 1m: <span className="font-mono text-foreground font-semibold">{telemetry?.system?.loadAvg?.[0] !== undefined ? telemetry.system.loadAvg[0].toFixed(2) : "N/A"}</span> •
              RAM: <span className="font-mono text-foreground font-semibold">{telemetry?.system?.memoryUsagePct !== undefined ? `${telemetry.system.memoryUsagePct}%` : "N/A"}</span>
            </p>
          </div>
        </div>

        {/* OS Node Uptime */}
        <div className="p-4 rounded-2xl bg-card border border-border/70 shadow-xs border-l-4 border-l-indigo-500">
          <div className="flex items-center justify-between gap-2 mb-2">
            <div className="flex items-center gap-2">
              <div className="p-1.5 rounded-lg bg-indigo-500/10 text-indigo-500">
                <Server className="size-4" />
              </div>
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Host OS Node
              </span>
            </div>
            <span className="px-2 py-0.5 text-[10px] font-mono font-medium rounded-full bg-secondary text-secondary-foreground border border-border/40">
              {telemetry?.system ? `${telemetry.system.platform} / ${telemetry.system.arch}` : "N/A"}
            </span>
          </div>
          <div className="mt-1">
            <div className="text-2xl font-bold font-mono tracking-tight text-foreground">
              {telemetry?.system ? formatDuration(telemetry.system.uptimeSeconds) : "N/A"}
            </div>
          </div>
        </div>


      </div>

      {/* Hosted Services Cards */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold tracking-tight text-foreground flex items-center gap-2">
            Hosted Process Instances
          </h3>

          <button
            type="button"
            onClick={() => setRestartTarget("all")}
            disabled={!telemetry}
            className="flex items-center gap-1.5 px-3 py-1 text-xs font-medium rounded-xl bg-destructive/10 text-destructive hover:bg-destructive/20 border border-destructive/30 transition-colors disabled:opacity-50"
          >
            <RotateCcw className="size-3.5" />
            <span>Restart All</span>
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {telemetry?.processes && telemetry.processes.length > 0 ? (
            telemetry.processes.map((proc) => (
              <div
                key={proc.id}
                className="p-4 rounded-2xl bg-card border border-border/70 shadow-xs flex flex-col justify-between space-y-4 hover:border-border transition-colors"
              >
                <div>
                  <div className="flex items-start justify-between gap-2">
                    <div>

                      <span className="text-xs font-mono text-muted-foreground mt-0.5 block">
                        {proc.serviceName}
                      </span>
                    </div>

                    <span
                      className={cn(
                        "px-2 py-0.5 text-[10px] font-mono font-semibold rounded-md uppercase border",
                        proc.status === "online"
                          ? "bg-emerald-500/10 text-emerald-500 border-emerald-500/30"
                          : "bg-muted text-muted-foreground border-border/40"
                      )}
                    >
                      {proc.status}
                    </span>
                  </div>

                  <div className="mt-4 space-y-2 text-xs font-mono">
                    <div className="flex items-center justify-between p-2 rounded-xl bg-muted/30 border border-border/40">
                      <span className="text-muted-foreground">Process PID</span>
                      <span className="font-semibold text-foreground">{proc.pid ? proc.pid : "N/A (Stopped)"}</span>
                    </div>

                    <div className="flex items-center justify-between p-2 rounded-xl bg-muted/30 border border-border/40">
                      <span className="text-muted-foreground">RSS Memory</span>
                      <span className="font-semibold text-foreground">{formatBytes(proc.memory?.rssBytes)}</span>
                    </div>

                    <div className="flex items-center justify-between p-2 rounded-xl bg-muted/30 border border-border/40">
                      <span className="text-muted-foreground">Uptime</span>
                      <span className="font-semibold text-foreground">{formatDuration(proc.uptimeSeconds)}</span>
                    </div>
                  </div>
                </div>

                <div className="pt-3 border-t border-border/40 flex items-center justify-between">

                  <button
                    type="button"
                    onClick={() => setRestartTarget(proc.serviceName.replace("sentinel-", ""))}
                    className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-xl bg-secondary text-secondary-foreground hover:bg-secondary/80 border border-border/40 transition-colors"
                  >
                    <RotateCcw className="size-3" />
                    <span>Restart</span>
                  </button>
                </div>
              </div>
            ))
          ) : (
            <div className="col-span-3 p-8 text-center rounded-2xl bg-card border border-border/70 text-muted-foreground text-xs font-mono">
              {loading ? "Fetching live process telemetry..." : "No active process telemetry available from API."}
            </div>
          )}
        </div>
      </div>

      {/* Live Terminal Log Streamer */}
      <div className="space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Terminal className="size-4 text-cyan-500" />
            <h3 className="text-sm font-bold tracking-tight text-foreground">
              Live Process Logs
            </h3>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Service filter tabs */}
            <div className="flex items-center p-0.5 rounded-xl bg-muted/60 border border-border/40 text-xs font-mono">
              {["all", "api", "worker", "bot"].map((svc) => (
                <button
                  key={svc}
                  type="button"
                  onClick={() => setSelectedService(svc)}
                  className={cn(
                    "px-2.5 py-1 rounded-lg transition-colors uppercase",
                    selectedService === svc
                      ? "bg-card text-foreground font-semibold shadow-xs"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {svc}
                </button>
              ))}
            </div>

            {/* Search Filter input */}
            <div className="relative">
              <Search className="size-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input
                type="text"
                placeholder="Filter log text..."
                value={logFilterText}
                onChange={(e) => setLogFilterText(e.target.value)}
                className="pl-8 pr-3 py-1 text-xs font-mono rounded-xl bg-muted/40 border border-border/60 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring w-40 sm:w-52"
              />
            </div>

            <button
              type="button"
              onClick={() => setPauseScroll(!pauseScroll)}
              className="p-1.5 rounded-xl bg-secondary text-secondary-foreground hover:bg-secondary/80 border border-border/40 text-xs"
              title={pauseScroll ? "Resume Auto-scroll" : "Pause Auto-scroll"}
            >
              {pauseScroll ? <Play className="size-3.5" /> : <Pause className="size-3.5" />}
            </button>
          </div>
        </div>

        {/* Console Log Terminal Window */}
        <div
          ref={logsContainerRef}
          className="h-80 overflow-y-auto p-4 rounded-2xl bg-[#080c14] border border-border/80 font-mono text-xs text-slate-300 space-y-2 shadow-inner"
        >
          {filteredLogs.length === 0 ? (
            <div className="h-full flex items-center justify-center text-muted-foreground text-xs italic">
              No logs matching current filter or service selection.
            </div>
          ) : (
            filteredLogs.map((log) => (
              <div key={log.id} className="flex items-start gap-2.5 hover:bg-slate-800/40 p-1 rounded-sm transition-colors">
                <span className="text-slate-500 shrink-0 text-[11px]">
                  {new Date(log.timestamp).toLocaleTimeString()}
                </span>
                <span
                  className={cn(
                    "px-1.5 py-0.2 rounded text-[10px] uppercase font-bold shrink-0",
                    log.service === "api"
                      ? "bg-cyan-500/20 text-cyan-400 border border-cyan-500/30"
                      : log.service === "worker"
                        ? "bg-indigo-500/20 text-indigo-400 border border-indigo-500/30"
                        : log.service === "bot"
                          ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                          : "bg-slate-500/20 text-slate-400 border border-slate-500/30"
                  )}
                >
                  {log.service}
                </span>
                <span
                  className={cn(
                    "px-1 py-0.2 rounded text-[10px] uppercase font-semibold shrink-0",
                    log.level === "error"
                      ? "bg-rose-500/20 text-rose-400"
                      : log.level === "warn"
                        ? "bg-amber-500/20 text-amber-400"
                        : "text-slate-400"
                  )}
                >
                  {log.level}
                </span>
                <span className="text-slate-200 break-all">{log.message}</span>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Service Restart Confirmation Modal */}
      {restartTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
          <div className="bg-card border border-border/80 rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center gap-3 text-amber-500">
              <div className="p-2 rounded-xl bg-amber-500/10 border border-amber-500/20">
                <AlertTriangle className="size-6" />
              </div>
              <div>
                <h3 className="text-base font-bold text-foreground">Confirm Service Restart</h3>
                <p className="text-xs text-muted-foreground font-mono mt-0.5">
                  Target: <strong className="text-foreground uppercase">{restartTarget}</strong>
                </p>
              </div>
            </div>

            <p className="text-xs text-muted-foreground leading-relaxed">
              Are you sure you want to restart{" "}
              <strong className="text-foreground">{restartTarget === "all" ? "all hosted processes" : `sentinel-${restartTarget}`}</strong>?
              In production, this executes <code className="font-mono text-cyan-500">sudo systemctl restart</code> via the Fastify API.
            </p>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setRestartTarget(null)}
                disabled={restarting}
                className="px-4 py-2 text-xs font-medium rounded-xl bg-secondary text-secondary-foreground hover:bg-secondary/80 border border-border/40 transition-colors"
              >
                Cancel
              </button>

              <button
                type="button"
                onClick={() => handleRestartService(restartTarget)}
                disabled={restarting}
                className="flex items-center gap-1.5 px-4 py-2 text-xs font-medium rounded-xl bg-destructive text-destructive-foreground hover:bg-destructive/90 transition-colors shadow-xs"
              >
                {restarting ? (
                  <>
                    <RefreshCw className="size-3.5 animate-spin" />
                    <span>Restarting...</span>
                  </>
                ) : (
                  <>
                    <RotateCcw className="size-3.5" />
                    <span>Confirm Restart</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
