"use client";

import { useState, useEffect } from "react";
import { toast } from "sonner";
import { motion, AnimatePresence } from "framer-motion";
import {
  Percent,
  Coins,
  Gift,
  AlertCircle,
  CircleDollarSign,
} from "lucide-react";
import { DashboardLayout } from "@/components/dashboard-layout";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ErrorState } from "@/components/error-state";
import { useSync } from "@/hooks/use-sync";

interface StockBenefit {
  stock_id: number;
  acronym: string;
  name: string;
  required_shares: number;
  held_shares: number;
  current_price: number;
  progress_pct: number;
  shares_needed: number;
  cost_to_complete: number;
  next_required_total_shares: number;
  active_increments: number;
  next_increment_apr?: number;
  payout_desc: string;
  frequency_days: number;
  payout_value: number;
  annual_payout_value: number;
  apr: number;
  is_active: boolean;
}

interface StockBenefitPayout {
  stock_id: number;
  benefit_type: string;
  quantity: number;
  value_accumulated: number;
  item_details: string; // JSON string
  updated_at: string;
}

interface PortfolioData {
  city_bank: {
    amount: number;
    profit?: number;
    principal?: number;
    timeleft: number;
    progress_pct: number;
    cayman_bank: number;
  };
  stocks: {
    total_value: number;
    benefits: StockBenefit[];
    holdings?: Array<{
      id: number;
      name: string;
      acronym: string;
      shares: number;
      price: number;
      total_value: number;
      avg_buy_price?: number;
      profit_loss?: number;
      profit_loss_pct?: number;
    }>;
  };
  syncStatus?: {
    lastSyncAt: string | null;
  };
}

function formatCurrency(num: number) {
  if (num === 0) return "$0";
  const absNum = Math.abs(num);
  let formatted = "";
  if (absNum >= 1e9) {
    formatted = "$" + (absNum / 1e9).toFixed(2) + "B";
  } else if (absNum >= 1e6) {
    formatted = "$" + (absNum / 1e6).toFixed(2) + "M";
  } else if (absNum >= 1e3) {
    formatted = "$" + (absNum / 1e3).toFixed(1) + "K";
  } else {
    formatted = "$" + absNum.toLocaleString(undefined, { maximumFractionDigits: 0 });
  }
  return num < 0 ? `-${formatted}` : formatted;
}

