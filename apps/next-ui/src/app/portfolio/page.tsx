"use client";

import { useState, useEffect } from "react";
import { toast } from "sonner";
import { motion, AnimatePresence } from "framer-motion";
import {
  TrendingUp,
  Percent,
  Calculator,
  Lock,
  Unlock,
  Coins,
  RefreshCw,

  BadgeAlert,
  ArrowUpRight,
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


interface StockBenefit {
  acronym: string;
  name: string;
  required_shares: number;
  held_shares: number;
  current_price: number;
  progress_pct: number;
  shares_needed: number;
  cost_to_complete: number;
  next_required_total_shares?: number;
  active_increments?: number;
  next_increment_apr?: number;
  payout_desc: string;
  frequency_days: number;
  payout_value: number;
  annual_payout_value: number;
  apr: number;
  is_active: boolean;
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

function formatTimeleft(seconds: number) {
  if (seconds <= 0) return "Matured";
  const days = Math.floor(seconds / (24 * 3600));
  const hours = Math.floor((seconds % (24 * 3600)) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  const parts = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0 || parts.length === 0) parts.push(`${minutes}m`);

  return parts.join(" ") + " remaining";
}

export default function PortfolioPage() {
  const [data, setData] = useState<PortfolioData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Sorting
  const [sortBy, setSortBy] = useState<"apr" | "cost" | "progress">("apr");

  const fetchData = async (showToast = false) => {
    setError(null);
    if (showToast) setRefreshing(true);
    try {
      const res = await fetch("/api/bot/finance/portfolio");

      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error(errBody.error || `HTTP error! status: ${res.status}`);
      }

      const json = await res.json();
      setData(json);
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

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchData();
  }, []);


  if (loading) {
    return (
      <DashboardLayout>
        <div className="flex h-[60vh] items-center justify-center">
          <div className="flex flex-col items-center gap-2">
            <RefreshCw className="h-8 w-8 text-amber-500 animate-spin" />
            <p className="text-sm font-semibold text-zinc-500 dark:text-zinc-400">
              Analysing bank lock & stock benefits APR...
            </p>
          </div>
        </div>
      </DashboardLayout>
    );
  }

  if (error) {
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

  const { city_bank: cityBank, stocks } = data!;

  // Sorting benefits list
  const sortedBenefits = [...stocks.benefits].sort((a, b) => {
    if (sortBy === "cost") {
      // Completed stocks (costToComplete = 0) sorted at the bottom
      if (a.cost_to_complete === 0 && b.cost_to_complete > 0) return 1;
      if (b.cost_to_complete === 0 && a.cost_to_complete > 0) return -1;
      return a.cost_to_complete - b.cost_to_complete;
    }
    if (sortBy === "progress") {
      return b.progress_pct - a.progress_pct;
    }
    return b.apr - a.apr; // Default sorting by APR
  });

  return (
    <DashboardLayout>
      <div className="space-y-8 max-w-7xl mx-auto pb-12">
        {/* Header Block */}
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-3xl font-extrabold tracking-tight text-zinc-900 dark:text-zinc-50 font-heading">
              Investments Portfolio
            </h1>
          </div>
          <div className="flex items-center gap-2 self-start md:self-center">
            <button
              onClick={() => fetchData(true)}
              disabled={refreshing}
              className="flex h-9 items-center justify-center gap-2 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-4 text-xs font-semibold text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-900 transition-all cursor-pointer shadow-sm disabled:opacity-50"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
              Refresh
            </button>
          </div>
        </div>

        {/* Top Summary Metrics */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Card className="border-zinc-200 dark:border-zinc-900 bg-white/50 dark:bg-zinc-950/50 backdrop-blur shadow-sm relative overflow-hidden group">
            <div className="absolute top-0 right-0 h-16 w-16 bg-amber-500/10 rounded-bl-full flex items-center justify-center transition-all group-hover:scale-110">
              <Coins className="h-5 w-5 text-amber-500" />
            </div>
            <CardHeader className="pb-2">
              <CardDescription className="text-xs uppercase tracking-wider text-zinc-500">Total Investments Value</CardDescription>
              <CardTitle className="text-2xl font-bold font-heading text-zinc-900 dark:text-zinc-50">
                {formatCurrency(cityBank.amount + cityBank.cayman_bank + stocks.total_value)}
              </CardTitle>
            </CardHeader>
          </Card>

          <Card className="border-zinc-200 dark:border-zinc-900 bg-white/50 dark:bg-zinc-950/50 backdrop-blur shadow-sm relative overflow-hidden group">
            <div className="absolute top-0 right-0 h-16 w-16 bg-emerald-500/10 rounded-bl-full flex items-center justify-center transition-all group-hover:scale-110">
              <TrendingUp className="h-5 w-5 text-emerald-500" />
            </div>
            <CardHeader className="pb-2">
              <CardDescription className="text-xs uppercase tracking-wider text-zinc-500">Stock Portfolio Value</CardDescription>
              <CardTitle className="text-2xl font-bold font-heading text-emerald-600 dark:text-emerald-400">
                {formatCurrency(stocks.total_value)}
              </CardTitle>
            </CardHeader>
          </Card>


        </div>


        {/* Bank Cash-Lock Section */}
        <Card className="border-zinc-200/80 dark:border-zinc-800/80">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-lg font-bold text-zinc-950 dark:text-zinc-50">
                  City Bank Investment
                </CardTitle>

              </div>
              {cityBank.amount > 0 ? (
                cityBank.timeleft > 0 ? (
                  <Badge className="bg-amber-500/10 text-amber-600 dark:text-amber-400 border-none font-bold flex items-center gap-1">
                    <Lock className="h-3 w-3" />
                    Locked
                  </Badge>
                ) : (
                  <Badge className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-none font-bold flex items-center gap-1">
                    <Unlock className="h-3 w-3" />
                    Matured
                  </Badge>
                )
              ) : (
                <Badge className="bg-zinc-100 text-zinc-500 dark:bg-zinc-850 dark:text-zinc-400 border-none font-bold">
                  Inactive
                </Badge>
              )}
            </div>
          </CardHeader>
          <CardContent>
            {cityBank.amount === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 text-center">
                <BadgeAlert className="h-10 w-10 text-zinc-400 mb-2" />
                <p className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">No Active Investment</p>
                <p className="text-xs text-zinc-500 max-w-sm mt-0.5">
                  Go to city bank to place a term deposit of up to $2B to optimize your daily passive interest income.
                </p>
              </div>
            ) : (
              <div className="grid gap-6 md:grid-cols-3 md:items-center">
                <div className="space-y-2">
                  <div>
                    <p className="text-[10px] text-zinc-500 dark:text-zinc-400 uppercase font-bold tracking-wider">Invested Principal</p>
                    <p className="text-3xl font-extrabold text-zinc-950 dark:text-zinc-50 tracking-tight">
                      {formatCurrency(cityBank.principal || (cityBank.amount - (cityBank.profit || 0)))}
                    </p>
                  </div>
                  <div className="grid grid-cols-2 gap-2 pt-1.5 border-t border-zinc-200/60 dark:border-zinc-800/60">
                    <div>
                      <p className="text-[9px] text-zinc-500 uppercase font-bold tracking-wider">Interest Profit</p>
                      <p className="text-sm font-bold text-emerald-600 dark:text-emerald-400">
                        +{formatCurrency(cityBank.profit || 0)}
                      </p>
                    </div>
                    <div>
                      <p className="text-[9px] text-zinc-500 uppercase font-bold tracking-wider">Matured Total</p>
                      <p className="text-sm font-bold text-zinc-900 dark:text-zinc-100">
                        {formatCurrency(cityBank.amount)}
                      </p>
                    </div>
                  </div>
                  <p className="text-[10px] text-zinc-400">
                    Lock Duration: {cityBank.progress_pct > 0 && cityBank.progress_pct < 100
                      ? Math.round((cityBank.timeleft / (1 - cityBank.progress_pct / 100)) / (24 * 3600))
                      : "—"} Days
                  </p>
                </div>

                {/* Progress Visualizer */}
                <div className="space-y-2 col-span-2">
                  <div className="flex justify-between text-xs">
                    <span className="text-zinc-600 dark:text-zinc-400 font-medium">
                      Maturity Progress ({cityBank.progress_pct.toFixed(1)}%)
                    </span>
                    <span className={`font-semibold ${cityBank.timeleft > 0 ? "text-amber-500" : "text-emerald-500"}`}>
                      {formatTimeleft(cityBank.timeleft)}
                    </span>
                  </div>
                  <div className="h-3 w-full bg-zinc-100 dark:bg-zinc-900 rounded-full overflow-hidden border border-zinc-200/50 dark:border-zinc-800/50 flex">
                    <motion.div
                      className={`h-full ${cityBank.timeleft > 0 ? "bg-amber-500" : "bg-emerald-500"}`}
                      initial={{ width: 0 }}
                      animate={{ width: `${cityBank.progress_pct}%` }}
                      transition={{ duration: 0.8 }}
                    />
                  </div>
                  <div className="flex justify-between text-[9px] text-zinc-400">
                    <span>Lock Start</span>
                    <span>Payout Maturity</span>
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Your Stock Holdings Section */}
        {stocks.holdings && stocks.holdings.length > 0 && (
          <Card className="border-zinc-200/80 dark:border-zinc-800/80">
            <CardHeader className="pb-3">
              <div className="flex flex-col gap-1">
                <CardTitle className="text-lg font-bold text-zinc-950 dark:text-zinc-50">
                  Stock Market Holdings
                </CardTitle>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-xs text-left border-collapse">
                  <thead>
                    <tr className="border-b border-zinc-200 dark:border-zinc-800 text-zinc-500 font-bold">
                      <th className="px-4 py-3">Ticker</th>
                      <th className="px-4 py-3">Company Name</th>
                      <th className="px-4 py-3 text-right">Shares Owned</th>
                      <th className="px-4 py-3 text-right">Avg. Buy Price</th>
                      <th className="px-4 py-3 text-right">Current Price</th>
                      <th className="px-4 py-3 text-right">Position Value</th>
                      <th className="px-4 py-3 text-right">Profit / Loss (P/L)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stocks.holdings.map((holding) => (
                      <tr
                        key={holding.id}
                        className="border-b border-zinc-100 dark:border-zinc-800/60 hover:bg-zinc-50/40 dark:hover:bg-zinc-900/30 transition-colors"
                      >
                        <td className="px-4 py-3 font-bold text-zinc-900 dark:text-zinc-100">
                          <Badge className="bg-amber-500/10 text-amber-600 dark:text-amber-400 border-none font-extrabold text-[10px]">
                            {holding.acronym}
                          </Badge>
                        </td>
                        <td className="px-4 py-3 text-zinc-600 dark:text-zinc-400 font-medium">
                          {holding.name}
                        </td>
                        <td className="px-4 py-3 text-right font-semibold text-zinc-900 dark:text-zinc-200">
                          {holding.shares.toLocaleString()}
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-zinc-500">
                          {formatCurrency(holding.avg_buy_price || holding.price)}
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-zinc-500">
                          {formatCurrency(holding.price)}
                        </td>
                        <td className="px-4 py-3 text-right font-bold text-zinc-950 dark:text-zinc-50 font-mono">
                          {formatCurrency(holding.total_value)}
                        </td>
                        <td className={`px-4 py-3 text-right font-bold font-mono ${(holding.profit_loss || 0) >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"
                          }`}>
                          {(holding.profit_loss || 0) >= 0 ? "+" : ""}
                          {formatCurrency(holding.profit_loss || 0)}
                          <span className="text-[10px] ml-1 font-normal opacity-85">
                            ({(holding.profit_loss || 0) >= 0 ? "+" : ""}
                            {(holding.profit_loss_pct || 0).toFixed(1)}%)
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Stock Benefits Tracker Card */}
        <div className="space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-xl font-bold text-zinc-950 dark:text-zinc-50 flex items-center gap-2">
                <Percent className="h-5 w-5 text-amber-500" />
                Dividend Block Benefits
              </h2>

            </div>

            {/* Sorting Tabs */}
            <Tabs defaultValue="apr" value={sortBy} onValueChange={(val) => setSortBy(val as "apr" | "cost" | "progress")} className="w-auto">
              <TabsList className="bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg p-0.5">
                <TabsTrigger value="apr" className="flex items-center gap-1.5 px-3 py-1 text-[10px] font-bold rounded-md data-[state=active]:bg-white dark:data-[state=active]:bg-zinc-950 cursor-pointer">
                  <Calculator className="h-3 w-3" />
                  ROI APR Sort
                </TabsTrigger>
                <TabsTrigger value="cost" className="flex items-center gap-1.5 px-3 py-1 text-[10px] font-bold rounded-md data-[state=active]:bg-white dark:data-[state=active]:bg-zinc-950 cursor-pointer">
                  <BadgeAlert className="h-3 w-3" />
                  Cost to complete
                </TabsTrigger>
                <TabsTrigger value="progress" className="flex items-center gap-1.5 px-3 py-1 text-[10px] font-bold rounded-md data-[state=active]:bg-white dark:data-[state=active]:bg-zinc-950 cursor-pointer">
                  <TrendingUp className="h-3 w-3" />
                  Progress
                </TabsTrigger>
              </TabsList>
            </Tabs>
          </div>

          {/* Benefits Grid */}
          <div className="grid gap-4 sm:grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
            <AnimatePresence mode="popLayout">
              {sortedBenefits.map((stock) => (
                <motion.div
                  layout
                  key={stock.acronym}
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  transition={{ duration: 0.2 }}
                >
                  <Card className={`border-zinc-200/80 dark:border-zinc-800/80 relative overflow-hidden flex flex-col h-full ${stock.is_active ? "bg-emerald-500/[0.02] dark:bg-emerald-500/[0.01]" : ""}`}>
                    {/* Top Accent Strip */}
                    <div className={`absolute top-0 left-0 right-0 h-1 ${stock.is_active ? "bg-emerald-500" : stock.progress_pct > 0 ? "bg-amber-500" : "bg-zinc-200 dark:bg-zinc-800"}`} />

                    <CardHeader className="pb-3 pt-5">
                      <div className="flex items-start justify-between">
                        <div>
                          <div className="flex items-center gap-1.5 mb-1.5">
                            <Badge className="bg-amber-500/10 text-amber-600 dark:text-amber-400 hover:bg-amber-500/15 border-none font-extrabold text-[10px]">
                              {stock.acronym}
                            </Badge>
                            {stock.active_increments && stock.active_increments > 0 ? (
                              stock.payout_desc.includes("(Passive)") ? (
                                <Badge className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-none font-bold text-[8px] uppercase tracking-wider py-0 px-1">
                                  Active
                                </Badge>
                              ) : (
                                <Badge className="bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 border-none font-bold text-[8px] uppercase tracking-wider py-0 px-1">
                                  {stock.active_increments} Increment{stock.active_increments > 1 ? "s" : ""} Active
                                </Badge>
                              )
                            ) : stock.is_active ? (
                              <Badge className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-none font-bold text-[8px] uppercase tracking-wider py-0 px-1">
                                Active
                              </Badge>
                            ) : stock.held_shares > 0 ? (
                              <Badge className="bg-amber-500/10 text-amber-600 dark:text-amber-400 border-none font-bold text-[8px] uppercase tracking-wider py-0 px-1">
                                Progressing
                              </Badge>
                            ) : (
                              <Badge className="bg-zinc-100 text-zinc-500 dark:bg-zinc-850 dark:text-zinc-400 border-none font-bold text-[8px] uppercase tracking-wider py-0 px-1">
                                Locked
                              </Badge>
                            )}
                          </div>
                          <CardTitle className="text-sm font-bold text-zinc-900 dark:text-zinc-100 truncate max-w-[180px]">
                            {stock.name}
                          </CardTitle>
                        </div>
                        {stock.apr > 0 && (
                          <div className="text-right">
                            <p className="text-[10px] text-zinc-500 font-bold uppercase tracking-wider">Est. APR</p>
                            <p className="text-md font-extrabold text-emerald-600 dark:text-emerald-400 flex items-center justify-end">
                              {stock.apr.toFixed(1)}%
                              <ArrowUpRight className="h-3.5 w-3.5 inline ml-0.5" />
                            </p>
                          </div>
                        )}
                      </div>
                    </CardHeader>

                    <CardContent className="space-y-4 flex-1 flex flex-col justify-between">
                      {/* Payout Description */}
                      <div className="space-y-1 bg-zinc-50 dark:bg-zinc-900/60 p-2.5 rounded-lg border border-zinc-200/50 dark:border-zinc-800/40">
                        <p className="text-[10px] text-zinc-400 font-bold uppercase tracking-wider">Benefit Block Payout</p>
                        <p className="text-xs font-semibold text-zinc-800 dark:text-zinc-200">
                          {stock.payout_desc}
                        </p>
                        {stock.apr > 0 && (
                          <p className="text-[10px] text-zinc-500 mt-1">
                            Est. Value: {formatCurrency(stock.payout_value)} every {stock.frequency_days}d
                            {stock.active_increments && stock.active_increments > 1 ? ` (Yielding ${stock.active_increments}x payout)` : ""}
                            <span className="block mt-0.5 font-medium">Annual yield: {formatCurrency(stock.annual_payout_value)}</span>
                          </p>
                        )}
                      </div>

                      {/* Progress Metrics */}
                      <div className="space-y-1.5">
                        <div className="flex justify-between text-[10px]">
                          <span className="text-zinc-500 dark:text-zinc-400">
                            Shares: <strong>{stock.held_shares.toLocaleString()}</strong> / {stock.is_active && stock.next_required_total_shares ? stock.next_required_total_shares.toLocaleString() : stock.required_shares.toLocaleString()}
                          </span>
                          <span className="font-bold text-zinc-900 dark:text-zinc-50">
                            {stock.progress_pct.toFixed(1)}%
                          </span>
                        </div>
                        <div className="h-1.5 w-full bg-zinc-100 dark:bg-zinc-900 rounded-full overflow-hidden flex border border-zinc-200/50 dark:border-zinc-800/30">
                          <div
                            className={`h-full ${stock.is_active ? "bg-emerald-500" : stock.held_shares > 0 ? "bg-amber-500" : "bg-zinc-200 dark:bg-zinc-800"}`}
                            style={{ width: `${stock.progress_pct}%` }}
                          />
                        </div>
                      </div>

                      {/* Cost to Complete metric */}
                      {stock.shares_needed > 0 && (
                        <div className="border-t border-zinc-150 dark:border-zinc-850 pt-3 mt-1 flex justify-between items-center text-[10px]">
                          <div>
                            <p className="text-zinc-400 uppercase font-bold tracking-wider">
                              {stock.is_active ? "Next block cost" : "Cost to complete"}
                            </p>
                            <p className="font-bold text-zinc-800 dark:text-zinc-200 text-xs mt-0.5">
                              {formatCurrency(stock.cost_to_complete)}
                            </p>
                          </div>
                          <p className="text-zinc-400 font-medium">
                            {stock.shares_needed.toLocaleString()} shares needed
                          </p>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
