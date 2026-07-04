"use client";

import { useState, useEffect } from "react";
import { DashboardLayout } from "@/components/dashboard-layout";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  ResponsiveContainer,
} from "recharts";
import {
  Target,
  Coins,
  Zap,
  Banknote,
  RefreshCw,
  BarChart3,
  ListCollapse,
  Info,
} from "lucide-react";
import { toast } from "sonner";
import { ErrorState } from "@/components/error-state";
import { motion, AnimatePresence } from "framer-motion";
import { useSync } from "@/hooks/use-sync";

interface ItemReward {
  id: number;
  name: string;
  amount: number;
  market_price: number;
  total_value: number;
}

interface Subcrime {
  id: number;
  name?: string;
  nerve_cost?: number;
  total: number;
  success: number;
  fail: number;
}

interface Profitability {
  cash_profit: number;
  items_profit: number;
  total_profit: number;
  profit_per_nerve: number;
  profit_per_attempt: number;
  success_rate: number;
}

interface UniqueOutcome {
  id: number;
  rewards: {
    items: Array<{ id: number; amount: number }>;
    money: { min: number; max: number } | null;
    ammo: { amount: number; type: string } | null;
  } | null;
}

interface CrimeData {
  id: number;
  name: string;
  category_id: number;
  category_name: string;
  enhancer_id: number;
  enhancer_name: string;
  unique_outcomes_count: number;
  unique_outcomes_ids: number[];
  notes: string[];
  nerve_spent: number;
  skill: number;
  progression_bonus: number;
  attempts: {
    total: number;
    success: number;
    fail: number;
    critical_fail: number;
    subcrimes: Subcrime[];
  };
  rewards: {
    money: number;
    ammo_standard: number;
    ammo_special: number;
    items: ItemReward[];
  };
  uniques: UniqueOutcome[];
  profitability: Profitability;
}

interface SyncStatus {
  lastSyncAt: string | null;
  nextRunAt: string | null;
}

interface Recommendations {
  focus_crime_id: number | null;
  reason_by_nerve: string;
  reason_by_total: string;
}

interface APIResponse {
  crimes: CrimeData[];
  syncStatus: SyncStatus;
  recommendations: Recommendations;
}

