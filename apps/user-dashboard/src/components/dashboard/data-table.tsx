"use client";

import * as React from "react";
import { cn } from "@/lib/utils/cn";
import {
  Search,
  SlidersHorizontal,
  ChevronLeft,
  ChevronRight,
  ArrowUpDown,
  Download,
  Filter,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  RefreshCw,
} from "lucide-react";

export interface DataRow {
  id: string;
  timestamp: string;
  category: string;
  event: string;
  actor: string;
  latencyMs: number;
  status: "success" | "warning" | "error" | "syncing";
  payloadSize: string;
}

const mockLogs: DataRow[] = [
  {
    id: "LOG-98241",
    timestamp: "2026-08-02 18:24:43",
    category: "log_manager",
    event: "Burst backfill completed (500 logs processed)",
    actor: "worker-01",
    latencyMs: 8.8,
    status: "success",
    payloadSize: "412 KB",
  },
  {
    id: "LOG-98240",
    timestamp: "2026-08-02 18:24:35",
    category: "stocks_module",
    event: "Ledger sync postponed (Log backfill ongoing)",
    actor: "worker-03",
    latencyMs: 14.2,
    status: "warning",
    payloadSize: "68 KB",
  },
  {
    id: "LOG-98239",
    timestamp: "2026-08-02 18:24:31",
    category: "network_ipc",
    event: "IPC Server socket listening /opt/sentinel/ipc.sock",
    actor: "systemd",
    latencyMs: 1.1,
    status: "success",
    payloadSize: "12 KB",
  },
  {
    id: "LOG-98238",
    timestamp: "2026-08-02 18:24:24",
    category: "worker_core",
    event: "Process exited status=6/ABRT core-dump auto-recovery",
    actor: "systemd",
    latencyMs: 140.7,
    status: "error",
    payloadSize: "1.4 MB",
  },
  {
    id: "LOG-98237",
    timestamp: "2026-08-02 18:22:10",
    category: "travel_sync",
    event: "Synced 11 travel destinations into PostgreSQL",
    actor: "worker-02",
    latencyMs: 3.13,
    status: "success",
    payloadSize: "84 KB",
  },
  {
    id: "LOG-98236",
    timestamp: "2026-08-02 18:20:05",
    category: "territory_activity",
    event: "Territory sector scan cycle complete",
    actor: "worker-04",
    latencyMs: 0.24,
    status: "syncing",
    payloadSize: "190 KB",
  },
];

