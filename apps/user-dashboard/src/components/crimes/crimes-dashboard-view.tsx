"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import {
  getCrimesAnalyticsAction,
  getCrimesCategoriesAction,
  getCrimesLogsAction,
  categorizeCrimeAction,
  initCrimesLedgerAction,
} from "@/actions/crimes";
import { CrimesStatCards, CrimesOverallStats, TopCrimeItem } from "./crimes-stat-cards";
import { CrimesDistributionCharts } from "./crimes-distribution-charts";
import { CrimesDailyProfitChart, DailyTimelineItem } from "./crimes-daily-profit-chart";
import { CrimesCategoryBreakdownView, CrimeCategoryBreakdown } from "./crimes-category-breakdown";
import { CrimesDailyLogs, CrimeLogItem } from "./crimes-daily-logs";
import { RefreshCw, Target, AlertTriangle, Database, ShieldAlert, X } from "lucide-react";
import { cn } from "@/lib/utils/cn";

export function CrimesDashboardView() {
  const [mounted, setMounted] = React.useState<boolean>(false);
  const [days, setDays] = React.useState<number>(0);
  const [isLoading, setIsLoading] = React.useState<boolean>(true);
  const [error, setError] = React.useState<string | null>(null);

  // Re-init Ledger state & Confirmation modal
  const [showConfirmModal, setShowConfirmModal] = React.useState<boolean>(false);
  const [isInitializingLedger, setIsInitializingLedger] = React.useState<boolean>(false);

  // Analytics data state
  const [overallStats, setOverallStats] = React.useState<CrimesOverallStats | null>(null);
  const [mostProfitablePerNerve, setMostProfitablePerNerve] = React.useState<TopCrimeItem | null>(null);
  const [mostProfitableRaw, setMostProfitableRaw] = React.useState<TopCrimeItem | null>(null);
  const [distributionByProfit, setDistributionByProfit] = React.useState<TopCrimeItem[]>([]);
  const [distributionByEfficiency, setDistributionByEfficiency] = React.useState<TopCrimeItem[]>([]);
  const [dailyTimeline, setDailyTimeline] = React.useState<DailyTimelineItem[]>([]);

  // Categories data state
  const [categories, setCategories] = React.useState<CrimeCategoryBreakdown[]>([]);

  // Daily Logs data state
  const [logs, setLogs] = React.useState<CrimeLogItem[]>([]);
  const [logsPagination, setLogsPagination] = React.useState({
    total: 0,
    page: 1,
    limit: 50,
    totalPages: 1,
  });
  const [selectedDate, setSelectedDate] = React.useState<string>("");
  const [selectedCrimeId, setSelectedCrimeId] = React.useState<string>("");
  const [searchQuery, setSearchQuery] = React.useState<string>("");
  const [logsLoading, setLogsLoading] = React.useState<boolean>(false);

  // Active view tab state (Overview & Charts vs Categories & Verification vs Daily Logs)
  const [subTab, setSubTab] = React.useState<"overview" | "categories" | "logs">("overview");

  React.useEffect(() => {
    setMounted(true);
  }, []);

  // Disable body scroll when confirmation modal is open
  React.useEffect(() => {
    if (showConfirmModal) {
      const originalOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      return () => {
        document.body.style.overflow = originalOverflow;
      };
    }
  }, [showConfirmModal]);

  // Load analytics & categories
  const loadData = React.useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const [analyticsRes, categoriesRes] = await Promise.all([
        getCrimesAnalyticsAction(days),
        getCrimesCategoriesAction(),
      ]);

      if (analyticsRes && analyticsRes.overall) {
        setOverallStats(analyticsRes.overall);
        setMostProfitablePerNerve(analyticsRes.mostProfitablePerNerve);
        setMostProfitableRaw(analyticsRes.mostProfitableRaw);
        setDistributionByProfit(analyticsRes.distributionByProfit || []);
        setDistributionByEfficiency(analyticsRes.distributionByEfficiency || []);
        setDailyTimeline(analyticsRes.dailyTimeline || []);
      }

      if (categoriesRes && categoriesRes.categories) {
        setCategories(categoriesRes.categories);
      }
    } catch (err) {
      console.error("Failed to load crimes dashboard data:", err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsLoading(false);
    }
  }, [days]);

  // Load logs
  const loadLogs = React.useCallback(
    async (page = 1) => {
      setLogsLoading(true);
      try {
        const res = await getCrimesLogsAction({
          date: selectedDate,
          crimeId: selectedCrimeId,
          search: searchQuery,
          page,
          limit: 50,
        });

        if (res && res.logs) {
          setLogs(res.logs);
          setLogsPagination(res.pagination || { total: 0, page: 1, limit: 50, totalPages: 1 });
        }
      } catch (err) {
        console.error("Failed to fetch crime logs:", err);
      } finally {
        setLogsLoading(false);
      }
    },
    [selectedDate, selectedCrimeId, searchQuery]
  );

  React.useEffect(() => {
    loadData();
  }, [loadData]);

  React.useEffect(() => {
    loadLogs(1);
  }, [loadLogs]);

  // Handle re-categorization action callback
  const handleCategorizeAction = async (action: string, targetCrimeId: number) => {
    await categorizeCrimeAction(action, targetCrimeId);
    await Promise.all([loadData(), loadLogs(logsPagination.page)]);
  };

  // Handle confirmed Re-initialize Crimes Ledger callback
  const handleConfirmInitLedger = async () => {
    setShowConfirmModal(false);
    setIsInitializingLedger(true);
    const toastId = toast.loading("Re-initializing Crimes Ledger... Replaying historical logs.");

    try {
      const res = await initCrimesLedgerAction();
      toast.success(res.message || "Crimes Ledger re-initialized successfully!", { id: toastId });
      await Promise.all([loadData(), loadLogs(logsPagination.page)]);
    } catch (err) {
      toast.error(`Initialization failed: ${err instanceof Error ? err.message : String(err)}`, { id: toastId });
    } finally {
      setIsInitializingLedger(false);
    }
  };

  const dangerModalContent =
    showConfirmModal && mounted ? (
      <div className="fixed inset-0 z-[9999] bg-black/80 backdrop-blur-md flex items-center justify-center p-4 overflow-y-auto">
        <div className="relative w-full max-w-md rounded-3xl border border-rose-500/30 bg-card/95 p-6 shadow-[0_0_50px_-12px_rgba(244,63,94,0.3)] space-y-6 overflow-hidden animate-in fade-in zoom-in-95 duration-200">
          {/* Ambient red radial background glow */}
          <div className="absolute -top-24 -left-24 size-48 rounded-full bg-rose-500/10 blur-3xl pointer-events-none" />

          {/* Header Row */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">

              <div>
                <h3 className="text-base font-bold text-foreground tracking-tight">Re-initialize Crimes Ledger?</h3>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setShowConfirmModal(false)}
              className="p-1.5 rounded-xl text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors cursor-pointer"
            >
              <X className="size-4" />
            </button>
          </div>

          {/* Callout Warning Card */}
          <div className="p-4 rounded-2xl bg-gradient-to-br from-rose-500/15 via-rose-500/5 to-transparent border border-rose-500/25 space-y-2 text-xs">
            <div className="flex items-center gap-2 text-rose-400 font-bold uppercase tracking-wider text-[11px]">
              <AlertTriangle className="size-4 shrink-0" />
              <span>Destructive Re-indexing</span>
            </div>
            <p className="text-rose-200/90 leading-relaxed">
              This action will wipe and re-parse all historical personal log entries into the Crime Ledger.
            </p>
          </div>

          {/* Actions */}
          <div className="flex items-center justify-end gap-3 pt-2 border-t border-border/40">
            <button
              type="button"
              onClick={() => setShowConfirmModal(false)}
              className="px-4.5 py-2.5 rounded-xl border border-border/80 text-xs font-semibold text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-all cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleConfirmInitLedger}
              className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-rose-600 via-rose-500 to-red-600 hover:from-rose-500 hover:to-red-500 text-white font-bold text-xs shadow-lg shadow-rose-600/30 hover:shadow-rose-600/50 transition-all cursor-pointer flex items-center gap-2"
            >
              <Database className="size-3.5" />
              <span>Yes, Re-initialize Ledger</span>
            </button>
          </div>
        </div>
      </div>
    ) : null;

  return (
    <div className="space-y-6">
      {/* Top Header & Navigation / Date Window Selector */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-border/40 pb-5">
        <div className="flex items-center gap-3">
          <div>
            <h1 className="text-xl font-bold text-foreground tracking-tight">Crimes Analytics</h1>
          </div>
        </div>

        {/* Control Action Buttons */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Danger Re-initialize Ledger Button */}
          <button
            type="button"
            onClick={() => setShowConfirmModal(true)}
            disabled={isInitializingLedger || isLoading}
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl border border-rose-500/40 bg-rose-500/10 text-rose-400 hover:bg-rose-600 hover:text-white font-bold text-xs transition-all disabled:opacity-50 cursor-pointer shadow-xs"
            title="High-risk: Replay and re-index all historical personal crime logs into Crime Ledger"
          >
            <Database className={cn("size-3.5", isInitializingLedger && "animate-spin")} />
            <span>{isInitializingLedger ? "Initializing..." : "Re-init Ledger"}</span>
          </button>

          {/* Date Window Picker */}
          <div className="flex items-center p-1 rounded-xl border border-border/70 bg-muted/30 text-xs">
            {[0, 7, 14, 30, 60, 90].map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setDays(d)}
                className={cn(
                  "px-2.5 py-1 rounded-lg font-medium transition-colors cursor-pointer",
                  days === d
                    ? "bg-primary text-primary-foreground font-bold shadow-xs"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {d === 0 ? "All" : `${d}d`}
              </button>
            ))}
          </div>

          {/* Refresh Button */}
          <button
            type="button"
            onClick={() => {
              loadData();
              loadLogs(logsPagination.page);
            }}
            disabled={isLoading || isInitializingLedger}
            className="p-2 rounded-xl border border-border/70 bg-card hover:bg-muted text-muted-foreground hover:text-foreground cursor-pointer transition-colors"
            title="Refresh Data"
          >
            <RefreshCw className={cn("size-4", isLoading && "animate-spin")} />
          </button>
        </div>
      </div>

      {/* Error state */}
      {error && (
        <div className="p-4 rounded-2xl bg-destructive/10 border border-destructive/20 text-xs text-destructive">
          Error loading Crimes Analytics: {error}
        </div>
      )}

      {/* Summary KPI Cards */}
      {overallStats && (
        <CrimesStatCards
          overall={overallStats}
          mostProfitablePerNerve={mostProfitablePerNerve}
          mostProfitableRaw={mostProfitableRaw}
          days={days}
        />
      )}

      {/* Navigation Sub-Tabs */}
      <div className="flex items-center gap-2 border-b border-border/40 pb-2">
        <button
          type="button"
          onClick={() => setSubTab("overview")}
          className={cn(
            "px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer",
            subTab === "overview"
              ? "bg-primary text-primary-foreground shadow-xs"
              : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
          )}
        >
          Overview & Profit Distributions
        </button>
        <button
          type="button"
          onClick={() => setSubTab("categories")}
          className={cn(
            "px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5",
            subTab === "categories"
              ? "bg-primary text-primary-foreground shadow-xs"
              : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
          )}
        >
          <span>Category & Action Verification</span>
          {overallStats && overallStats.uncategorizedCount > 0 && (
            <span className="px-1.5 py-0.2 rounded-full bg-rose-500 text-white text-[10px] font-mono">
              !
            </span>
          )}
        </button>
        <button
          type="button"
          onClick={() => setSubTab("logs")}
          className={cn(
            "px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer",
            subTab === "logs"
              ? "bg-primary text-primary-foreground shadow-xs"
              : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
          )}
        >
          Daily Logs Explorer
        </button>
      </div>

      {/* Sub-Tab View Content */}
      {subTab === "overview" && (
        <div className="space-y-6">
          <CrimesDailyProfitChart timeline={dailyTimeline} />
          <CrimesDistributionCharts
            distributionByProfit={distributionByProfit}
            distributionByEfficiency={distributionByEfficiency}
          />
        </div>
      )}

      {subTab === "categories" && (
        <CrimesCategoryBreakdownView
          categories={categories}
          onCategorizeAction={handleCategorizeAction}
          isLoading={isLoading}
        />
      )}

      {subTab === "logs" && (
        <CrimesDailyLogs
          logs={logs}
          pagination={logsPagination}
          selectedDate={selectedDate}
          selectedCrimeId={selectedCrimeId}
          searchQuery={searchQuery}
          categories={categories}
          onDateChange={setSelectedDate}
          onCrimeIdChange={setSelectedCrimeId}
          onSearchChange={setSearchQuery}
          onPageChange={(p) => loadLogs(p)}
          isLoading={logsLoading}
        />
      )}

      {/* Render Danger Confirmation Modal */}
      {dangerModalContent && createPortal(dangerModalContent, document.body)}
    </div>
  );
}