export default function CrimesPage() {
  const [data, setData] = useState<APIResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedCrimeId, setSelectedCrimeId] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState<"overview" | "charts">("overview");
  const [itemsPage, setItemsPage] = useState(0);
  const [subcrimesPage, setSubcrimesPage] = useState(0);

  const { setSyncOptions, setLastSyncedText } = useSync();

  const fetchData = async (showToast = false) => {
    setError(null);
    if (showToast) setRefreshing(true);
    try {
      const res = await fetch("/api/bot/config/personal/crimes");
      if (res.ok) {
        const json: APIResponse = await res.json();
        setData(json);

        // Auto select first crime if none selected
        if (json.crimes && json.crimes.length > 0 && selectedCrimeId === null) {
          // Default to the recommended focus crime if available
          setSelectedCrimeId(
            json.recommendations.focus_crime_id ?? json.crimes[0].id,
          );
        }

        if (showToast) {
          toast.success("Crimes history synchronized successfully");
        }
      } else {
        throw new Error(`Server returned ${res.status} ${res.statusText}`);
      }
    } catch (err: unknown) {
      console.error("Error fetching crimes data:", err);
      setError(err instanceof Error ? err.message : String(err));
      toast.error("Failed to load crimes data");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const runSyncAction = async () => {
    const toastId = toast.loading("Syncing crimes records from Torn API...");
    try {
      const res = await fetch("/api/bot/finance/sync-ledger?target=crimes", {
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
      toast.error((err as Error).message || "Failed to sync crimes records", {
        id: toastId,
      });
    }
  };

  useEffect(() => {
    setSyncOptions([
      {
        label: "Crimes Stats Sync",
        action: runSyncAction,
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
      const diff = Date.now() - new Date(data.syncStatus.lastSyncAt).getTime();
      const mins = Math.floor(diff / 60000);
      let text = "";
      if (mins < 1) text = "Just now";
      else if (mins < 60) text = `${mins}m ago`;
      else {
        const hours = Math.floor(mins / 60);
        if (hours < 24) text = `${hours}h ago`;
        else text = `${Math.floor(hours / 24)}d ago`;
      }
      setLastSyncedText(`Last synced: ${text}`);
    } else {
      setLastSyncedText("");
    }
  }, [data, setLastSyncedText]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setItemsPage(0);
    setSubcrimesPage(0);
  }, [selectedCrimeId]);

  if (loading) {
    return (
      <DashboardLayout>
        <div className="flex h-64 items-center justify-center gap-2">
          <RefreshCw className="h-6 w-6 animate-spin text-amber-500" />
          <span className="text-zinc-500 dark:text-zinc-400">
            Loading Crimes analysis...
          </span>
        </div>
      </DashboardLayout>
    );
  }

  if (error || !data) {
    return (
      <DashboardLayout>
        <div className="space-y-6">
          <div>
            <h1 className="text-2xl font-bold tracking-tight md:text-3xl font-heading">
              Crimes
            </h1>
            <p className="text-zinc-500 dark:text-zinc-400">
              Track historical crime payouts and analyze profitability metrics.
            </p>
          </div>
          <ErrorState
            title="Failed to Load Crimes Data"
            description="We were unable to connect to the bot server to retrieve your crimes database. Ensure the worker has run."
            errorDetails={error || "No response received"}
            onRetry={() => fetchData(true)}
          />
        </div>
      </DashboardLayout>
    );
  }

  const { crimes, syncStatus, recommendations } = data;

  // Calculate totals
  const totalProfit = crimes.reduce(
    (sum, c) => sum + c.profitability.total_profit,
    0,
  );
  const totalCashProfit = crimes.reduce(
    (sum, c) => sum + c.profitability.cash_profit,
    0,
  );
  const totalItemsProfit = crimes.reduce(
    (sum, c) => sum + c.profitability.items_profit,
    0,
  );
  const totalNerveSpent = crimes.reduce((sum, c) => sum + c.nerve_spent, 0);
  const totalAttempts = crimes.reduce((sum, c) => sum + c.attempts.total, 0);

  const selectedCrime =
    crimes.find((c) => c.id === selectedCrimeId) || crimes[0];
  const recommendedNerveCrimeName =
    crimes.find((c) => c.id === recommendations.focus_crime_id)?.name || "N/A";
  const recommendedTotalCrimeName =
    crimes.find(
      (c) =>
        c.profitability.total_profit ===
        Math.max(...crimes.map((x) => x.profitability.total_profit)),
    )?.name || "N/A";

  const formatCurrency = (val: number) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 0,
    }).format(val);
  };

  const formatShortCurrency = (num: number) => {
    if (num >= 1e9)
      return "$" + (num / 1e9).toFixed(1).replace(/\.0$/, "") + "b";
    if (num >= 1e6)
      return "$" + (num / 1e6).toFixed(1).replace(/\.0$/, "") + "m";
    if (num >= 1e3)
      return "$" + (num / 1e3).toFixed(1).replace(/\.0$/, "") + "k";
    return formatCurrency(num);
  };

  // Recharts Chart Config
  const chartData = crimes
    .filter((c) => c.nerve_spent > 0)
    .map((c) => ({
      name: c.name,
      profit_per_nerve: c.profitability.profit_per_nerve,
      cash_profit: c.profitability.cash_profit,
      items_profit: c.profitability.items_profit,
      total_profit: c.profitability.total_profit,
    }))
    .sort((a, b) => b.profit_per_nerve - a.profit_per_nerve);

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight md:text-3xl font-heading text-zinc-900 dark:text-zinc-50">
              Crimes Analysis
            </h1>
            <p className="text-zinc-500 dark:text-zinc-400">
              Aggregate and compare crime payouts to optimize your nerve
              spending efficiency.
            </p>
          </div>
          <div className="flex items-center gap-3">
            {/* View switcher tabs */}
            <div className="inline-flex rounded-lg p-1 bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800">
              <button
                onClick={() => setActiveTab("overview")}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                  activeTab === "overview"
                    ? "bg-white dark:bg-zinc-800 text-amber-600 dark:text-amber-400 shadow-sm"
                    : "text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200"
                }`}
              >
                <ListCollapse className="h-3.5 w-3.5" />
                Overview
              </button>
              <button
                onClick={() => setActiveTab("charts")}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                  activeTab === "charts"
                    ? "bg-white dark:bg-zinc-800 text-amber-600 dark:text-amber-400 shadow-sm"
                    : "text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200"
                }`}
              >
                <BarChart3 className="h-3.5 w-3.5" />
                Charts
              </button>
            </div>
          </div>
        </div>

        {/* Stats Grid */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Card className="border-zinc-200 dark:border-zinc-900 bg-white/50 dark:bg-zinc-950/50 backdrop-blur shadow-sm relative overflow-hidden group">
            <div className="absolute top-0 right-0 h-16 w-16 bg-amber-500/10 rounded-bl-full flex items-center justify-center transition-all group-hover:scale-110">
              <Target className="h-5 w-5 text-amber-500" />
            </div>
            <CardHeader className="pb-2">
              <CardDescription className="text-xs uppercase tracking-wider text-zinc-500">
                Focus Recommendation
              </CardDescription>
              <CardTitle className="text-xl font-bold font-heading text-amber-600 dark:text-amber-400">
                {recommendedNerveCrimeName}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
                {recommendations.reason_by_nerve}
              </p>
            </CardContent>
          </Card>

          <Card className="border-zinc-200 dark:border-zinc-900 bg-white/50 dark:bg-zinc-950/50 backdrop-blur shadow-sm relative overflow-hidden group">
            <div className="absolute top-0 right-0 h-16 w-16 bg-emerald-500/10 rounded-bl-full flex items-center justify-center transition-all group-hover:scale-110">
              <Coins className="h-5 w-5 text-emerald-500" />
            </div>
            <CardHeader className="pb-2">
              <CardDescription className="text-xs uppercase tracking-wider text-zinc-500">
                Most Profitable Crime
              </CardDescription>
              <CardTitle className="text-xl font-bold font-heading text-emerald-600 dark:text-emerald-400">
                {recommendedTotalCrimeName}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
                {recommendations.reason_by_total}
              </p>
            </CardContent>
          </Card>

          <Card className="border-zinc-200 dark:border-zinc-900 bg-white/50 dark:bg-zinc-950/50 backdrop-blur shadow-sm relative overflow-hidden group">
            <div className="absolute top-0 right-0 h-16 w-16 bg-blue-500/10 rounded-bl-full flex items-center justify-center transition-all group-hover:scale-110">
              <Banknote className="h-5 w-5 text-blue-500" />
            </div>
            <CardHeader className="pb-2">
              <CardDescription className="text-xs uppercase tracking-wider text-zinc-500">
                Total Profit Earned
              </CardDescription>
              <CardTitle className="text-2xl font-bold font-heading text-zinc-950 dark:text-zinc-50">
                {formatShortCurrency(totalProfit)}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-xs text-zinc-500 dark:text-zinc-400 flex justify-between">
                <span>Cash: {formatShortCurrency(totalCashProfit)}</span>
                <span>Items: {formatShortCurrency(totalItemsProfit)}</span>
              </div>
            </CardContent>
          </Card>

          <Card className="border-zinc-200 dark:border-zinc-900 bg-white/50 dark:bg-zinc-950/50 backdrop-blur shadow-sm relative overflow-hidden group">
            <div className="absolute top-0 right-0 h-16 w-16 bg-rose-500/10 rounded-bl-full flex items-center justify-center transition-all group-hover:scale-110">
              <Zap className="h-5 w-5 text-rose-500" />
            </div>
            <CardHeader className="pb-2">
              <CardDescription className="text-xs uppercase tracking-wider text-zinc-500">
                Total Resource Spent
              </CardDescription>
              <CardTitle className="text-2xl font-bold font-heading text-zinc-950 dark:text-zinc-50">
                {totalNerveSpent.toLocaleString()} Nerve
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
                Spent across {totalAttempts.toLocaleString()} total commit
                attempts
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Tab content */}
        {activeTab === "overview" ? (
          <div className="grid gap-6 md:grid-cols-7 items-start">
            {/* Crimes List Table */}
            <Card className="md:col-span-4 border-zinc-200 dark:border-zinc-900 bg-white/50 dark:bg-zinc-950/50 backdrop-blur shadow-sm">
              <CardHeader>
                <CardTitle className="text-lg font-bold font-heading">
                  Crimes Ledger
                </CardTitle>
                <CardDescription>
                  Select a crime to view details, subcrimes, and uniques
                  achievements.
                </CardDescription>
              </CardHeader>
              <CardContent className="p-0 sm:p-6 sm:pt-0">
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow className="hover:bg-transparent border-zinc-200 dark:border-zinc-900">
                        <TableHead className="w-45">Crime</TableHead>
                        <TableHead className="text-right">Nerve</TableHead>
                        <TableHead className="text-right">Success %</TableHead>
                        <TableHead className="text-right">
                          Total Profit
                        </TableHead>
                        <TableHead className="text-right">
                          Profit / Nerve
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {crimes.map((crime) => {
                        const isSelected = crime.id === selectedCrimeId;
                        return (
                          <TableRow
                            key={crime.id}
                            onClick={() => setSelectedCrimeId(crime.id)}
                            className={`cursor-pointer transition-all border-zinc-100 dark:border-zinc-900/60 ${
                              isSelected
                                ? "bg-amber-500/10 dark:bg-amber-500/15 text-amber-700 dark:text-amber-300 font-medium"
                                : "hover:bg-zinc-100/50 dark:hover:bg-zinc-900/40"
                            }`}
                          >
                            <TableCell className="py-3">
                              <div>
                                <div className="text-sm font-semibold">
                                  {crime.name}
                                </div>
                                <span className="text-[10px] text-zinc-500 dark:text-zinc-400 capitalize bg-zinc-100 dark:bg-zinc-900 px-1.5 py-0.5 rounded border border-zinc-200/40 dark:border-zinc-800/40 mt-1 inline-block">
                                  {crime.category_name}
                                </span>
                              </div>
                            </TableCell>
                            <TableCell className="text-right py-3 font-mono text-xs">
                              {crime.nerve_spent.toLocaleString()}
                            </TableCell>
                            <TableCell className="text-right py-3 font-mono text-xs">
                              {crime.attempts.total > 0
                                ? (
                                    crime.profitability.success_rate * 100
                                  ).toFixed(1) + "%"
                                : "0.0%"}
                            </TableCell>
                            <TableCell className="text-right py-3 font-mono text-xs font-semibold">
                              {formatShortCurrency(
                                crime.profitability.total_profit,
                              )}
                            </TableCell>
                            <TableCell className="text-right py-3">
                              <Badge
                                variant={
                                  crime.profitability.profit_per_nerve > 2000
                                    ? "default"
                                    : crime.profitability.profit_per_nerve > 500
                                      ? "secondary"
                                      : "outline"
                                }
                                className={`font-mono text-[10px] px-2 py-0.5 ${
                                  crime.profitability.profit_per_nerve > 2000
                                    ? "bg-amber-600 hover:bg-amber-700 text-white"
                                    : ""
                                }`}
                              >
                                {formatCurrency(
                                  crime.profitability.profit_per_nerve,
                                )}
                              </Badge>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>

            {/* Selected Crime Detail Panel */}
            <div className="md:col-span-3 sticky top-24">
              <AnimatePresence mode="wait">
                <motion.div
                  key={selectedCrime.id}
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  transition={{ duration: 0.15 }}
                >
                  <Card className="border-zinc-200 dark:border-zinc-900 bg-white/50 dark:bg-zinc-950/50 backdrop-blur shadow-sm flex flex-col max-h-[calc(100vh-8rem)]">
                    <CardHeader className="pb-4 border-b border-zinc-100 dark:border-zinc-900 shrink-0">
                      <div className="flex items-center justify-between">
                        <Badge className="bg-amber-500/10 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400 hover:bg-transparent">
                          ID #{selectedCrime.id}
                        </Badge>
                        {selectedCrime.enhancer_name && (
                          <span className="text-[10px] text-zinc-500 dark:text-zinc-400 font-medium bg-zinc-100 dark:bg-zinc-900 border border-zinc-200/50 dark:border-zinc-800/50 px-2 py-0.5 rounded">
                            ✨ Enhancer: {selectedCrime.enhancer_name}
                          </span>
                        )}
                      </div>
                      <CardTitle className="text-xl font-bold font-heading mt-2">
                        {selectedCrime.name}
                      </CardTitle>
                      <CardDescription className="capitalize">
                        Category: {selectedCrime.category_name} | Skill Level:{" "}
                        {selectedCrime.skill}%
                      </CardDescription>
                    </CardHeader>

                    <CardContent className="space-y-6 pt-4 flex-1 overflow-y-auto">
                      {/* Notes / Descriptions */}
                      {selectedCrime.notes.length > 0 && (
                        <div className="bg-zinc-50 dark:bg-zinc-900 p-3 rounded-lg border border-zinc-100 dark:border-zinc-900 text-xs text-zinc-600 dark:text-zinc-400 flex items-start gap-2">
                          <Info className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
                          <div>
                            {selectedCrime.notes.map((note, idx) => (
                              <p key={idx}>{note}</p>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Success / Fail Visualizer */}
                      <div className="space-y-2">
                        <div className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 flex justify-between">
                          <span>
                            Attempt Outcomes ({selectedCrime.attempts.total}{" "}
                            total)
                          </span>
                          <span className="text-emerald-500">
                            {(
                              selectedCrime.profitability.success_rate * 100
                            ).toFixed(1)}
                            % Success
                          </span>
                        </div>
                        {selectedCrime.attempts.total > 0 ? (
                          <div className="h-3 w-full rounded-full bg-zinc-100 dark:bg-zinc-900 overflow-hidden flex">
                            <div
                              title={`Success: ${selectedCrime.attempts.success}`}
                              className="bg-emerald-500 h-full"
                              style={{
                                width: `${(selectedCrime.attempts.success / selectedCrime.attempts.total) * 100}%`,
                              }}
                            />
                            <div
                              title={`Fail: ${selectedCrime.attempts.fail}`}
                              className="bg-amber-500 h-full"
                              style={{
                                width: `${(selectedCrime.attempts.fail / selectedCrime.attempts.total) * 100}%`,
                              }}
                            />
                            <div
                              title={`Critical Fail: ${selectedCrime.attempts.critical_fail}`}
                              className="bg-rose-500 h-full"
                              style={{
                                width: `${(selectedCrime.attempts.critical_fail / selectedCrime.attempts.total) * 100}%`,
                              }}
                            />
                          </div>
                        ) : (
                          <div className="h-3 w-full rounded-full bg-zinc-100 dark:bg-zinc-900" />
                        )}
                        <div className="flex justify-between text-[10px] text-zinc-400 dark:text-zinc-500">
                          <span className="flex items-center gap-1">
                            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 inline-block" />{" "}
                            Success ({selectedCrime.attempts.success})
                          </span>
                          <span className="flex items-center gap-1">
                            <span className="h-1.5 w-1.5 rounded-full bg-amber-500 inline-block" />{" "}
                            Fail ({selectedCrime.attempts.fail})
                          </span>
                          <span className="flex items-center gap-1">
                            <span className="h-1.5 w-1.5 rounded-full bg-rose-500 inline-block" />{" "}
                            Crit Fail ({selectedCrime.attempts.critical_fail})
                          </span>
                        </div>
                      </div>

                      {/* Uniques Outcomes Achieved */}
                      <div className="space-y-2">
                        <div className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 flex justify-between">
                          <span>Unique Achievements</span>
                          <span>
                            {selectedCrime.uniques.length} /{" "}
                            {selectedCrime.unique_outcomes_count} Found
                          </span>
                        </div>
                        <div className="w-full bg-zinc-100 dark:bg-zinc-900 rounded-full h-2">
                          <div
                            className="bg-amber-500 h-2 rounded-full"
                            style={{
                              width: `${
                                selectedCrime.unique_outcomes_count > 0
                                  ? (selectedCrime.uniques.length /
                                      selectedCrime.unique_outcomes_count) *
                                    100
                                  : 0
                              }%`,
                            }}
                          />
                        </div>
                        {selectedCrime.uniques.length > 0 && (
                          <div className="max-h-25 overflow-y-auto border border-zinc-200/50 dark:border-zinc-800/50 rounded-lg p-2 bg-white/30 dark:bg-zinc-950/20">
                            <div className="grid grid-cols-5 gap-1">
                              {selectedCrime.uniques.map((unique) => (
                                <div
                                  key={unique.id}
                                  title={`Unique Outcome #${unique.id}`}
                                  className="text-[9px] font-mono py-0.5 text-center bg-amber-500/10 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400 rounded border border-amber-500/20"
                                >
                                  {unique.id}
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Item Payouts breakdown */}
                      <div className="space-y-2">
                        <span className="text-xs font-semibold text-zinc-500 dark:text-zinc-400">
                          Item Rewards Earned
                        </span>
                        {selectedCrime.rewards.items.length > 0 ? (
                          <div className="space-y-2">
                            <div className="border border-zinc-200/50 dark:border-zinc-800/50 rounded-lg overflow-hidden">
                              <Table>
                                <TableHeader className="bg-zinc-50 dark:bg-zinc-900/50">
                                  <TableRow className="hover:bg-transparent border-zinc-100 dark:border-zinc-900">
                                    <TableHead className="py-1 text-[10px] h-7">
                                      Item
                                    </TableHead>
                                    <TableHead className="py-1 text-right text-[10px] h-7">
                                      Qty
                                    </TableHead>
                                    <TableHead className="py-1 text-right text-[10px] h-7">
                                      Est. Value
                                    </TableHead>
                                  </TableRow>
                                </TableHeader>
                                <TableBody>
                                  {selectedCrime.rewards.items
                                    .slice(itemsPage * 5, (itemsPage + 1) * 5)
                                    .map((item) => (
                                      <TableRow
                                        key={item.id}
                                        className="hover:bg-transparent border-zinc-100 dark:border-zinc-900/40"
                                      >
                                        <TableCell className="py-1.5 text-xs font-medium">
                                          {item.name}
                                        </TableCell>
                                        <TableCell className="py-1.5 text-right font-mono text-xs text-zinc-500">
                                          x{item.amount}
                                        </TableCell>
                                        <TableCell className="py-1.5 text-right font-mono text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                                          {formatShortCurrency(
                                            item.total_value,
                                          )}
                                        </TableCell>
                                      </TableRow>
                                    ))}
                                </TableBody>
                              </Table>
                            </div>
                            {selectedCrime.rewards.items.length > 5 && (
                              <div className="flex items-center justify-between text-[10px] px-1 text-zinc-500">
                                <span>
                                  Page {itemsPage + 1} of{" "}
                                  {Math.ceil(
                                    selectedCrime.rewards.items.length / 5,
                                  )}
                                </span>
                                <div className="flex gap-2">
                                  <button
                                    onClick={() =>
                                      setItemsPage((p) => Math.max(0, p - 1))
                                    }
                                    disabled={itemsPage === 0}
                                    className="px-2 py-1 rounded bg-zinc-100 dark:bg-zinc-900 border border-zinc-200/50 dark:border-zinc-800/50 disabled:opacity-40 cursor-pointer transition hover:bg-zinc-200 dark:hover:bg-zinc-800"
                                  >
                                    Prev
                                  </button>
                                  <button
                                    onClick={() =>
                                      setItemsPage((p) =>
                                        Math.min(
                                          Math.ceil(
                                            selectedCrime.rewards.items.length /
                                              5,
                                          ) - 1,
                                          p + 1,
                                        ),
                                      )
                                    }
                                    disabled={
                                      (itemsPage + 1) * 5 >=
                                      selectedCrime.rewards.items.length
                                    }
                                    className="px-2 py-1 rounded bg-zinc-100 dark:bg-zinc-900 border border-zinc-200/50 dark:border-zinc-800/50 disabled:opacity-40 cursor-pointer transition hover:bg-zinc-200 dark:hover:bg-zinc-800"
                                  >
                                    Next
                                  </button>
                                </div>
                              </div>
                            )}
                          </div>
                        ) : (
                          <div className="text-xs text-zinc-400 dark:text-zinc-500 text-center py-4 bg-zinc-50/50 dark:bg-zinc-900/20 rounded-lg border border-dashed border-zinc-200 dark:border-zinc-800">
                            No item rewards recorded for this crime
                          </div>
                        )}
                      </div>

                      {/* Subcrimes Table */}
                      {selectedCrime.attempts.subcrimes.length > 0 && (
                        <div className="space-y-2">
                          <span className="text-xs font-semibold text-zinc-500 dark:text-zinc-400">
                            Subcrimes Details
                          </span>
                          <div className="space-y-2">
                            <div className="border border-zinc-200/50 dark:border-zinc-800/50 rounded-lg overflow-hidden">
                              <Table>
                                <TableHeader className="bg-zinc-50 dark:bg-zinc-900/50">
                                  <TableRow className="hover:bg-transparent border-zinc-100 dark:border-zinc-900">
                                    <TableHead className="py-1 text-[10px] h-7">
                                      Subcrime
                                    </TableHead>
                                    <TableHead className="py-1 text-right text-[10px] h-7">
                                      Attempts
                                    </TableHead>
                                    <TableHead className="py-1 text-right text-[10px] h-7">
                                      Success %
                                    </TableHead>
                                  </TableRow>
                                </TableHeader>
                                <TableBody>
                                  {selectedCrime.attempts.subcrimes
                                    .slice(
                                      subcrimesPage * 5,
                                      (subcrimesPage + 1) * 5,
                                    )
                                    .map((sub) => {
                                      const subRate =
                                        sub.total > 0
                                          ? (sub.success / sub.total) * 100
                                          : 0;
                                      return (
                                        <TableRow
                                          key={sub.id}
                                          className="hover:bg-transparent border-zinc-100 dark:border-zinc-900/40"
                                        >
                                          <TableCell className="py-1.5 text-xs font-medium">
                                            {sub.name || `Subcrime #${sub.id}`}
                                            {sub.nerve_cost ? (
                                              <span className="text-[10px] text-zinc-400 font-mono ml-1.5">
                                                ({sub.nerve_cost} N)
                                              </span>
                                            ) : null}
                                          </TableCell>
                                          <TableCell className="py-1.5 text-right font-mono text-xs text-zinc-500">
                                            {sub.total.toLocaleString()}
                                          </TableCell>
                                          <TableCell className="py-1.5 text-right font-mono text-xs font-semibold">
                                            {subRate.toFixed(1)}%
                                          </TableCell>
                                        </TableRow>
                                      );
                                    })}
                                </TableBody>
                              </Table>
                            </div>
                            {selectedCrime.attempts.subcrimes.length > 5 && (
                              <div className="flex items-center justify-between text-[10px] px-1 text-zinc-500">
                                <span>
                                  Page {subcrimesPage + 1} of{" "}
                                  {Math.ceil(
                                    selectedCrime.attempts.subcrimes.length / 5,
                                  )}
                                </span>
                                <div className="flex gap-2">
                                  <button
                                    onClick={() =>
                                      setSubcrimesPage((p) =>
                                        Math.max(0, p - 1),
                                      )
                                    }
                                    disabled={subcrimesPage === 0}
                                    className="px-2 py-1 rounded bg-zinc-100 dark:bg-zinc-900 border border-zinc-200/50 dark:border-zinc-800/50 disabled:opacity-40 cursor-pointer transition hover:bg-zinc-200 dark:hover:bg-zinc-800"
                                  >
                                    Prev
                                  </button>
                                  <button
                                    onClick={() =>
                                      setSubcrimesPage((p) =>
                                        Math.min(
                                          Math.ceil(
                                            selectedCrime.attempts.subcrimes
                                              .length / 5,
                                          ) - 1,
                                          p + 1,
                                        ),
                                      )
                                    }
                                    disabled={
                                      (subcrimesPage + 1) * 5 >=
                                      selectedCrime.attempts.subcrimes.length
                                    }
                                    className="px-2 py-1 rounded bg-zinc-100 dark:bg-zinc-900 border border-zinc-200/50 dark:border-zinc-800/50 disabled:opacity-40 cursor-pointer transition hover:bg-zinc-200 dark:hover:bg-zinc-800"
                                  >
                                    Next
                                  </button>
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                    </CardContent>

                    <div className="p-4 border-t border-zinc-100 dark:border-zinc-900 bg-zinc-50/50 dark:bg-zinc-900/20 text-[10px] text-zinc-400 dark:text-zinc-500 flex justify-between shrink-0">
                      <span>
                        Nerve Cost:{" "}
                        {selectedCrime.nerve_spent > 0
                          ? (
                              selectedCrime.nerve_spent /
                              selectedCrime.attempts.total
                            ).toFixed(1)
                          : "0"}{" "}
                        per commit
                      </span>
                      <span>
                        Total Payout:{" "}
                        {formatCurrency(
                          selectedCrime.profitability.total_profit,
                        )}
                      </span>
                    </div>
                  </Card>
                </motion.div>
              </AnimatePresence>
            </div>
          </div>
        ) : (
          /* Charts Tab View */
          <div className="grid gap-6 md:grid-cols-2">
            {/* Efficiency Chart */}
            <Card className="border-zinc-200 dark:border-zinc-900 bg-white/50 dark:bg-zinc-950/50 backdrop-blur shadow-sm">
              <CardHeader>
                <CardTitle className="text-lg font-bold font-heading">
                  Nerve Efficiency
                </CardTitle>
                <CardDescription>
                  Average profit earned per single Nerve spent (higher is
                  better).
                </CardDescription>
              </CardHeader>
              <CardContent className="h-90">
                <ChartContainer
                  config={{
                    profit_per_nerve: {
                      label: "Profit / Nerve",
                      color: "#f59e0b",
                    },
                  }}
                  className="h-full w-full"
                >
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={chartData}
                      margin={{ top: 20, right: 10, left: 10, bottom: 20 }}
                    >
                      <CartesianGrid
                        strokeDasharray="3 3"
                        vertical={false}
                        stroke="#e4e4e7"
                        className="dark:stroke-zinc-800"
                      />
                      <XAxis
                        dataKey="name"
                        stroke="#888888"
                        fontSize={11}
                        tickLine={false}
                        axisLine={false}
                      />
                      <YAxis
                        stroke="#888888"
                        fontSize={11}
                        tickLine={false}
                        axisLine={false}
                        tickFormatter={(v) => `$${v}`}
                      />
                      <ChartTooltip content={<ChartTooltipContent />} />
                      <Bar
                        dataKey="profit_per_nerve"
                        fill="var(--color-profit_per_nerve)"
                        radius={[4, 4, 0, 0]}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </ChartContainer>
              </CardContent>
            </Card>

            {/* Total Profit Breakdown */}
            <Card className="border-zinc-200 dark:border-zinc-900 bg-white/50 dark:bg-zinc-950/50 backdrop-blur shadow-sm">
              <CardHeader>
                <CardTitle className="text-lg font-bold font-heading">
                  Profit Source Comparison
                </CardTitle>
                <CardDescription>
                  Comparison of Cash payout vs estimated Market Value of items
                  rewarded.
                </CardDescription>
              </CardHeader>
              <CardContent className="h-90">
                <ChartContainer
                  config={{
                    cash_profit: {
                      label: "Cash Profit",
                      color: "#10b981",
                    },
                    items_profit: {
                      label: "Item Profit",
                      color: "#3b82f6",
                    },
                  }}
                  className="h-full w-full"
                >
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={chartData}
                      margin={{ top: 20, right: 10, left: 15, bottom: 20 }}
                      stackOffset="sign"
                    >
                      <CartesianGrid
                        strokeDasharray="3 3"
                        vertical={false}
                        stroke="#e4e4e7"
                        className="dark:stroke-zinc-800"
                      />
                      <XAxis
                        dataKey="name"
                        stroke="#888888"
                        fontSize={11}
                        tickLine={false}
                        axisLine={false}
                      />
                      <YAxis
                        stroke="#888888"
                        fontSize={11}
                        tickLine={false}
                        axisLine={false}
                        tickFormatter={(v) => {
                          if (v >= 1e6) return `$${(v / 1e6).toFixed(1)}m`;
                          if (v >= 1e3) return `$${(v / 1e3).toFixed(1)}k`;
                          return `$${v}`;
                        }}
                      />
                      <ChartTooltip content={<ChartTooltipContent />} />
                      <Bar
                        dataKey="cash_profit"
                        fill="var(--color-cash_profit)"
                        stackId="a"
                      />
                      <Bar
                        dataKey="items_profit"
                        fill="var(--color-items_profit)"
                        radius={[4, 4, 0, 0]}
                        stackId="a"
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </ChartContainer>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Footer Sync Date */}
        <div className="flex justify-between items-center text-xs text-zinc-400 dark:text-zinc-500">
          <span>
            {syncStatus.lastSyncAt
              ? `Last synced: ${new Date(syncStatus.lastSyncAt).toLocaleString()}`
              : "Never synced"}
          </span>
          <span>
            {syncStatus.nextRunAt
              ? `Next scheduled sync: ${new Date(syncStatus.nextRunAt).toLocaleString()}`
              : "No scheduled sync"}
          </span>
        </div>
      </div>
    </DashboardLayout>
  );
}
