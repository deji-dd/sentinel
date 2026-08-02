"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import {
  getPersonalLogsAnalyticsAction,
  getPersonalLogsByDateAction,
  resyncPersonalLogsAction,
} from "@/actions/personal-logs";
import { cn } from "@/lib/utils/cn";
import {
  BarChart3,
  Calendar,
  Clock,
  RefreshCw,
  Search,
  Filter,
  FileText,
  ChevronLeft,
  ChevronRight,
  Database,
  CheckCircle2,
  AlertCircle,
  Copy,
  Check,
  X,
  Zap,
  TrendingUp,
  Layers,
  Sparkles,
} from "lucide-react";

interface DailySummaryItem {
  date: string;
  count: number;
  categories: Record<string, number>;
}

interface AnalyticsStats {
  totalLogs: number;
  oldestLogDate: string | null;
  newestLogDate: string | null;
  backfillStatus: string;
  logsParsedInBackfill: number;
}

interface PersonalLogItem {
  id: string;
  log: number;
  title: string | null;
  timestamp: string;
  category: string | null;
  data: any;
  createdAt: string;
  updatedAt: string;
}

function formatDateUTC(d: Date): string {
  const year = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getCategoryColor(category?: string | null): string {
  if (!category) return "bg-gray-500/15 text-gray-400 border-gray-500/30";
  const cat = category.toLowerCase();
  if (cat.includes("crime")) return "bg-rose-500/15 text-rose-400 border-rose-500/30";
  if (cat.includes("gym") || cat.includes("stat")) return "bg-emerald-500/15 text-emerald-400 border-emerald-500/30";
  if (cat.includes("stock")) return "bg-amber-500/15 text-amber-400 border-amber-500/30";
  if (cat.includes("wealth") || cat.includes("money") || cat.includes("trade")) return "bg-violet-500/15 text-violet-400 border-violet-500/30";
  if (cat.includes("travel")) return "bg-sky-500/15 text-sky-400 border-sky-500/30";
  if (cat.includes("item")) return "bg-cyan-500/15 text-cyan-400 border-cyan-500/30";
  return "bg-primary/15 text-primary border-primary/30";
}

export function PersonalLogsDashboard() {
  const todayStr = React.useMemo(() => formatDateUTC(new Date()), []);

  const [mounted, setMounted] = React.useState<boolean>(false);
  React.useEffect(() => {
    setMounted(true);
  }, []);

  // Timeframe for Analytics Chart (days)
  const [timeframeDays, setTimeframeDays] = React.useState<number>(30);
  const [analyticsData, setAnalyticsData] = React.useState<DailySummaryItem[]>([]);
  const [stats, setStats] = React.useState<AnalyticsStats | null>(null);
  const [analyticsLoading, setAnalyticsLoading] = React.useState<boolean>(true);

  // Day Log Viewer State
  const [selectedDate, setSelectedDate] = React.useState<string>(todayStr);
  const [logs, setLogs] = React.useState<PersonalLogItem[]>([]);
  const [totalLogsForDate, setTotalLogsForDate] = React.useState<number>(0);
  const [currentPage, setCurrentPage] = React.useState<number>(1);
  const [totalPages, setTotalPages] = React.useState<number>(1);
  const [selectedCategory, setSelectedCategory] = React.useState<string>("all");
  const [categoriesList, setCategoriesList] = React.useState<string[]>([]);
  const [searchQuery, setSearchQuery] = React.useState<string>("");
  const [logsLoading, setLogsLoading] = React.useState<boolean>(true);

  // Worker Re-sync State
  const [isResyncModalOpen, setIsResyncModalOpen] = React.useState<boolean>(false);
  const [resyncPreset, setResyncPreset] = React.useState<string>("7d");
  const [customFromDate, setCustomFromDate] = React.useState<string>("");
  const [customToDate, setCustomToDate] = React.useState<string>("");
  const [resyncing, setResyncing] = React.useState<boolean>(false);
  const [singleDayResyncing, setSingleDayResyncing] = React.useState<boolean>(false);

  // Inspect Raw JSON Modal State
  const [activeJsonLog, setActiveJsonLog] = React.useState<PersonalLogItem | null>(null);
  const [copied, setCopied] = React.useState<boolean>(false);

  // Lock background body scroll when any modal is active
  React.useEffect(() => {
    if (isResyncModalOpen || Boolean(activeJsonLog)) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [isResyncModalOpen, activeJsonLog]);

  // Hovered Chart Bar Info
  const [hoveredBar, setHoveredBar] = React.useState<DailySummaryItem | null>(null);

  // Fetch Analytics Summary
  const fetchAnalytics = React.useCallback(async (days: number) => {
    setAnalyticsLoading(true);
    try {
      const res = await getPersonalLogsAnalyticsAction(days);
      setAnalyticsData(res.summary || []);
      setStats(res.stats || null);
    } catch (err) {
      toast.error("Failed to load personal log analytics summary");
    } finally {
      setAnalyticsLoading(false);
    }
  }, []);

  // Fetch Logs by Selected Date
  const fetchLogsForDate = React.useCallback(
    async (date: string, page: number, category: string, search: string) => {
      setLogsLoading(true);
      try {
        const res = await getPersonalLogsByDateAction({
          date,
          page,
          limit: 50,
          category: category !== "all" ? category : undefined,
          search: search.trim() !== "" ? search : undefined,
        });
        setLogs(res.logs || []);
        setTotalLogsForDate(res.total || 0);
        setTotalPages(res.totalPages || 1);
        if (res.categories && res.categories.length > 0) {
          setCategoriesList(res.categories);
        }
      } catch (err) {
        toast.error(`Failed to load personal logs for ${date}`);
      } finally {
        setLogsLoading(false);
      }
    },
    [],
  );

  // Initial loads
  React.useEffect(() => {
    fetchAnalytics(timeframeDays);
  }, [timeframeDays, fetchAnalytics]);

  React.useEffect(() => {
    fetchLogsForDate(selectedDate, currentPage, selectedCategory, searchQuery);
  }, [selectedDate, currentPage, selectedCategory, searchQuery, fetchLogsForDate]);

  // Max daily count for chart scaling
  const maxDailyCount = React.useMemo(() => {
    if (analyticsData.length === 0) return 1;
    const max = Math.max(...analyticsData.map((d) => d.count));
    return max > 0 ? max : 1;
  }, [analyticsData]);

  // Handle Trigger Re-sync
  const handleTriggerResync = async () => {
    let fromTs: number;
    let toTs: number = Math.floor(Date.now() / 1000);

    if (resyncPreset === "today") {
      const todayDate = new Date(`${todayStr}T00:00:00.000Z`);
      fromTs = Math.floor(todayDate.getTime() / 1000);
    } else if (resyncPreset === "3d") {
      fromTs = toTs - 3 * 86400;
    } else if (resyncPreset === "7d") {
      fromTs = toTs - 7 * 86400;
    } else if (resyncPreset === "30d") {
      fromTs = toTs - 30 * 86400;
    } else {
      if (!customFromDate || !customToDate) {
        toast.error("Please select valid custom start and end dates");
        return;
      }
      fromTs = Math.floor(new Date(`${customFromDate}T00:00:00.000Z`).getTime() / 1000);
      toTs = Math.floor(new Date(`${customToDate}T23:59:59.999Z`).getTime() / 1000);
    }

    if (isNaN(fromTs) || isNaN(toTs) || fromTs >= toTs) {
      toast.error("Invalid timeframe specified. Start date must be before end date.");
      return;
    }

    setResyncing(true);
    const toastId = toast.loading("Sending re-sync command to background worker engine...");

    try {
      const res = await resyncPersonalLogsAction(fromTs, toTs);
      toast.success(res.message || "Log re-sync completed successfully!", { id: toastId });
      setIsResyncModalOpen(false);
      // Refresh analytics and logs
      fetchAnalytics(timeframeDays);
      fetchLogsForDate(selectedDate, 1, selectedCategory, searchQuery);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to execute worker re-sync", {
        id: toastId,
      });
    } finally {
      setResyncing(false);
    }
  };

  // Handle Single Day Re-sync
  const handleResyncSingleDay = async (dateStr: string) => {
    const fromTs = Math.floor(new Date(`${dateStr}T00:00:00.000Z`).getTime() / 1000);
    const toTs = Math.floor(new Date(`${dateStr}T23:59:59.999Z`).getTime() / 1000);

    setSingleDayResyncing(true);
    const toastId = toast.loading(`Requesting worker re-sync for ${dateStr} (UTC)...`);

    try {
      const res = await resyncPersonalLogsAction(fromTs, toTs);
      toast.success(res.message || `Successfully re-synced logs for ${dateStr}!`, { id: toastId });
      fetchAnalytics(timeframeDays);
      fetchLogsForDate(selectedDate, currentPage, selectedCategory, searchQuery);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : `Failed to re-sync logs for ${dateStr}`, {
        id: toastId,
      });
    } finally {
      setSingleDayResyncing(false);
    }
  };

  // Date Navigation Helpers
  const handleShiftDate = (daysShift: number) => {
    const current = new Date(`${selectedDate}T00:00:00.000Z`);
    current.setUTCDate(current.getUTCDate() + daysShift);
    const newDateStr = formatDateUTC(current);
    setSelectedDate(newDateStr);
    setCurrentPage(1);
  };

  const copyJsonToClipboard = () => {
    if (!activeJsonLog) return;
    navigator.clipboard.writeText(JSON.stringify(activeJsonLog.data, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="space-y-6">
      {/* Top Header & Re-sync Action */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pb-2 border-b border-border/40">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-foreground">
              Personal Logs Analytics
            </h1>

          </div>

        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => fetchAnalytics(timeframeDays)}
            disabled={analyticsLoading}
            className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-xl border border-border/70 bg-card hover:bg-muted/80 text-foreground transition-all cursor-pointer shadow-xs disabled:opacity-50"
            title="Refresh summary data"
          >
            <RefreshCw className={cn("size-3.5", analyticsLoading && "animate-spin")} />
            <span>Refresh</span>
          </button>

          <button
            type="button"
            onClick={() => setIsResyncModalOpen(true)}
            className="flex items-center gap-2 px-3.5 py-2 text-xs font-semibold rounded-xl bg-primary text-primary-foreground hover:bg-primary/90 transition-all cursor-pointer shadow-sm hover:shadow-md"
          >
            <Zap className="size-3.5 fill-current" />
            <span>Re-sync Timeframe</span>
          </button>
        </div>
      </div>

      {/* Top Metric Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Total Logs */}
        <div className="p-4 rounded-xl border border-border/70 bg-card/60 backdrop-blur-xs flex items-center justify-between shadow-xs">
          <div>
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Total Logs Stored</p>
            <h3 className="text-2xl font-extrabold text-foreground mt-1">
              {stats ? stats.totalLogs.toLocaleString() : "..."}
            </h3>
            <p className="text-[11px] text-muted-foreground mt-0.5 truncate">
              {stats?.oldestLogDate ? `Oldest: ${stats.oldestLogDate}` : "Backfilling..."}
            </p>
          </div>
          <div className="size-11 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center text-primary shrink-0">
            <Database className="size-5.5" />
          </div>
        </div>

        {/* Selected Date Count */}
        <div className="p-4 rounded-xl border border-border/70 bg-card/60 backdrop-blur-xs flex items-center justify-between shadow-xs">
          <div>
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              {selectedDate === todayStr ? "Today's Logs" : `Logs on ${selectedDate}`}
            </p>
            <h3 className="text-2xl font-extrabold text-foreground mt-1">
              {logsLoading ? "..." : totalLogsForDate.toLocaleString()}
            </h3>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              {selectedDate === todayStr ? "Live polling active" : "Selected day view"}
            </p>
          </div>
          <div className="size-11 rounded-xl bg-accent/10 border border-accent/20 flex items-center justify-center text-accent shrink-0">
            <FileText className="size-5.5" />
          </div>
        </div>

        {/* Active Days */}
        <div className="p-4 rounded-xl border border-border/70 bg-card/60 backdrop-blur-xs flex items-center justify-between shadow-xs">
          <div>
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Active Days ({timeframeDays}d)</p>
            <h3 className="text-2xl font-extrabold text-foreground mt-1">
              {analyticsData.filter((d) => d.count > 0).length} / {analyticsData.length}
            </h3>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              {analyticsData.length > 0
                ? `${Math.round((analyticsData.filter((d) => d.count > 0).length / analyticsData.length) * 100)}% coverage`
                : "No data"}
            </p>
          </div>
          <div className="size-11 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-500 shrink-0">
            <TrendingUp className="size-5.5" />
          </div>
        </div>

        {/* Backfill Status */}
        <div className="p-4 rounded-xl border border-border/70 bg-card/60 backdrop-blur-xs flex items-center justify-between shadow-xs">
          <div>
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Backfill Status</p>
            <div className="flex items-center gap-1.5 mt-1">
              <span
                className={cn(
                  "size-2.5 rounded-full animate-pulse",
                  stats?.backfillStatus === "completed" ? "bg-emerald-500" : "bg-amber-500"
                )}
              />
              <h3 className="text-lg font-bold text-foreground">
                {stats?.backfillStatus === "in_progress"
                  ? "In Progress"
                  : stats?.backfillStatus === "completed"
                    ? "Completed"
                    : stats?.backfillStatus
                      ? stats.backfillStatus.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
                      : "Syncing"}
              </h3>
            </div>
            <p className="text-[11px] text-muted-foreground mt-0.5 truncate">
              {stats?.logsParsedInBackfill
                ? `${stats.logsParsedInBackfill.toLocaleString()} logs parsed`
                : "History up to date"}
            </p>
          </div>
          <div className="size-11 rounded-xl bg-violet-500/10 border border-violet-500/20 flex items-center justify-center text-violet-500 shrink-0">
            <Layers className="size-5.5" />
          </div>
        </div>
      </div>

      {/* Daily Volume Bar Chart Section */}
      <div className="p-5 rounded-2xl border border-border/70 bg-card/60 backdrop-blur-xs space-y-4 shadow-sm">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-bold text-foreground flex items-center gap-2">
              <BarChart3 className="size-4.5 text-primary" /> Daily Log Volume
            </h2>
          </div>

          {/* Timeframe Selector Buttons */}
          <div className="flex items-center gap-1 bg-muted/60 p-1 rounded-xl border border-border/50 text-xs">
            {[7, 14, 30, 60, 90].map((days) => (
              <button
                key={days}
                type="button"
                onClick={() => setTimeframeDays(days)}
                className={cn(
                  "px-2.5 py-1 rounded-lg font-semibold transition-colors cursor-pointer",
                  timeframeDays === days
                    ? "bg-primary text-primary-foreground shadow-xs"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {days}d
              </button>
            ))}
          </div>
        </div>

        {/* Interactive Chart Container */}
        <div className="relative pt-6 pb-2">
          {/* SVG/HTML5 Bar Graph */}
          {analyticsLoading ? (
            <div className="h-48 flex items-center justify-center text-xs text-muted-foreground animate-pulse">
              Loading daily volume chart...
            </div>
          ) : analyticsData.length === 0 ? (
            <div className="h-48 flex items-center justify-center text-xs text-muted-foreground">
              No personal log history found for the selected timeframe.
            </div>
          ) : (
            <div className="h-48 flex items-end gap-1 sm:gap-1.5 overflow-x-auto pb-4 pt-10 px-1 scrollbar-thin">
              {analyticsData.map((d, index) => {
                const heightPct = Math.max((d.count / maxDailyCount) * 100, 3);
                const isSelected = d.date === selectedDate;
                const isToday = d.date === todayStr;
                const isFarLeft = index <= 1;
                const isFarRight = index >= analyticsData.length - 2;

                const tooltipPosClass = isFarLeft
                  ? "left-0"
                  : isFarRight
                    ? "right-0"
                    : "left-1/2 -translate-x-1/2";

                return (
                  <div
                    key={d.date}
                    onClick={() => {
                      setSelectedDate(d.date);
                      setCurrentPage(1);
                    }}
                    className="flex-1 min-w-[12px] sm:min-w-[16px] max-w-[40px] flex flex-col items-center gap-1.5 group cursor-pointer h-full justify-end relative"
                  >
                    {/* Floating Tooltip directly above hovered bar showing amount */}
                    <div
                      className={cn(
                        "absolute -top-8 opacity-0 group-hover:opacity-100 transition-all duration-150 pointer-events-none z-30 whitespace-nowrap bg-popover/95 backdrop-blur-md text-popover-foreground border border-border px-2 py-0.5 rounded-lg shadow-md text-[11px] font-semibold font-mono flex items-center gap-1",
                        tooltipPosClass
                      )}
                    >
                      <span className="text-muted-foreground">{d.date.slice(5)}:</span>
                      <span className="text-primary font-bold">{d.count} logs</span>
                    </div>

                    {/* Bar graphic */}
                    <div className="w-full relative flex items-end justify-center h-full">
                      <div
                        style={{ height: `${heightPct}%` }}
                        className={cn(
                          "w-full rounded-t-md transition-all duration-300 relative group-hover:brightness-125",
                          isSelected
                            ? "bg-gradient-to-t from-primary to-accent shadow-md shadow-primary/30 ring-2 ring-primary ring-offset-1 ring-offset-background"
                            : d.count === 0
                              ? "bg-muted/40"
                              : isToday
                                ? "bg-gradient-to-t from-emerald-600 to-emerald-400"
                                : "bg-gradient-to-t from-primary/80 to-primary/40"
                        )}
                      />
                    </div>

                    {/* Date label (shown for filtered intervals) */}
                    <span
                      className={cn(
                        "text-[9px] font-mono transition-colors truncate max-w-full",
                        isSelected
                          ? "text-primary font-bold"
                          : isToday
                            ? "text-emerald-500 font-bold"
                            : "text-muted-foreground group-hover:text-foreground"
                      )}
                    >
                      {d.date.slice(5)}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Section 3: Daily Personal Logs Viewer */}
      <div className="p-5 rounded-2xl border border-border/70 bg-card/60 backdrop-blur-xs space-y-4 shadow-sm">
        {/* Controls Toolbar */}
        <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4 border-b border-border/40 pb-4">
          {/* Date Selector & Shift Buttons */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1 bg-muted/60 p-1 rounded-xl border border-border/50">
              <button
                type="button"
                onClick={() => handleShiftDate(-1)}
                className="p-1.5 rounded-lg hover:bg-card text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                title="Previous Day"
              >
                <ChevronLeft className="size-4" />
              </button>

              <div className="flex items-center gap-1.5 px-2">
                <Calendar className="size-3.5 text-primary" />
                <input
                  type="date"
                  value={selectedDate}
                  onChange={(e) => {
                    if (e.target.value) {
                      setSelectedDate(e.target.value);
                      setCurrentPage(1);
                    }
                  }}
                  className="bg-transparent text-xs font-semibold text-foreground focus:outline-none cursor-pointer"
                />
              </div>

              <button
                type="button"
                onClick={() => handleShiftDate(1)}
                disabled={selectedDate >= todayStr}
                className="p-1.5 rounded-lg hover:bg-card text-muted-foreground hover:text-foreground transition-colors cursor-pointer disabled:opacity-30 disabled:pointer-events-none"
                title="Next Day"
              >
                <ChevronRight className="size-4" />
              </button>
            </div>

            {/* Auto Re-sync Selected Day Button */}
            <button
              type="button"
              onClick={() => handleResyncSingleDay(selectedDate)}
              disabled={singleDayResyncing}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-xl bg-primary/10 text-primary hover:bg-primary/20 border border-primary/20 transition-all cursor-pointer shadow-xs disabled:opacity-50"
              title={`Re-sync worker logs for ${selectedDate} (UTC)`}
            >
              <RefreshCw className={cn("size-3.5", singleDayResyncing && "animate-spin")} />
              <span>Re-sync {selectedDate === todayStr ? "Today" : selectedDate}</span>
            </button>

            {selectedDate !== todayStr && (
              <button
                type="button"
                onClick={() => {
                  setSelectedDate(todayStr);
                  setCurrentPage(1);
                }}
                className="px-2.5 py-1.5 text-xs font-semibold rounded-xl bg-muted/80 hover:bg-muted border border-border/60 text-muted-foreground hover:text-foreground transition-all cursor-pointer"
              >
                Jump to Today
              </button>
            )}
          </div>

          {/* Search & Category Filters */}
          <div className="flex flex-wrap items-center gap-2.5 w-full lg:w-auto">
            {/* Category Filter */}
            <div className="flex items-center gap-1.5 bg-muted/60 px-3 py-1.5 rounded-xl border border-border/50 text-xs flex-1 lg:flex-none">
              <Filter className="size-3.5 text-muted-foreground" />
              <select
                value={selectedCategory}
                onChange={(e) => {
                  setSelectedCategory(e.target.value);
                  setCurrentPage(1);
                }}
                className="bg-transparent text-xs font-medium text-foreground focus:outline-none capitalize cursor-pointer w-full"
              >
                <option value="all" className="bg-popover text-popover-foreground">
                  All Categories
                </option>
                {categoriesList.map((cat) => (
                  <option key={cat} value={cat} className="bg-popover text-popover-foreground capitalize">
                    {cat}
                  </option>
                ))}
              </select>
            </div>

            {/* Search Input */}
            <div className="relative flex-1 lg:w-60">
              <Search className="size-3.5 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Search log title or ID..."
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setCurrentPage(1);
                }}
                className="w-full bg-muted/60 border border-border/50 text-xs rounded-xl pl-9 pr-3 py-1.5 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery("")}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  <X className="size-3" />
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Logs Table */}
        <div className="rounded-xl border border-border/60 overflow-hidden bg-card/40">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-muted/80 text-muted-foreground uppercase text-[10px] tracking-wider font-semibold border-b border-border/60">
                <tr>
                  <th className="py-3 px-4 w-32">Timestamp (UTC)</th>
                  <th className="py-3 px-4 w-32">Category</th>
                  <th className="py-3 px-4">Title / Description</th>
                  <th className="py-3 px-4 text-right w-24">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40">
                {logsLoading ? (
                  <tr>
                    <td colSpan={4} className="py-12 text-center text-muted-foreground animate-pulse">
                      Loading personal logs for {selectedDate}...
                    </td>
                  </tr>
                ) : logs.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="py-12 text-center text-muted-foreground">
                      No logs found for {selectedDate}
                      {searchQuery || selectedCategory !== "all" ? " matching current filters." : "."}
                    </td>
                  </tr>
                ) : (
                  logs.map((log) => {
                    const timeStr = new Date(log.timestamp).toISOString().substring(11, 19);
                    return (
                      <tr key={log.id} className="hover:bg-muted/40 transition-colors group">
                        <td className="py-2.5 px-4 font-mono text-muted-foreground text-[11px] whitespace-nowrap">
                          {timeStr}
                        </td>
                        <td className="py-2.5 px-4 whitespace-nowrap">
                          <span
                            className={cn(
                              "inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold border capitalize",
                              getCategoryColor(log.category)
                            )}
                          >
                            {log.category || "uncategorized"}
                          </span>
                        </td>

                        <td className="py-2.5 px-4 font-medium text-foreground max-w-md truncate">
                          {log.title || `Log entry #${log.id}`}
                        </td>
                        <td className="py-2.5 px-4 text-right whitespace-nowrap">
                          <button
                            type="button"
                            onClick={() => setActiveJsonLog(log)}
                            className="px-2.5 py-1 rounded-lg bg-muted/80 hover:bg-primary/20 text-muted-foreground hover:text-primary border border-border/50 text-[11px] font-semibold transition-all cursor-pointer"
                          >
                            Inspect JSON
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Pagination Footer */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-2">
          <p className="text-xs text-muted-foreground">
            Showing {logs.length} of {totalLogsForDate.toLocaleString()} logs on {selectedDate}
          </p>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setCurrentPage((p) => Math.max(p - 1, 1))}
              disabled={currentPage <= 1 || logsLoading}
              className="flex items-center gap-1 px-3 py-1.5 rounded-xl border border-border/70 bg-card text-xs font-semibold hover:bg-muted text-foreground transition-all disabled:opacity-40 disabled:pointer-events-none cursor-pointer"
            >
              <ChevronLeft className="size-3.5" /> Previous
            </button>

            <span className="text-xs font-medium text-muted-foreground px-2">
              Page {currentPage} of {totalPages}
            </span>

            <button
              type="button"
              onClick={() => setCurrentPage((p) => Math.min(p + 1, totalPages))}
              disabled={currentPage >= totalPages || logsLoading}
              className="flex items-center gap-1 px-3 py-1.5 rounded-xl border border-border/70 bg-card text-xs font-semibold hover:bg-muted text-foreground transition-all disabled:opacity-40 disabled:pointer-events-none cursor-pointer"
            >
              Next <ChevronRight className="size-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* Modal: Select Worker Re-sync Timeframe */}
      {mounted && isResyncModalOpen && createPortal(
        <div
          className="fixed inset-0 z-[999] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto"
          onClick={(e) => {
            if (e.target === e.currentTarget) setIsResyncModalOpen(false);
          }}
        >
          <div className="w-full max-w-md bg-card border border-border rounded-2xl shadow-2xl p-6 space-y-5 my-auto animate-in fade-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between border-b border-border/40 pb-3">
              <div className="flex items-center gap-2">

                <div>
                  <h3 className="text-base font-bold text-foreground">Re-sync Logs</h3>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsResyncModalOpen(false)}
                className="text-muted-foreground hover:text-foreground cursor-pointer"
              >
                <X className="size-4" />
              </button>
            </div>

            {/* Presets */}
            <div className="space-y-2">
              <label className="text-xs font-semibold text-foreground uppercase tracking-wider">
                Select Timeframe Range
              </label>
              <div className="grid grid-cols-2 gap-2 text-xs">
                {[
                  { id: "today", label: "Today" },
                  { id: "3d", label: "Past 3 Days" },
                  { id: "7d", label: "Past 7 Days" },
                  { id: "30d", label: "Past 30 Days" },
                  { id: "custom", label: "Custom Range" },
                ].map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setResyncPreset(p.id)}
                    className={cn(
                      "py-2 px-3 rounded-xl border font-semibold transition-all cursor-pointer text-center",
                      resyncPreset === p.id
                        ? "bg-primary text-primary-foreground border-primary shadow-xs"
                        : "bg-muted/50 border-border/60 text-muted-foreground hover:text-foreground hover:bg-muted"
                    )}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Custom Range Date Pickers */}
            {resyncPreset === "custom" && (
              <div className="grid grid-cols-2 gap-3 pt-1">
                <div className="space-y-1">
                  <label className="text-[11px] font-medium text-muted-foreground">Start Date</label>
                  <input
                    type="date"
                    value={customFromDate}
                    onChange={(e) => setCustomFromDate(e.target.value)}
                    className="w-full bg-muted/60 border border-border/70 rounded-xl p-2 text-xs font-semibold text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[11px] font-medium text-muted-foreground">End Date</label>
                  <input
                    type="date"
                    value={customToDate}
                    onChange={(e) => setCustomToDate(e.target.value)}
                    className="w-full bg-muted/60 border border-border/70 rounded-xl p-2 text-xs font-semibold text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                </div>
              </div>
            )}

            {/* Action Buttons */}
            <div className="flex items-center justify-end gap-3 pt-3 border-t border-border/40">
              <button
                type="button"
                onClick={() => setIsResyncModalOpen(false)}
                disabled={resyncing}
                className="px-4 py-2 text-xs font-semibold rounded-xl border border-border/70 hover:bg-muted transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleTriggerResync}
                disabled={resyncing}
                className="flex items-center gap-2 px-4 py-2 text-xs font-semibold rounded-xl bg-primary text-primary-foreground hover:bg-primary/90 transition-all cursor-pointer shadow-sm disabled:opacity-50"
              >
                {resyncing ? (
                  <>
                    <RefreshCw className="size-3.5 animate-spin" />
                    <span>Re-syncing...</span>
                  </>
                ) : (
                  <>
                    <Zap className="size-3.5 fill-current" />
                    <span>Start Re-sync</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Modal: Inspect Raw JSON Log */}
      {mounted && activeJsonLog && createPortal(
        <div
          className="fixed inset-0 z-[999] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto"
          onClick={(e) => {
            if (e.target === e.currentTarget) setActiveJsonLog(null);
          }}
        >
          <div className="w-full max-w-2xl bg-card border border-border rounded-2xl shadow-2xl p-6 space-y-4 max-h-[85vh] flex flex-col my-auto">
            <div className="flex items-center justify-between border-b border-border/40 pb-3">
              <div>
                <h3 className="text-base font-bold text-foreground">
                  Log {activeJsonLog.id}
                </h3>
                <p className="text-xs text-muted-foreground">{activeJsonLog.title || activeJsonLog.category}</p>
              </div>
              <button
                type="button"
                onClick={() => setActiveJsonLog(null)}
                className="text-muted-foreground hover:text-foreground cursor-pointer"
              >
                <X className="size-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto rounded-xl bg-muted/80 p-4 border border-border/60 font-mono text-xs text-foreground/90 leading-relaxed scrollbar-thin">
              <pre>{JSON.stringify(activeJsonLog.data || activeJsonLog, null, 2)}</pre>
            </div>

            <div className="flex items-center justify-between pt-2 border-t border-border/40">
              <button
                type="button"
                onClick={copyJsonToClipboard}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-muted hover:bg-muted/80 border border-border/60 text-xs font-semibold text-foreground transition-all cursor-pointer"
              >
                {copied ? <Check className="size-3.5 text-emerald-500" /> : <Copy className="size-3.5" />}
                <span>{copied ? "Copied JSON" : "Copy Payload"}</span>
              </button>

              <button
                type="button"
                onClick={() => setActiveJsonLog(null)}
                className="px-4 py-1.5 text-xs font-semibold rounded-xl bg-primary text-primary-foreground hover:bg-primary/90 transition-all cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