function formatRelativeTime(isoString: string | null) {
  if (!isoString) return "Never";
  const diff = Date.now() - new Date(isoString).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export default function PortfolioPage() {
  const [data, setData] = useState<PortfolioData | null>(null);
  const [payouts, setPayouts] = useState<StockBenefitPayout[]>([]);
  const [loading, setLoading] = useState(true);
  const [, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Sorting and Filtering
  const [sortBy, setSortBy] = useState<"apr" | "cost" | "progress">("apr");
  const [filterTab, setFilterTab] = useState<"all" | "active" | "locked">("all");
  const [timeframe, setTimeframe] = useState<"daily" | "monthly" | "yearly">("yearly");

  const { setSyncOptions, setLastSyncedText } = useSync();

  const fetchData = async (showToast = false) => {
    setError(null);
    if (showToast) setRefreshing(true);
    try {
      const [res, payoutsRes] = await Promise.all([
        fetch("/api/bot/finance/portfolio"),
        fetch("/api/bot/finance/benefit-payouts")
      ]);

      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error(errBody.error || `HTTP error! status: ${res.status}`);
      }

      const json = await res.json();
      setData(json);

      if (payoutsRes.ok) {
        const payoutsJson = await payoutsRes.json();
        setPayouts(payoutsJson);
      }

      if (showToast) {
        toast.success("Investment portfolio data loaded");
      }
    } catch (err: unknown) {
      console.error(err);
      setError((err as Error).message || "Failed to load portfolio details");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const runSyncAction = async (target: "logs" | "portfolio") => {
    const label = target === "logs" ? "financial logs" : "portfolio assets";
    const toastId = toast.loading(`Syncing ${label} from Torn API...`);
    try {
      const res = await fetch(`/api/bot/finance/sync-ledger?target=${target}`, {
        method: "POST",
      });
      if (res.ok) {
        const json = await res.json();
        toast.success(json.message || "Sync complete", { id: toastId });
        await fetchData(false);
      } else {
        throw new Error(`Sync failed with status: ${res.status}`);
      }
    } catch (err: unknown) {
      console.error(err);
      toast.error((err as Error).message || `Failed to sync ${label}`, {
        id: toastId,
      });
    }
  };

  useEffect(() => {
    setSyncOptions([
      {
        label: "Portfolio & Assets Sync",
        action: () => runSyncAction("portfolio"),
      },
      {
        label: "Financial Logs Sync",
        action: () => runSyncAction("logs"),
      },
    ]);

    return () => {
      setSyncOptions(null);
      setLastSyncedText("");
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setSyncOptions, setLastSyncedText]);

  useEffect(() => {
    if (data?.syncStatus?.lastSyncAt) {
      setLastSyncedText(`Last synced: ${formatRelativeTime(data.syncStatus.lastSyncAt)}`);
    } else {
      setLastSyncedText("");
    }
  }, [data, setLastSyncedText]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchData();
  }, []);

  if (loading && !data) {
    return (
      <DashboardLayout>
        <div className="flex h-[60vh] items-center justify-center">
          <div className="flex flex-col items-center gap-4">
            <div className="size-10 border-4 border-zinc-300 border-t-amber-500 rounded-full animate-spin" />
            <p className="text-sm font-semibold text-zinc-500 dark:text-zinc-400">
              Analyzing bank lock & stock benefits APR...
            </p>
          </div>
        </div>
      </DashboardLayout>
    );
  }

  if (error && !data) {
    return (
      <DashboardLayout>
        <div className="max-w-4xl mx-auto py-8">
          <ErrorState
            description="Could not connect to the bot server to retrieve portfolio and bank valuations."
            errorDetails={error}
            onRetry={() => fetchData(true)}
          />
        </div>
      </DashboardLayout>
    );
  }

  const { stocks } = data!;

  // 1. Calculations for top summaries
  const activeBenefits = stocks.benefits.filter(b => b.active_increments && b.active_increments >= 1);
  const totalAnnualYield = activeBenefits.reduce((sum, b) => sum + (b.annual_payout_value || 0), 0);
  const activeStockValuation = activeBenefits.reduce((sum, b) => sum + (b.held_shares * b.current_price), 0);
  const averageApr = activeStockValuation > 0 ? (totalAnnualYield / activeStockValuation) * 100 : 0;

  const totalInvestmentCost = stocks.holdings?.reduce((sum, h) => sum + (h.shares * (h.avg_buy_price ?? h.price ?? 0)), 0) || 0;
  const totalStockPL = stocks.holdings?.reduce((sum, h) => sum + (h.profit_loss ?? 0), 0) || 0;
  const totalStockPLPct = totalInvestmentCost > 0 ? (totalStockPL / totalInvestmentCost) * 100 : 0;

  const totalDividendsEarned = payouts
    .filter(p => stocks.benefits.some(b => b.stock_id === Number(p.stock_id) && (b.active_increments || 0) >= 1))
    .reduce((sum, p) => sum + Number(p.value_accumulated), 0);
  const totalRoiTillDate = totalInvestmentCost > 0 ? (totalDividendsEarned / totalInvestmentCost) * 100 : 0;

  // Filter benefits list
  const filteredBenefits = stocks.benefits.filter(b => {
    if (filterTab === "active") return (b.active_increments || 0) >= 1;
    if (filterTab === "locked") return (b.active_increments || 0) === 0;
    return true;
  });

  // Sort benefits list
  const sortedBenefits = [...filteredBenefits].sort((a, b) => {
    if (sortBy === "cost") {
      if (a.cost_to_complete === 0 && b.cost_to_complete > 0) return 1;
      if (b.cost_to_complete === 0 && a.cost_to_complete > 0) return -1;
      return a.cost_to_complete - b.cost_to_complete;
    }
    if (sortBy === "progress") {
      return b.progress_pct - a.progress_pct;
    }
    const aprA = a.next_increment_apr !== undefined && a.next_increment_apr > 0 ? a.next_increment_apr : a.apr;
    const aprB = b.next_increment_apr !== undefined && b.next_increment_apr > 0 ? b.next_increment_apr : b.apr;
    return aprB - aprA;
  });

  // Helper to map payouts to benefits
  const getPayoutsSummary = (stockId: number) => {
    const stockPayouts = payouts.filter(p => Number(p.stock_id) === Number(stockId));
    const totalVal = stockPayouts.reduce((sum, p) => sum + Number(p.value_accumulated), 0);
    const detailParts: string[] = [];
    stockPayouts.forEach(p => {
      try {
        const details = JSON.parse(p.item_details || "{}");
        Object.entries(details).forEach(([name, info]) => {
          const quantity = (info as { quantity?: number })?.quantity ?? 0;
          detailParts.push(`${quantity}x ${name}`);
        });
      } catch { }
    });
    return {
      totalVal,
      detailStr: detailParts.length > 0 ? detailParts.join(", ") : null
    };
  };

  return (
    <DashboardLayout>
      <div className="space-y-8 max-w-7xl mx-auto pb-12">
        {/* Header Block */}
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div className="flex flex-col gap-2">
            <h1 className="text-3xl font-extrabold tracking-tight text-zinc-900 dark:text-zinc-50 font-heading">
              Investments Portfolio
            </h1>
          </div>

          {/* Timeframe Toggles */}
          <div className="flex bg-zinc-100 dark:bg-zinc-900 p-0.5 rounded-lg border border-zinc-200 dark:border-zinc-800 self-start md:self-auto shadow-sm shrink-0">
            <button
              onClick={() => setTimeframe("daily")}
              className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-all cursor-pointer ${timeframe === "daily" ? "bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-50 shadow-sm" : "text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-200"}`}
            >
              Daily
            </button>
            <button
              onClick={() => setTimeframe("monthly")}
              className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-all cursor-pointer ${timeframe === "monthly" ? "bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-50 shadow-sm" : "text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-200"}`}
            >
              Monthly
            </button>
            <button
              onClick={() => setTimeframe("yearly")}
              className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-all cursor-pointer ${timeframe === "yearly" ? "bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-50 shadow-sm" : "text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-200"}`}
            >
              Yearly
            </button>
          </div>
        </div>

        {/* Top Summary Metrics */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Card className="border-zinc-200 dark:border-zinc-900 bg-white/50 dark:bg-zinc-950/50 backdrop-blur shadow-sm relative overflow-hidden group">
            <div className="absolute top-0 right-0 h-16 w-16 bg-amber-500/10 rounded-bl-full flex items-center justify-center transition-all group-hover:scale-110">
              <Coins className="h-5 w-5 text-amber-500" />
            </div>
            <CardHeader className="pb-2">
              <CardDescription className="text-xs uppercase tracking-wider font-semibold text-zinc-500 dark:text-zinc-400">
                Stock Portfolio Value
              </CardDescription>
              <CardTitle className="text-2xl font-bold font-heading text-zinc-900 dark:text-zinc-50">
                {formatCurrency(stocks.total_value)}
              </CardTitle>
              <p className={`text-[11px] font-semibold mt-0.5 flex items-center gap-1 ${totalStockPL >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>
                {totalStockPL >= 0 ? "▲" : "▼"} {formatCurrency(totalStockPL)} ({totalStockPL >= 0 ? "+" : ""}{totalStockPLPct.toFixed(2)}%)
              </p>
            </CardHeader>
          </Card>

          <Card className="border-zinc-200 dark:border-zinc-900 bg-white/50 dark:bg-zinc-950/50 backdrop-blur shadow-sm relative overflow-hidden group">
            <div className="absolute top-0 right-0 h-16 w-16 bg-emerald-500/10 rounded-bl-full flex items-center justify-center transition-all group-hover:scale-110">
              <Gift className="h-5 w-5 text-emerald-500" />
            </div>
            <CardHeader className="pb-2">
              <CardDescription className="text-xs uppercase tracking-wider font-semibold text-zinc-500 dark:text-zinc-400">
                {timeframe === "daily" ? "Est. Daily Dividends" : timeframe === "monthly" ? "Est. Monthly Dividends" : "Est. Annual Dividends"}
              </CardDescription>
              <CardTitle className="text-2xl font-bold font-heading text-emerald-600 dark:text-emerald-400">
                {formatCurrency(
                  timeframe === "daily"
                    ? totalAnnualYield / 365
                    : timeframe === "monthly"
                      ? totalAnnualYield / 12
                      : totalAnnualYield
                )}
              </CardTitle>
              <p className="text-[11px] text-zinc-400 font-semibold mt-0.5">
                Valued from active blocks
              </p>
            </CardHeader>
          </Card>

          <Card className="border-zinc-200 dark:border-zinc-900 bg-white/50 dark:bg-zinc-950/50 backdrop-blur shadow-sm relative overflow-hidden group">
            <div className="absolute top-0 right-0 h-16 w-16 bg-indigo-500/10 rounded-bl-full flex items-center justify-center transition-all group-hover:scale-110">
              <Percent className="h-5 w-5 text-indigo-500" />
            </div>
            <CardHeader className="pb-2">
              <CardDescription className="text-xs uppercase tracking-wider font-semibold text-zinc-500 dark:text-zinc-400">
                {timeframe === "daily" ? "Daily Yield" : timeframe === "monthly" ? "Monthly Yield" : "Weighted Dividend APR"}
              </CardDescription>
              <CardTitle className="text-2xl font-bold font-heading text-indigo-600 dark:text-indigo-400">
                {(
                  timeframe === "daily"
                    ? averageApr / 365
                    : timeframe === "monthly"
                      ? averageApr / 12
                      : averageApr
                ).toFixed(timeframe === "yearly" ? 2 : 4)}%
              </CardTitle>
              <p className="text-[11px] text-zinc-400 font-semibold mt-0.5">
                Yield on owned active shares
              </p>
            </CardHeader>
          </Card>

          <Card className="border-zinc-200 dark:border-zinc-900 bg-white/50 dark:bg-zinc-950/50 backdrop-blur shadow-sm relative overflow-hidden group">
            <div className="absolute top-0 right-0 h-16 w-16 bg-violet-500/10 rounded-bl-full flex items-center justify-center transition-all group-hover:scale-110">
              <CircleDollarSign className="h-5 w-5 text-violet-500" />
            </div>
            <CardHeader className="pb-2">
              <CardDescription className="text-xs uppercase tracking-wider font-semibold text-zinc-500 dark:text-zinc-400">
                Total Dividends & ROI
              </CardDescription>
              <CardTitle className="text-2xl font-bold font-heading text-violet-600 dark:text-violet-400">
                {formatCurrency(totalDividendsEarned)}
              </CardTitle>
              <p className="text-[11px] text-zinc-500 dark:text-zinc-400 font-semibold mt-0.5">
                {totalRoiTillDate.toFixed(2)}% overall ROI till date
              </p>
            </CardHeader>
          </Card>
        </div>

        {/* Filters & Control Row */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-t border-zinc-200 dark:border-zinc-900 pt-6">
          <Tabs value={filterTab} onValueChange={(val: string) => setFilterTab(val as typeof filterTab)} className="w-full sm:w-auto">
            <TabsList className="bg-zinc-100 dark:bg-zinc-900">
              <TabsTrigger value="all" className="text-xs font-semibold">All Blocks</TabsTrigger>
              <TabsTrigger value="active" className="text-xs font-semibold">Active ({activeBenefits.length})</TabsTrigger>
              <TabsTrigger value="locked" className="text-xs font-semibold">Locked ({stocks.benefits.length - activeBenefits.length})</TabsTrigger>
            </TabsList>
          </Tabs>

          <div className="flex items-center gap-2">
            <span className="text-xs text-zinc-500 dark:text-zinc-400 font-semibold">Sort by:</span>
            <select
              value={sortBy}
              onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setSortBy(e.target.value as typeof sortBy)}
              className="text-xs font-semibold bg-zinc-100 dark:bg-zinc-900 text-zinc-800 dark:text-zinc-200 border border-zinc-200 dark:border-zinc-800 rounded-lg p-2 focus:outline-none cursor-pointer"
            >
              <option value="apr">Dividend Yield (APR)</option>
              <option value="progress">Acquisition Progress</option>
              <option value="cost">Remaining Cost</option>
            </select>
          </div>
        </div>

        {/* Benefits Display Grid */}
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          <AnimatePresence mode="popLayout">
            {sortedBenefits.map((benefit) => {
              const hist = getPayoutsSummary(benefit.stock_id);
              const isActive = (benefit.active_increments || 0) >= 1;
              const hasProgress = benefit.progress_pct > 0 && !isActive;

              let cardStatus: "active" | "progressing" | "locked" = "locked";
              if (isActive) cardStatus = "active";
              else if (hasProgress) cardStatus = "progressing";

              return (
                <motion.div
                  key={benefit.acronym}
                  layout
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  transition={{ duration: 0.2 }}
                >
                  <Card className="border-zinc-200 dark:border-zinc-900 bg-white dark:bg-zinc-950/60 shadow-sm flex flex-col h-full hover:shadow-md transition-shadow relative overflow-hidden">
                    {/* Status accent bar */}
                    <div className={`absolute top-0 left-0 right-0 h-1 ${cardStatus === "active" ? "bg-emerald-500" :
                      cardStatus === "progressing" ? "bg-amber-500" : "bg-zinc-300 dark:bg-zinc-800"
                      }`} />

                    <CardHeader className="pb-3 pt-5">
                      <div className="flex items-start justify-between">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="text-lg font-bold text-zinc-900 dark:text-zinc-50 font-heading">
                              {benefit.acronym}
                            </span>
                            <span className="text-[10px] text-zinc-400 font-mono uppercase">
                              {formatCurrency(benefit.current_price)}/sh
                            </span>
                          </div>
                          <CardDescription className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5 line-clamp-1">
                            {benefit.name}
                          </CardDescription>
                        </div>

                        {cardStatus === "active" && (
                          <Badge className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-none font-bold text-[10px]">
                            Active {benefit.active_increments && benefit.active_increments > 1 ? `x${benefit.active_increments}` : ""}
                          </Badge>
                        )}
                        {cardStatus === "progressing" && (
                          <Badge className="bg-amber-500/10 text-amber-600 dark:text-amber-400 border-none font-bold text-[10px]">
                            Progressing
                          </Badge>
                        )}
                        {cardStatus === "locked" && (
                          <Badge className="bg-zinc-100 text-zinc-500 dark:bg-zinc-900 dark:text-zinc-500 border-none font-bold text-[10px]">
                            Locked
                          </Badge>
                        )}
                      </div>
                    </CardHeader>

                    <CardContent className="flex-1 flex flex-col justify-between space-y-4">
                      {/* Return Rates details */}
                      <div className="bg-zinc-50 dark:bg-zinc-900/60 rounded-xl p-3 flex items-center justify-between border border-zinc-100 dark:border-zinc-900">
                        {benefit.annual_payout_value === 0 ? (
                          <div className="flex items-center justify-between w-full py-1">
                            <span className="text-[10px] text-zinc-400 uppercase font-bold tracking-wider">
                              Yield Valuation
                            </span>
                            <Badge className="bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 border-none font-bold text-[10px] uppercase">
                              {["MCS", "MSG", "PRT"].includes(benefit.acronym) ? "Stat Payouts" : "Passive Block"}
                            </Badge>
                          </div>
                        ) : (
                          <>
                            <div>
                              <p className="text-[9px] text-zinc-400 uppercase font-bold tracking-wider">
                                {timeframe === "daily" ? "Daily Yield" : timeframe === "monthly" ? "Monthly Yield" : "Yield / APR"}
                              </p>
                              <p className="text-lg font-bold text-zinc-900 dark:text-zinc-50">
                                {(
                                  timeframe === "daily"
                                    ? benefit.apr / 365
                                    : timeframe === "monthly"
                                      ? benefit.apr / 12
                                      : benefit.apr
                                ).toFixed(timeframe === "yearly" ? 2 : 4)}%{" "}
                                <span className="text-[10px] text-zinc-400 dark:text-zinc-500 font-normal">
                                  {timeframe === "daily" ? "Daily" : timeframe === "monthly" ? "Monthly" : "APR"}
                                </span>
                              </p>
                              {benefit.next_increment_apr !== undefined && benefit.next_increment_apr > 0 && benefit.next_increment_apr !== benefit.apr && (
                                <p className="text-[10px] text-amber-600 dark:text-amber-400 font-semibold mt-0.5">
                                  Next Tier: {benefit.next_increment_apr.toFixed(2)}% APR
                                </p>
                              )}
                            </div>
                            <div className="text-right">
                              <p className="text-[9px] text-zinc-400 uppercase font-bold tracking-wider">
                                {timeframe === "daily" ? "Est. Daily Value" : timeframe === "monthly" ? "Est. Monthly Value" : "Est. Annual Value"}
                              </p>
                              <p className="text-sm font-bold text-emerald-600 dark:text-emerald-400">
                                {formatCurrency(
                                  timeframe === "daily"
                                    ? benefit.annual_payout_value / 365
                                    : timeframe === "monthly"
                                      ? benefit.annual_payout_value / 12
                                      : benefit.annual_payout_value
                                )}
                              </p>
                            </div>
                          </>
                        )}
                      </div>

                      {/* Benefit payout description */}
                      <div className="space-y-1">
                        <p className="text-[9px] text-zinc-400 uppercase font-bold tracking-wider">Benefit Block Payout</p>
                        <p className="text-xs font-medium text-zinc-800 dark:text-zinc-200 leading-relaxed flex items-start gap-1.5">
                          <Gift className="size-3.5 text-amber-500 shrink-0 mt-0.5" />
                          {benefit.payout_desc}
                        </p>
                      </div>

                      {/* Progress bar towards next increment */}
                      <div className="space-y-2 pt-2 border-t border-zinc-100 dark:border-zinc-900">
                        <div className="flex justify-between text-[10px] font-medium">
                          <span className="text-zinc-500">Shares held</span>
                          <span className="text-zinc-900 dark:text-zinc-100 font-semibold">
                            {benefit.held_shares.toLocaleString()} / {benefit.next_required_total_shares.toLocaleString()}
                          </span>
                        </div>
                        {(() => {
                          const holding = stocks.holdings?.find(h => h.id === benefit.stock_id);
                          if (!holding || holding.shares === 0) return null;
                          const plVal = holding.profit_loss ?? 0;
                          const plPct = holding.profit_loss_pct ?? 0;
                          return (
                            <div className="flex justify-between text-[10px] font-medium">
                              <span className="text-zinc-500">Stock Profit/Loss</span>
                              <span className={`font-semibold ${plVal >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>
                                {plVal >= 0 ? "+" : ""}{formatCurrency(plVal)} ({plVal >= 0 ? "+" : ""}{plPct.toFixed(2)}%)
                              </span>
                            </div>
                          );
                        })()}
                        <div className="w-full bg-zinc-100 dark:bg-zinc-900 h-1.5 rounded-full overflow-hidden">
                          <div
                            className={`h-1.5 rounded-full transition-all duration-300 ${cardStatus === "active" ? "bg-emerald-500" :
                              cardStatus === "progressing" ? "bg-amber-500" : "bg-zinc-300 dark:bg-zinc-700"
                              }`}
                            style={{ width: `${benefit.progress_pct}%` }}
                          />
                        </div>

                        {benefit.shares_needed > 0 && (
                          <div className="flex justify-between items-center text-[10px] text-zinc-400">
                            <span>Next tier needs:</span>
                            <span className="font-mono text-zinc-600 dark:text-zinc-300">
                              {benefit.shares_needed.toLocaleString()} sh ({formatCurrency(benefit.cost_to_complete)})
                              {benefit.next_increment_apr !== undefined && benefit.next_increment_apr > 0 && (
                                <span className="text-amber-600 dark:text-amber-400 ml-1">
                                  ({benefit.next_increment_apr.toFixed(2)}% APR)
                                </span>
                              )}
                            </span>
                          </div>
                        )}
                      </div>

                      {/* Historical aggregation section */}
                      {(() => {
                        const holding = stocks.holdings?.find(h => h.id === benefit.stock_id);
                        const avgBuyPrice = holding?.avg_buy_price || benefit.current_price;
                        const activeCost = benefit.held_shares * avgBuyPrice;
                        const roiTillDate = activeCost > 0 ? (hist.totalVal / activeCost) * 100 : 0;

                        return (
                          <div className="bg-zinc-50/50 dark:bg-zinc-900/30 rounded-xl p-3 border border-dashed border-zinc-200 dark:border-zinc-800 space-y-1">
                            <div className="flex items-center justify-between">
                              <span className="text-[9px] text-zinc-400 uppercase font-bold tracking-wider flex items-center gap-1">
                                <CircleDollarSign className="size-3 text-zinc-400" />
                                Dividends Earned
                              </span>
                              <div className="text-right">
                                <span className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400">
                                  {formatCurrency(hist.totalVal)}
                                </span>
                                {hist.totalVal > 0 && activeCost > 0 && (
                                  <span className="text-[9px] text-zinc-400 font-mono ml-1">
                                    ({roiTillDate.toFixed(2)}% ROI)
                                  </span>
                                )}
                              </div>
                            </div>
                            {hist.detailStr ? (
                              <p className="text-[10px] text-zinc-500 dark:text-zinc-400 leading-snug line-clamp-1 italic">
                                Gotten: {hist.detailStr}
                              </p>
                            ) : (
                              <p className="text-[10px] text-zinc-400 dark:text-zinc-500 italic">
                                No dividend payouts tracked yet.
                              </p>
                            )}
                          </div>
                        );
                      })()}
                    </CardContent>
                  </Card>
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>

        {/* Empty state warning if no benefits match */}
        {sortedBenefits.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-center border border-dashed border-zinc-200 dark:border-zinc-800 rounded-2xl bg-white dark:bg-zinc-950/20">
            <AlertCircle className="h-10 w-10 text-zinc-400 mb-2 animate-bounce" />
            <p className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">No stock benefits match filters</p>
            <p className="text-xs text-zinc-500 mt-1">Try switching to all or active benefit blocks view.</p>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