export function DataTable() {
  const [search, setSearch] = React.useState("");
  const [density, setDensity] = React.useState<"compact" | "normal">("compact");
  const [statusFilter, setStatusFilter] = React.useState<string>("all");

  const filteredLogs = React.useMemo(() => {
    return mockLogs.filter((log) => {
      const matchesSearch =
        log.event.toLowerCase().includes(search.toLowerCase()) ||
        log.category.toLowerCase().includes(search.toLowerCase()) ||
        log.id.toLowerCase().includes(search.toLowerCase());

      const matchesStatus =
        statusFilter === "all" ? true : log.status === statusFilter;

      return matchesSearch && matchesStatus;
    });
  }, [search, statusFilter]);

  const renderStatusBadge = (status: DataRow["status"]) => {
    switch (status) {
      case "success":
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-mono font-medium bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
            <CheckCircle2 className="size-3" /> OK
          </span>
        );
      case "warning":
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-mono font-medium bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">
            <AlertTriangle className="size-3" /> WARN
          </span>
        );
      case "error":
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-mono font-medium bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20">
            <XCircle className="size-3" /> ERR
          </span>
        );
      case "syncing":
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-mono font-medium bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 border border-cyan-500/20 animate-pulse">
            <RefreshCw className="size-3 animate-spin" /> SYNC
          </span>
        );
    }
  };

  return (
    <div className="flex flex-col rounded-xl bg-card border border-border/60 shadow-xs overflow-hidden">
      {/* Table Toolbar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 p-4 border-b border-border/60 bg-muted/20">
        <div className="flex items-center gap-2 flex-1">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search logs, categories, payload..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-8 pr-3 py-1.5 text-xs bg-background rounded-lg border border-border/60 focus:outline-none focus:ring-1 focus:ring-primary text-foreground placeholder:text-muted-foreground"
            />
          </div>

          <div className="flex items-center gap-1 bg-background rounded-lg border border-border/60 p-1 text-xs">
            <Filter className="size-3.5 text-muted-foreground ml-1" />
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="bg-transparent text-xs text-foreground focus:outline-none cursor-pointer pr-1"
            >
              <option value="all">All Status</option>
              <option value="success">OK</option>
              <option value="warning">WARN</option>
              <option value="error">ERR</option>
              <option value="syncing">SYNC</option>
            </select>
          </div>
        </div>

        <div className="flex items-center gap-2 self-end sm:self-auto">
          <button
            type="button"
            onClick={() => setDensity(density === "compact" ? "normal" : "compact")}
            className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg border border-border/60 bg-background hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
          >
            <SlidersHorizontal className="size-3.5" />
            <span>{density === "compact" ? "Compact" : "Standard"}</span>
          </button>

          <button
            type="button"
            className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg border border-border/60 bg-background hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
          >
            <Download className="size-3.5" />
            <span>Export CSV</span>
          </button>
        </div>
      </div>

      {/* Table Content Container */}
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b border-border/60 bg-muted/40 text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
              <th className="py-2.5 px-4 font-semibold">Log ID</th>
              <th className="py-2.5 px-4 font-semibold">Timestamp</th>
              <th className="py-2.5 px-4 font-semibold">Category</th>
              <th className="py-2.5 px-4 font-semibold">Event Payload</th>
              <th className="py-2.5 px-4 font-semibold">Actor</th>
              <th className="py-2.5 px-4 font-semibold text-right">
                <span className="inline-flex items-center gap-1 justify-end cursor-pointer hover:text-foreground">
                  Latency <ArrowUpDown className="size-3" />
                </span>
              </th>
              <th className="py-2.5 px-4 font-semibold text-center">Status</th>
            </tr>
          </thead>

          <tbody className="divide-y divide-border/40 text-xs">
            {filteredLogs.length > 0 ? (
              filteredLogs.map((log) => (
                <tr
                  key={log.id}
                  className={cn(
                    "hover:bg-muted/30 transition-colors font-sans",
                    density === "compact" ? "py-1.5" : "py-3"
                  )}
                >
                  <td className="py-2.5 px-4 font-mono font-medium text-foreground/90">
                    {log.id}
                  </td>
                  <td className="py-2.5 px-4 font-mono text-muted-foreground whitespace-nowrap">
                    {log.timestamp}
                  </td>
                  <td className="py-2.5 px-4">
                    <span className="px-2 py-0.5 rounded-md bg-secondary text-secondary-foreground font-mono text-[11px]">
                      {log.category}
                    </span>
                  </td>
                  <td className="py-2.5 px-4 max-w-xs truncate text-foreground font-medium" title={log.event}>
                    {log.event}
                  </td>
                  <td className="py-2.5 px-4 font-mono text-muted-foreground">
                    {log.actor}
                  </td>
                  <td className="py-2.5 px-4 font-mono text-right text-foreground">
                    {log.latencyMs} ms
                  </td>
                  <td className="py-2.5 px-4 text-center">
                    {renderStatusBadge(log.status)}
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={7} className="py-8 text-center text-muted-foreground text-xs">
                  No telemetry logs matching query.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination Footer */}
      <div className="flex items-center justify-between px-4 py-3 border-t border-border/60 bg-muted/20 text-xs text-muted-foreground">
        <div>
          Showing <span className="font-mono font-semibold text-foreground">{filteredLogs.length}</span> of{" "}
          <span className="font-mono font-semibold text-foreground">90,665</span> records
        </div>

        <div className="flex items-center gap-1">
          <button
            type="button"
            disabled
            className="p-1 rounded-md border border-border/40 disabled:opacity-40"
          >
            <ChevronLeft className="size-4" />
          </button>
          <span className="px-2 font-mono text-foreground font-medium">1 / 15,111</span>
          <button
            type="button"
            className="p-1 rounded-md border border-border/40 hover:bg-muted"
          >
            <ChevronRight className="size-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
