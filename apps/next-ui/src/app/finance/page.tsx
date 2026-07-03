"use client";

import { useState, useEffect } from "react";
import { DashboardLayout } from "@/components/dashboard-layout";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid } from "recharts";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { ErrorState } from "@/components/error-state";
import {
  RefreshCw,
  Search,
  ArrowUpRight,
  ArrowDownRight,
  Landmark,
  Coins,
  Briefcase,
  Home as HomeIcon,
  Wallet,

  Sparkles,
} from "lucide-react";
import Image from "next/image";
import { toast } from "sonner";
import { motion, AnimatePresence } from "framer-motion";

interface DailySnapshot {
  date: string;
  estimated_networth: number;
  liquid_capital: number;
  asset_valuation: number;
  inflow: number;
  outflow: number;
  net_profit: number;
}

interface LedgerTransaction {
  id: string;
  timestamp: number;
  type: "income" | "expense";
  category: string;
  title: string;
  amount: number;
  description: string;
}

interface LedgerData {
  pl: {
    income: {
      stocks: number;
      bazaar: number;
      item_market: number;
      company: number;
      crimes: number;
      outbound_mugs: number;
      faction_withdrawals: number;
      other: number;
      total: number;
    };
    expenses: {
      consumables: number;
      upkeep: number;
      loan_interest: number;
      inbound_mugs: number;
      other: number;
      total: number;
    };
    net_profit: number;
    transactions: LedgerTransaction[];
  };
  assets: {
    liquid: {
      wallet: number;
      vault: number;
      points: number;
      points_value: number;
      company_withdrawable?: number;
      total_value: number;
    };
    inventory: {
      items: Array<{
        item_id: number;
        name: string;
        quantity: number;
        value: number;
        total_value: number;
        image: string;
        type: string;
        location?: string;
      }>;
      total_value: number;
    };
    properties: {
      properties: Array<{
        id: string;
        name: string;
        value: number;
        happy: number;
        status: string;
      }>;
      total_value: number;
    };
    company: {
      name: string;
      funds: number;
      total_value: number;
      daily_income?: number;
      daily_ad_budget?: number;
      daily_wages?: number;
      daily_profit?: number;
    };
    stocks?: {
      items: Array<{
        id: number;
        name: string;
        acronym: string;
        shares: number;
        price: number;
        total_value: number;
      }>;
      total_value: number;
    };
    total_value: number;
  };
  syncStatus: {
    lastSyncAt: string | null;
    nextRunAt: string | null;
    totalLogs?: number;
    minTimestamp?: number | null;
    maxTimestamp?: number | null;
  };
}

function formatCurrency(num: number) {
  if (num === 0) return "$0";
  const isNegative = num < 0;
  const absNum = Math.abs(num);
  let formatted = "";
  if (absNum >= 1e9) {
    formatted = "$" + (absNum / 1e9).toFixed(2) + "B";
  } else if (absNum >= 1e6) {
    formatted = "$" + (absNum / 1e6).toFixed(2) + "M";
  } else {
    formatted = "$" + absNum.toLocaleString(undefined, { maximumFractionDigits: 0 });
  }
  return isNegative ? `-${formatted}` : formatted;
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

function formatTctDateTime(timestamp: number) {
  const date = new Date(timestamp * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  const year = date.getUTCFullYear();
  const month = pad(date.getUTCMonth() + 1);
  const day = pad(date.getUTCDate());
  const hours = pad(date.getUTCHours());
  const minutes = pad(date.getUTCMinutes());
  const seconds = pad(date.getUTCSeconds());
  return `${day}/${month}/${year} ${hours}:${minutes}:${seconds} TCT`;
}

export default function FinanceLedgerPage() {
  const [data, setData] = useState<LedgerData | null>(null);
  const [snapshots, setSnapshots] = useState<DailySnapshot[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [syncingNow, setSyncingNow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"pl" | "assets" | "transactions" | "performance">("pl");

  // Filters
  const [searchQuery, setSearchQuery] = useState("");
  const [txFilter, setTxFilter] = useState<"all" | "income" | "expense">("all");
  const [txCategoryFilter, setTxCategoryFilter] = useState<string>("all");

  // Inventory pagination and sorting states
  const [invSortField, setInvSortField] = useState<"name" | "type" | "quantity" | "value" | "total_value" | "location">("total_value");
  const [invSortOrder, setInvSortOrder] = useState<"asc" | "desc">("desc");
  const [invPage, setInvPage] = useState(1);
  const invItemsPerPage = 10;

  // Transaction pagination and sorting states
  const [txSortField, setTxSortField] = useState<"timestamp" | "category" | "title" | "description" | "amount">("timestamp");
  const [txSortOrder, setTxSortOrder] = useState<"asc" | "desc">("desc");
  const [txPage, setTxPage] = useState(1);
  const txItemsPerPage = 20;

  const handleInvSort = (field: typeof invSortField) => {
    if (invSortField === field) {
      setInvSortOrder(invSortOrder === "asc" ? "desc" : "asc");
    } else {
      setInvSortField(field);
      setInvSortOrder("desc");
    }
    setInvPage(1);
  };

  const handleTxSort = (field: typeof txSortField) => {
    if (txSortField === field) {
      setTxSortOrder(txSortOrder === "asc" ? "desc" : "asc");
    } else {
      setTxSortField(field);
      setTxSortOrder("desc");
    }
    setTxPage(1);
  };

  // Reset transaction page when filters change
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTxPage(1);
  }, [searchQuery, txFilter, txCategoryFilter]);

  const fetchData = async (showToast = false) => {
    setError(null);
    if (showToast) setRefreshing(true);
    try {
      const [res, snapRes] = await Promise.all([
        fetch("/api/bot/finance/ledger"),
        fetch("/api/bot/finance/daily-snapshots")
      ]);

      if (res.ok) {
        const json = await res.json();
        setData(json);
      } else {
        throw new Error(`Server error: ${res.status} ${res.statusText}`);
      }

      if (snapRes.ok) {
        const snapJson = await snapRes.json();
        setSnapshots(snapJson);
      }

      if (showToast) {
        toast.success("Finance ledger loaded successfully");
      }
    } catch (err: unknown) {
      console.error(err);
      setError((err as Error).message || "Failed to fetch finance ledger");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const triggerSync = async () => {
    setSyncingNow(true);
    const toastId = toast.loading("Syncing latest logs from Torn API...");
    try {
      const res = await fetch("/api/bot/finance/sync-ledger", {
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
      toast.error((err as Error).message || "Failed to sync ledger logs", { id: toastId });
    } finally {
      setSyncingNow(false);
    }
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchData();
  }, []);

  if (loading && !data) {
    return (
      <DashboardLayout>
        <div className="flex h-96 flex-col items-center justify-center gap-4">
          <RefreshCw className="h-10 w-10 animate-spin text-amber-500" />
          <span className="text-zinc-500 dark:text-zinc-400 font-medium">
            Analyzing financial ledgers and assets...
          </span>
        </div>
      </DashboardLayout>
    );
  }

  if (error && !data) {
    return (
      <DashboardLayout>
        <div className="space-y-6">
          <div>
            <h1 className="text-3xl font-extrabold tracking-tight text-zinc-900 dark:text-zinc-50 font-heading">
              Finance Ledger
            </h1>
            <p className="text-zinc-500 dark:text-zinc-400">
              Track cash flows and calculate real-time physical and liquid assets.
            </p>
          </div>
          <ErrorState
            title="Failed to load ledger"
            description="Could not connect to the bot server to retrieve finance logs and valuations."
            errorDetails={error}
            onRetry={() => fetchData(true)}
          />
        </div>
      </DashboardLayout>
    );
  }

  const pl = data!.pl;
  const assets = data!.assets;
  const syncStatus = data!.syncStatus;

  // Filter transactions
  const filteredTransactions = pl.transactions.filter((tx) => {
    const matchesSearch =
      tx.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      tx.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
      tx.category.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesType = txFilter === "all" || tx.type === txFilter;
    const matchesCategory = txCategoryFilter === "all" || tx.category === txCategoryFilter;
    return matchesSearch && matchesType && matchesCategory;
  });

  // Sort transactions
  const sortedTransactions = [...filteredTransactions].sort((a, b) => {
    const valA = a[txSortField];
    const valB = b[txSortField];

    if (typeof valA === "string") {
      return txSortOrder === "asc"
        ? valA.localeCompare(valB as string)
        : (valB as string).localeCompare(valA);
    } else {
      return txSortOrder === "asc"
        ? (valA as number) - (valB as number)
        : (valB as number) - (valA as number);
    }
  });

  // Paginate transactions
  const totalTxItems = sortedTransactions.length;
  const totalTxPages = Math.ceil(totalTxItems / txItemsPerPage) || 1;
  const currentTxPage = Math.min(txPage, totalTxPages);
  const paginatedTransactions = sortedTransactions.slice(
    (currentTxPage - 1) * txItemsPerPage,
    currentTxPage * txItemsPerPage
  );

  // Sort inventory
  const sortedInventoryItems = [...assets.inventory.items].sort((a, b) => {
    const valA = a[invSortField];
    const valB = b[invSortField];

    if (typeof valA === "string") {
      return invSortOrder === "asc"
        ? valA.localeCompare(valB as string)
        : (valB as string).localeCompare(valA);
    } else {
      return invSortOrder === "asc"
        ? (valA as number) - (valB as number)
        : (valB as number) - (valA as number);
    }
  });

  // Paginate inventory
  const totalInvItems = sortedInventoryItems.length;
  const totalInvPages = Math.ceil(totalInvItems / invItemsPerPage) || 1;
  const currentInvPage = Math.min(invPage, totalInvPages);
  const paginatedInventoryItems = sortedInventoryItems.slice(
    (currentInvPage - 1) * invItemsPerPage,
    currentInvPage * invItemsPerPage
  );

  // Calculate ledger totals and distribution percentages
  const totalAssets = assets.total_value;
  const stocksTotal = assets.stocks?.total_value || 0;
  const liquidPct = totalAssets > 0 ? (assets.liquid.total_value / totalAssets) * 100 : 0;
  const inventoryPct = totalAssets > 0 ? (assets.inventory.total_value / totalAssets) * 100 : 0;
  const propertiesPct = totalAssets > 0 ? (assets.properties.total_value / totalAssets) * 100 : 0;
  const companyPct = totalAssets > 0 ? (assets.company.total_value / totalAssets) * 100 : 0;
  const stocksPct = totalAssets > 0 ? (stocksTotal / totalAssets) * 100 : 0;

  const renderInvSortHeader = (field: typeof invSortField, label: string, alignRight = false) => {
    const isActive = invSortField === field;
    return (
      <TableHead
        className={`font-bold cursor-pointer select-none hover:text-zinc-950 dark:hover:text-zinc-50 transition-colors ${alignRight ? "text-right" : ""}`}
        onClick={() => handleInvSort(field)}
      >
        <span className={`inline-flex items-center gap-1 ${alignRight ? "justify-end w-full" : ""}`}>
          {label}
          {isActive ? (
            <span className="text-[10px] text-amber-500 font-bold">{invSortOrder === "asc" ? "▲" : "▼"}</span>
          ) : (
            <span className="text-[10px] text-zinc-300 dark:text-zinc-700 opacity-60">⇅</span>
          )}
        </span>
      </TableHead>
    );
  };

  const renderTxSortHeader = (field: typeof txSortField, label: string, alignRight = false) => {
    const isActive = txSortField === field;
    return (
      <TableHead
        className={`font-bold cursor-pointer select-none hover:text-zinc-950 dark:hover:text-zinc-50 transition-colors ${alignRight ? "text-right" : ""}`}
        onClick={() => handleTxSort(field)}
      >
        <span className={`inline-flex items-center gap-1 ${alignRight ? "justify-end w-full" : ""}`}>
          {label}
          {isActive ? (
            <span className="text-[10px] text-amber-500 font-bold">{txSortOrder === "asc" ? "▲" : "▼"}</span>
          ) : (
            <span className="text-[10px] text-zinc-300 dark:text-zinc-700 opacity-60">⇅</span>
          )}
        </span>
      </TableHead>
    );
  };

  return (
    <DashboardLayout>
      <div className="space-y-8 max-w-7xl mx-auto pb-12">
        {/* Header Block */}
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="flex items-center gap-2 mb-1">

              <span className="text-xs text-zinc-500 dark:text-zinc-500">
                Last synced: {formatRelativeTime(syncStatus.lastSyncAt)}
              </span>
            </div>
            <h1 className="text-3xl font-extrabold tracking-tight text-zinc-900 dark:text-zinc-50 font-heading">
              Finance Ledger
            </h1>

            {syncStatus.totalLogs !== undefined && (
              <p className="text-xs text-zinc-400 dark:text-zinc-500 mt-1.5 flex items-center gap-1.5">
                <span className={`inline-block h-1.5 w-1.5 rounded-full ${syncStatus.totalLogs > 0 ? "bg-emerald-500 animate-pulse" : "bg-amber-500"}`} />
                {syncStatus.totalLogs > 0 ? (
                  <span>
                    Synced: <strong>{syncStatus.totalLogs} logs</strong> from{" "}
                    <strong>{formatTctDateTime(syncStatus.minTimestamp!)}</strong> to{" "}
                    <strong>{formatTctDateTime(syncStatus.maxTimestamp!)}</strong>
                  </span>
                ) : (
                  <span>No logs cached in database. Click <strong>Sync Now</strong> to pull logs since launch.</span>
                )}
              </p>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => fetchData(true)}
              disabled={refreshing}
              className="flex h-10 items-center justify-center gap-2 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-4 text-xs font-semibold text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-900 disabled:opacity-50 transition-all cursor-pointer"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
              Reload
            </button>
            <button
              onClick={triggerSync}
              disabled={syncingNow}
              className="flex h-10 items-center justify-center gap-2 rounded-lg bg-amber-500 hover:bg-amber-600 dark:bg-amber-600 dark:hover:bg-amber-700 px-4 text-xs font-semibold text-white disabled:opacity-50 transition-all cursor-pointer shadow-sm"
            >
              <Sparkles className={`h-3.5 w-3.5 ${syncingNow ? "animate-pulse" : ""}`} />
              Sync Now
            </button>
          </div>
        </div>

        {/* Wealth Summary Cards */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Card className="border-zinc-200 dark:border-zinc-900 bg-white/50 dark:bg-zinc-950/50 backdrop-blur shadow-sm relative overflow-hidden group">
            <div className="absolute top-0 right-0 h-16 w-16 bg-amber-500/10 rounded-bl-full flex items-center justify-center transition-all group-hover:scale-110">
              <Landmark className="h-5 w-5 text-amber-500" />
            </div>
            <CardHeader className="pb-2">
              <CardDescription className="text-xs uppercase tracking-wider text-zinc-500">Estimated Net Worth</CardDescription>
              <CardTitle className="text-2xl font-bold font-heading text-zinc-900 dark:text-zinc-50">
                {formatCurrency(totalAssets)}
              </CardTitle>
            </CardHeader>
          </Card>

          <Card className="border-zinc-200 dark:border-zinc-900 bg-white/50 dark:bg-zinc-950/50 backdrop-blur shadow-sm relative overflow-hidden group">
            <div className="absolute top-0 right-0 h-16 w-16 bg-emerald-500/10 rounded-bl-full flex items-center justify-center transition-all group-hover:scale-110">
              <Wallet className="h-5 w-5 text-emerald-500" />
            </div>
            <CardHeader className="pb-2">
              <CardDescription className="text-xs uppercase tracking-wider text-zinc-500">Liquid Capital</CardDescription>
              <CardTitle className="text-2xl font-bold font-heading text-emerald-600 dark:text-emerald-400">
                {formatCurrency(assets.liquid.total_value)}
              </CardTitle>
            </CardHeader>
          </Card>

          <Card className="border-zinc-200 dark:border-zinc-900 bg-white/50 dark:bg-zinc-950/50 backdrop-blur shadow-sm relative overflow-hidden group">
            <div className="absolute top-0 right-0 h-16 w-16 bg-violet-500/10 rounded-bl-full flex items-center justify-center transition-all group-hover:scale-110">
              <Sparkles className="h-5 w-5 text-violet-500" />
            </div>
            <CardHeader className="pb-2">
              <CardDescription className="text-xs uppercase tracking-wider text-zinc-500">
                Avg Net Profit
                {snapshots.length > 0 && (
                  <span className="ml-1 normal-case font-normal text-zinc-400">
                    ({snapshots.length}d avg)
                  </span>
                )}
              </CardDescription>
              <CardTitle className="text-2xl font-bold font-heading text-violet-600 dark:text-violet-400">
                {snapshots.length > 0
                  ? formatCurrency(Math.round(snapshots.reduce((sum, s) => sum + Number(s.net_profit), 0) / snapshots.length))
                  : formatCurrency(pl.net_profit)}
              </CardTitle>
            </CardHeader>
          </Card>

          <Card className="border-zinc-200 dark:border-zinc-900 bg-white/50 dark:bg-zinc-950/50 backdrop-blur shadow-sm relative overflow-hidden group">
            <div className={`absolute top-0 right-0 h-16 w-16 ${pl.net_profit >= 0 ? "bg-emerald-500/10" : "bg-red-500/10"} rounded-bl-full flex items-center justify-center transition-all group-hover:scale-110`}>
              {pl.net_profit >= 0
                ? <ArrowUpRight className="h-5 w-5 text-emerald-500" />
                : <ArrowDownRight className="h-5 w-5 text-red-500" />}
            </div>
            <CardHeader className="pb-2">
              <CardDescription className="text-xs uppercase tracking-wider text-zinc-500">Net Profit (Today)</CardDescription>
              <CardTitle className={`text-2xl font-bold font-heading ${pl.net_profit >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>
                {formatCurrency(pl.net_profit)}
              </CardTitle>
            </CardHeader>
          </Card>
        </div>

        {/* Wealth Allocation Progress */}
        <Card className="border-zinc-200/80 dark:border-zinc-800/80">
          <CardContent className="p-4 md:p-6">
            <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between mb-4">
              <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 flex items-center gap-1.5">
                <Coins className="h-4 w-4 text-amber-500" />
                Asset Allocation breakdown
              </h3>
              <span className="text-xs text-zinc-500 dark:text-zinc-400">
                Diversification of physical reserves vs liquid funds
              </span>
            </div>

            {/* Multi-segment progress bar */}
            <div className="w-full h-3 rounded-full bg-zinc-200 dark:bg-zinc-800 flex overflow-hidden">
              <div
                className="bg-emerald-500 h-full transition-all duration-500"
                style={{ width: `${liquidPct}%` }}
                title={`Liquid Capital: ${liquidPct.toFixed(1)}%`}
              />
              <div
                className="bg-blue-500 h-full transition-all duration-500"
                style={{ width: `${inventoryPct}%` }}
                title={`Inventory: ${inventoryPct.toFixed(1)}%`}
              />
              <div
                className="bg-indigo-500 h-full transition-all duration-500"
                style={{ width: `${propertiesPct}%` }}
                title={`Properties: ${propertiesPct.toFixed(1)}%`}
              />
              <div
                className="bg-purple-500 h-full transition-all duration-500"
                style={{ width: `${companyPct}%` }}
                title={`Company: ${companyPct.toFixed(1)}%`}
              />
              <div
                className="bg-amber-500 h-full transition-all duration-500"
                style={{ width: `${stocksPct}%` }}
                title={`Stocks: ${stocksPct.toFixed(1)}%`}
              />
            </div>

            {/* Labels Grid */}
            <div className="grid grid-cols-2 gap-4 md:grid-cols-5 mt-4">
              <div className="flex items-center gap-2.5">
                <span className="h-2.5 w-2.5 rounded-full bg-emerald-500 shrink-0" />
                <div>
                  <p className="text-xs font-semibold text-zinc-950 dark:text-zinc-50">Liquid Capital</p>
                  <p className="text-[10px] text-zinc-500">{liquidPct.toFixed(1)}% • {formatCurrency(assets.liquid.total_value)}</p>
                </div>
              </div>
              <div className="flex items-center gap-2.5">
                <span className="h-2.5 w-2.5 rounded-full bg-blue-500 shrink-0" />
                <div>
                  <p className="text-xs font-semibold text-zinc-950 dark:text-zinc-50">Inventory Reserve</p>
                  <p className="text-[10px] text-zinc-500">{inventoryPct.toFixed(1)}% • {formatCurrency(assets.inventory.total_value)}</p>
                </div>
              </div>
              <div className="flex items-center gap-2.5">
                <span className="h-2.5 w-2.5 rounded-full bg-indigo-500 shrink-0" />
                <div>
                  <p className="text-xs font-semibold text-zinc-950 dark:text-zinc-50">Properties Reserve</p>
                  <p className="text-[10px] text-zinc-500">{propertiesPct.toFixed(1)}% • {formatCurrency(assets.properties.total_value)}</p>
                </div>
              </div>
              <div className="flex items-center gap-2.5">
                <span className="h-2.5 w-2.5 rounded-full bg-purple-500 shrink-0" />
                <div>
                  <p className="text-xs font-semibold text-zinc-950 dark:text-zinc-50">Company Equity</p>
                  <p className="text-[10px] text-zinc-500">{companyPct.toFixed(1)}% • {formatCurrency(assets.company.total_value)}</p>
                </div>
              </div>
              <div className="flex items-center gap-2.5">
                <span className="h-2.5 w-2.5 rounded-full bg-amber-500 shrink-0" />
                <div>
                  <p className="text-xs font-semibold text-zinc-950 dark:text-zinc-50">Stock Portfolio</p>
                  <p className="text-[10px] text-zinc-500">{stocksPct.toFixed(1)}% • {formatCurrency(stocksTotal)}</p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Tab Selection */}
        <div className="mb-6">
          <Tabs defaultValue="pl" value={activeTab} onValueChange={(val) => setActiveTab(val as "pl" | "assets" | "transactions" | "performance")} className="w-full">
            <TabsList className="grid max-w-3xl grid-cols-4 p-0 bg-zinc-100/80 dark:bg-zinc-900/80 border border-zinc-200 dark:border-zinc-800 rounded-lg h-full">
              <TabsTrigger value="pl" className="data-[state=active]:bg-white dark:data-[state=active]:bg-zinc-950 font-semibold text-xs">P&L Ledger</TabsTrigger>
              <TabsTrigger value="performance" className="data-[state=active]:bg-white dark:data-[state=active]:bg-zinc-950 font-semibold text-xs">Daily Performance</TabsTrigger>
              <TabsTrigger value="assets" className="data-[state=active]:bg-white dark:data-[state=active]:bg-zinc-950 font-semibold text-xs">Asset Ledger</TabsTrigger>
              <TabsTrigger value="transactions" className="data-[state=active]:bg-white dark:data-[state=active]:bg-zinc-950 font-semibold text-xs">Transaction Logs ({filteredTransactions.length})</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>

        {/* Tab Content Rendering */}
        <div className="min-h-[400px]">
          <AnimatePresence mode="wait">
            {activeTab === "performance" && (
              <motion.div
                key="performance-tab"
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -15 }}
                transition={{ duration: 0.2 }}
                className="space-y-6"
              >
                {/* Recharts chart */}
                <Card className="border-zinc-200/80 dark:border-zinc-800/80">
                  <CardHeader>
                    <CardTitle className="text-lg font-bold text-zinc-950 dark:text-zinc-50">
                      Daily Net Profit & Net Worth Trends
                    </CardTitle>
                    <CardDescription>
                      Performance overview over the last 30 snapshots.
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    {snapshots.length === 0 ? (
                      <div className="flex h-64 flex-col items-center justify-center text-center text-zinc-500">
                        <p className="font-semibold text-sm">No Performance Data Yet</p>
                        <p className="text-xs text-zinc-400 max-w-sm mt-0.5">
                          Daily snapshots will populate here as the background worker records them over time.
                        </p>
                      </div>
                    ) : (
                      <div className="space-y-8">
                        {(() => {
                          const chartConfig: ChartConfig = {
                            net_profit: { label: "Daily Net Profit", color: "#10b981" },
                            estimated_networth: { label: "Net Worth", color: "#f59e0b" },
                          };
                          return (
                            <ChartContainer config={chartConfig} className="h-[350px] w-full">
                              <AreaChart data={snapshots} margin={{ top: 4, right: 4, left: 4, bottom: 4 }}>
                                <defs>
                                  <linearGradient id="colorProfit" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="5%" stopColor="#10b981" stopOpacity={0.15} />
                                    <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                                  </linearGradient>
                                  <linearGradient id="colorNetworth" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.15} />
                                    <stop offset="95%" stopColor="#f59e0b" stopOpacity={0} />
                                  </linearGradient>
                                </defs>
                                <CartesianGrid vertical={false} stroke="rgba(113,113,122,0.15)" />
                                <XAxis
                                  dataKey="date"
                                  stroke="#71717a"
                                  fontSize={10}
                                  tickLine={false}
                                  axisLine={false}
                                />
                                <YAxis
                                  stroke="#71717a"
                                  fontSize={10}
                                  tickLine={false}
                                  axisLine={false}
                                  tickFormatter={(val: number) => formatCurrency(val)}
                                  width={72}
                                />
                                <ChartTooltip
                                  content={
                                    <ChartTooltipContent
                                      formatter={(value, name) => [
                                        <span key="v" className="font-mono font-bold tabular-nums">{formatCurrency(Number(value))}</span>,
                                        chartConfig[name as string]?.label ?? name,
                                      ]}
                                    />
                                  }
                                />
                                <Area
                                  type="monotone"
                                  dataKey="net_profit"
                                  stroke="#10b981"
                                  fillOpacity={1}
                                  fill="url(#colorProfit)"
                                  strokeWidth={2}
                                />
                                <Area
                                  type="monotone"
                                  dataKey="estimated_networth"
                                  stroke="#f59e0b"
                                  fillOpacity={1}
                                  fill="url(#colorNetworth)"
                                  strokeWidth={2}
                                />
                              </AreaChart>
                            </ChartContainer>
                          );
                        })()}

                        {/* Snapshots History Table */}
                        <div className="rounded-md border border-zinc-200/80 dark:border-zinc-800/80 overflow-hidden">
                          <Table>
                            <TableHeader className="bg-zinc-50 dark:bg-zinc-900/50">
                              <TableRow>
                                <TableHead className="font-bold">Date</TableHead>
                                <TableHead className="font-bold text-right">Net Worth</TableHead>
                                <TableHead className="font-bold text-right">Liquid Capital</TableHead>
                                <TableHead className="font-bold text-right">Assets Value</TableHead>
                                <TableHead className="font-bold text-right">Daily Inflow</TableHead>
                                <TableHead className="font-bold text-right">Daily Outflow</TableHead>
                                <TableHead className="font-bold text-right">Daily Net Profit</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {[...snapshots].reverse().map((snap) => (
                                <TableRow key={snap.date}>
                                  <TableCell className="font-mono text-xs">{snap.date}</TableCell>
                                  <TableCell className="text-right font-semibold text-zinc-950 dark:text-zinc-50">{formatCurrency(Number(snap.estimated_networth))}</TableCell>
                                  <TableCell className="text-right text-emerald-600 dark:text-emerald-400 font-medium">{formatCurrency(Number(snap.liquid_capital))}</TableCell>
                                  <TableCell className="text-right text-blue-600 dark:text-blue-400 font-medium">{formatCurrency(Number(snap.asset_valuation))}</TableCell>
                                  <TableCell className="text-right text-zinc-600 dark:text-zinc-400">{formatCurrency(Number(snap.inflow))}</TableCell>
                                  <TableCell className="text-right text-zinc-600 dark:text-zinc-400">{formatCurrency(Number(snap.outflow))}</TableCell>
                                  <TableCell className={`text-right font-bold ${Number(snap.net_profit) >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>
                                    {formatCurrency(Number(snap.net_profit))}
                                  </TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </motion.div>
            )}
            {activeTab === "pl" && (
              <motion.div
                key="pl-tab"
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -15 }}
                transition={{ duration: 0.2 }}
                className="grid gap-6 md:grid-cols-2"
              >
                {/* Income Ledger Card */}
                <Card className="border-zinc-200/80 dark:border-zinc-800/80">
                  <CardHeader>
                    <CardTitle className="text-md font-bold text-zinc-950 dark:text-zinc-50 flex items-center gap-2">
                      <div className="p-1 rounded bg-emerald-500/10 text-emerald-500">
                        <ArrowUpRight className="h-4 w-4" />
                      </div>
                      Inflows (Passive & Active)
                    </CardTitle>

                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="flex justify-between items-center bg-zinc-50 dark:bg-zinc-900/40 p-3 rounded-lg">
                      <span className="text-xs font-bold text-zinc-500 uppercase tracking-wider">Total Inflows</span>
                      <span className="text-lg font-extrabold text-emerald-600 dark:text-emerald-400">
                        {formatCurrency(pl.income.total)}
                      </span>
                    </div>

                    <div className="space-y-3">
                      {/* Sub-categories */}
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-zinc-500 dark:text-zinc-400 font-medium">Bazaar Sales</span>
                        <span className="font-bold text-zinc-950 dark:text-zinc-50">{formatCurrency(pl.income.bazaar)}</span>
                      </div>
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-zinc-500 dark:text-zinc-400 font-medium">Item Market Sales</span>
                        <span className="font-bold text-zinc-950 dark:text-zinc-50">{formatCurrency(pl.income.item_market)}</span>
                      </div>
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-zinc-500 dark:text-zinc-400 font-medium">Stock Block Payouts</span>
                        <span className="font-bold text-zinc-950 dark:text-zinc-50">{formatCurrency(pl.income.stocks)}</span>
                      </div>
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-zinc-500 dark:text-zinc-400 font-medium">Company Salary & Profit</span>
                        <span className="font-bold text-zinc-950 dark:text-zinc-50">{formatCurrency(pl.income.company)}</span>
                      </div>
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-zinc-500 dark:text-zinc-400 font-medium">Crimes Cash</span>
                        <span className="font-bold text-zinc-950 dark:text-zinc-50">{formatCurrency(pl.income.crimes)}</span>
                      </div>
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-zinc-500 dark:text-zinc-400 font-medium">Outbound Mugs (Mugged Targets)</span>
                        <span className="font-bold text-zinc-950 dark:text-zinc-50">{formatCurrency(pl.income.outbound_mugs)}</span>
                      </div>
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-zinc-500 dark:text-zinc-400 font-medium">Faction Funds Withdrawn</span>
                        <span className="font-bold text-zinc-950 dark:text-zinc-50">{formatCurrency(pl.income.faction_withdrawals)}</span>
                      </div>
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-zinc-500 dark:text-zinc-400 font-medium">Other Cash Streams</span>
                        <span className="font-bold text-zinc-950 dark:text-zinc-50">{formatCurrency(pl.income.other)}</span>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* Expense Ledger Card */}
                <Card className="border-zinc-200/80 dark:border-zinc-800/80">
                  <CardHeader>
                    <CardTitle className="text-md font-bold text-zinc-950 dark:text-zinc-50 flex items-center gap-2">
                      <div className="p-1 rounded bg-red-500/10 text-red-500">
                        <ArrowDownRight className="h-4 w-4" />
                      </div>
                      Outflows & Consumed reserves
                    </CardTitle>

                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="flex justify-between items-center bg-zinc-50 dark:bg-zinc-900/40 p-3 rounded-lg">
                      <span className="text-xs font-bold text-zinc-500 uppercase tracking-wider">Total Outflows</span>
                      <span className="text-lg font-extrabold text-red-600 dark:text-red-400">
                        {formatCurrency(pl.expenses.total)}
                      </span>
                    </div>

                    <div className="space-y-3">
                      {/* Sub-categories */}
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-zinc-500 dark:text-zinc-400 font-medium flex items-center gap-1.5">
                          Consumables Value <span className="text-[10px] text-zinc-400">(Xanax, Booster, Meds, etc.)</span>
                        </span>
                        <span className="font-bold text-zinc-950 dark:text-zinc-50">{formatCurrency(pl.expenses.consumables)}</span>
                      </div>
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-zinc-500 dark:text-zinc-400 font-medium">Property Upkeep Fees</span>
                        <span className="font-bold text-zinc-950 dark:text-zinc-50">{formatCurrency(pl.expenses.upkeep)}</span>
                      </div>
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-zinc-500 dark:text-zinc-400 font-medium">Loan Interest Fees</span>
                        <span className="font-bold text-zinc-950 dark:text-zinc-50">{formatCurrency(pl.expenses.loan_interest)}</span>
                      </div>
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-zinc-500 dark:text-zinc-400 font-medium">Inbound Mugs (Mugged by others)</span>
                        <span className="font-bold text-zinc-950 dark:text-zinc-50">{formatCurrency(pl.expenses.inbound_mugs)}</span>
                      </div>
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-zinc-500 dark:text-zinc-400 font-medium">Other Cash Expenses</span>
                        <span className="font-bold text-zinc-950 dark:text-zinc-50">{formatCurrency(pl.expenses.other)}</span>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            )}

            {activeTab === "assets" && (
              <motion.div
                key="assets-tab"
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -15 }}
                transition={{ duration: 0.2 }}
                className="space-y-6"
              >
                {/* Physical Reserves Cards */}
                <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
                  {/* Properties */}
                  <Card className="border-zinc-200/80 dark:border-zinc-800/80">
                    <CardHeader className="pb-3">
                      <CardTitle className="text-sm font-bold text-zinc-950 dark:text-zinc-50 flex items-center gap-2">
                        <HomeIcon className="h-4 w-4 text-indigo-500" />
                        Property holdings
                      </CardTitle>
                      <CardDescription>Real estate assets pool value.</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      {assets.properties.properties.length === 0 ? (
                        <p className="text-xs text-zinc-500">No properties owned</p>
                      ) : (
                        assets.properties.properties.map((prop) => (
                          <div key={prop.id} className="flex justify-between items-center text-xs">
                            <span className="text-zinc-600 dark:text-zinc-400 font-medium">{prop.name}</span>
                            <span className="font-bold text-zinc-950 dark:text-zinc-50">{formatCurrency(prop.value)}</span>
                          </div>
                        ))
                      )}
                      <Separator className="my-2 border-zinc-200 dark:border-zinc-800" />
                      <div className="flex justify-between items-center text-xs font-bold text-zinc-900 dark:text-zinc-50">
                        <span>Total Property Value</span>
                        <span>{formatCurrency(assets.properties.total_value)}</span>
                      </div>
                    </CardContent>
                  </Card>

                  {/* Company Registry */}
                  <Card className="border-zinc-200/80 dark:border-zinc-800/80">
                    <CardHeader className="pb-3">
                      <CardTitle className="text-sm font-bold text-zinc-950 dark:text-zinc-50 flex items-center gap-2">
                        <Briefcase className="h-4 w-4 text-purple-500" />
                        Company holdings
                      </CardTitle>
                      <CardDescription>Equity funds tied up in businesses.</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <div className="flex justify-between items-center text-xs">
                        <span className="text-zinc-600 dark:text-zinc-400 font-medium">Business Registry</span>
                        <span className="font-semibold text-zinc-500">{assets.company.name}</span>
                      </div>
                      <div className="flex justify-between items-center text-xs">
                        <span className="text-zinc-600 dark:text-zinc-400 font-medium">Company Vault Funds</span>
                        <span className="font-bold text-zinc-950 dark:text-zinc-50">{formatCurrency(assets.company.funds)}</span>
                      </div>
                      {assets.company.daily_income !== undefined && assets.company.daily_income > 0 && (
                        <>
                          <Separator className="my-2 border-zinc-200 dark:border-zinc-800" />
                          <div className="text-[10px] uppercase font-bold tracking-wider text-zinc-400 mb-1">
                            Daily TCT Cycle Profitability (18:02 TCT)
                          </div>
                          <div className="flex justify-between items-center text-xs">
                            <span className="text-zinc-500 font-medium">Gross Daily Income</span>
                            <span className="font-semibold text-zinc-950 dark:text-zinc-50">{formatCurrency(assets.company.daily_income)}</span>
                          </div>
                          <div className="flex justify-between items-center text-xs">
                            <span className="text-zinc-500 font-medium">Daily Employee Wages</span>
                            <span className="font-semibold text-red-500">-{formatCurrency(assets.company.daily_wages || 0)}</span>
                          </div>
                          <div className="flex justify-between items-center text-xs">
                            <span className="text-zinc-500 font-medium">Daily Advertising Fees</span>
                            <span className="font-semibold text-red-500">-{formatCurrency(assets.company.daily_ad_budget || 0)}</span>
                          </div>
                          <div className="flex justify-between items-center text-xs font-semibold pt-1">
                            <span className="text-zinc-600 dark:text-zinc-300">Net Daily profit</span>
                            <span className={`font-bold ${assets.company.daily_profit! >= 0 ? "text-emerald-500" : "text-red-500"}`}>
                              {formatCurrency(assets.company.daily_profit || 0)}
                            </span>
                          </div>
                        </>
                      )}
                      <Separator className="my-2 border-zinc-200 dark:border-zinc-800" />
                      <div className="flex justify-between items-center text-xs font-bold text-zinc-900 dark:text-zinc-50">
                        <span>Total Company Value</span>
                        <span>{formatCurrency(assets.company.total_value)}</span>
                      </div>
                    </CardContent>
                  </Card>

                  {/* Stocks Portfolio */}
                  <Card className="border-zinc-200/80 dark:border-zinc-800/80">
                    <CardHeader className="pb-3">
                      <CardTitle className="text-sm font-bold text-zinc-950 dark:text-zinc-50 flex items-center gap-2">
                        <Coins className="h-4 w-4 text-amber-500" />
                        Stocks holdings
                      </CardTitle>
                      <CardDescription>Value of your stock market portfolio.</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      {!assets.stocks || assets.stocks.items.length === 0 ? (
                        <p className="text-xs text-zinc-500">No stocks owned</p>
                      ) : (
                        assets.stocks.items.slice(0, 3).map((stock) => (
                          <div key={stock.id} className="flex justify-between items-center text-xs">
                            <span className="text-zinc-600 dark:text-zinc-400 font-medium">{stock.acronym} ({stock.shares.toLocaleString()})</span>
                            <span className="font-bold text-zinc-950 dark:text-zinc-50">{formatCurrency(stock.total_value)}</span>
                          </div>
                        ))
                      )}
                      {assets.stocks && assets.stocks.items.length > 3 && (
                        <p className="text-[10px] text-zinc-400 font-medium">
                          + {assets.stocks.items.length - 3} other stocks (see full list below)
                        </p>
                      )}
                      <Separator className="my-2 border-zinc-200 dark:border-zinc-800" />
                      <div className="flex justify-between items-center text-xs font-bold text-zinc-900 dark:text-zinc-50">
                        <span>Total Stocks Value</span>
                        <span>{formatCurrency(stocksTotal)}</span>
                      </div>
                    </CardContent>
                  </Card>

                  {/* Liquid Reserve */}
                  <Card className="border-zinc-200/80 dark:border-zinc-800/80">
                    <CardHeader className="pb-3">
                      <CardTitle className="text-sm font-bold text-zinc-950 dark:text-zinc-50 flex items-center gap-2">
                        <Wallet className="h-4 w-4 text-emerald-500" />
                        Liquid Reserves
                      </CardTitle>
                      <CardDescription>Cash and point assets value.</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <div className="flex justify-between items-center text-xs">
                        <span className="text-zinc-600 dark:text-zinc-400 font-medium">Wallet Cash</span>
                        <span className="font-bold text-zinc-950 dark:text-zinc-50">{formatCurrency(assets.liquid.wallet)}</span>
                      </div>
                      <div className="flex justify-between items-center text-xs">
                        <span className="text-zinc-600 dark:text-zinc-400 font-medium">Property Vault Cash</span>
                        <span className="font-bold text-zinc-950 dark:text-zinc-50">{formatCurrency(assets.liquid.vault)}</span>
                      </div>
                      <div className="flex justify-between items-center text-xs">
                        <span className="text-zinc-600 dark:text-zinc-400 font-medium">
                          Points Balance ({assets.liquid.points.toLocaleString()})
                        </span>
                        <span className="font-bold text-zinc-950 dark:text-zinc-50">{formatCurrency(assets.liquid.points_value)}</span>
                      </div>
                      {assets.liquid.company_withdrawable !== undefined && assets.liquid.company_withdrawable > 0 && (
                        <div className="flex justify-between items-center text-xs">
                          <span className="text-zinc-600 dark:text-zinc-400 font-medium">Company (Withdrawable)</span>
                          <span className="font-bold text-zinc-950 dark:text-zinc-50">{formatCurrency(assets.liquid.company_withdrawable)}</span>
                        </div>
                      )}
                      <Separator className="my-2 border-zinc-200 dark:border-zinc-800" />
                      <div className="flex justify-between items-center text-xs font-bold text-zinc-900 dark:text-zinc-50">
                        <span>Total Liquid Value</span>
                        <span>{formatCurrency(assets.liquid.total_value)}</span>
                      </div>
                    </CardContent>
                  </Card>
                </div>

                {/* Inventory Valuation List */}
                <Card className="border-zinc-200/80 dark:border-zinc-800/80">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-md font-bold text-zinc-950 dark:text-zinc-50">
                      Physical Inventory Valuation ({formatCurrency(assets.inventory.total_value)})
                    </CardTitle>
                    <CardDescription>
                      Full inventory value breakdown calculated from current market prices.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="p-0">
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow className="border-zinc-200 dark:border-zinc-800">
                            <TableHead className="w-12"></TableHead>
                            {renderInvSortHeader("name", "Item Name")}
                            {renderInvSortHeader("type", "Category")}
                            {renderInvSortHeader("location", "Location")}
                            {renderInvSortHeader("quantity", "Quantity", true)}
                            {renderInvSortHeader("value", "Unit Price", true)}
                            {renderInvSortHeader("total_value", "Total Value", true)}
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {paginatedInventoryItems.length === 0 ? (
                            <TableRow>
                              <TableCell colSpan={7} className="text-center py-6 text-xs text-zinc-500">
                                Inventory is empty or credentials expired.
                              </TableCell>
                            </TableRow>
                          ) : (
                            paginatedInventoryItems.map((item) => (
                              <TableRow key={item.item_id} className="border-zinc-200 dark:border-zinc-800/50">
                                <TableCell className="py-2 text-center">
                                  {item.image ? (
                                    <Image
                                      src={item.image}
                                      alt={item.name}
                                      width={28}
                                      height={28}
                                      className="size-7 object-contain inline-block"
                                      onError={(e) => {
                                        e.currentTarget.style.display = "none";
                                      }}
                                    />
                                  ) : (
                                    <span className="size-7 rounded bg-zinc-100 dark:bg-zinc-800 inline-block" />
                                  )}
                                </TableCell>
                                <TableCell className="font-semibold text-zinc-950 dark:text-zinc-50 py-2">
                                  {item.name}
                                </TableCell>
                                <TableCell className="py-2">
                                  <Badge className="bg-zinc-100 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-200 hover:bg-zinc-200 border-none font-medium text-[10px]">
                                    {item.type || "Other"}
                                  </Badge>
                                </TableCell>
                                <TableCell className="py-2">
                                  <Badge className={`border-none font-bold text-[9px] uppercase tracking-wider py-0.5 px-1.5 ${item.location === "Inventory"
                                    ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                                    : item.location === "Bazaar"
                                      ? "bg-blue-500/10 text-blue-600 dark:text-blue-400"
                                      : item.location === "Display Case"
                                        ? "bg-purple-500/10 text-purple-600 dark:text-purple-400"
                                        : "bg-amber-500/10 text-amber-600 dark:text-amber-400"
                                    }`}>
                                    {item.location || "Inventory"}
                                  </Badge>
                                </TableCell>
                                <TableCell className="text-right font-medium py-2">
                                  {item.quantity.toLocaleString()}
                                </TableCell>
                                <TableCell className="text-right py-2 font-mono text-xs">
                                  {formatCurrency(item.value)}
                                </TableCell>
                                <TableCell className="text-right font-bold text-zinc-950 dark:text-zinc-50 py-2 font-mono text-xs">
                                  {formatCurrency(item.total_value)}
                                </TableCell>
                              </TableRow>
                            ))
                          )}
                        </TableBody>
                      </Table>
                    </div>

                    {/* Pagination Controls */}
                    {totalInvPages > 1 && (
                      <div className="flex items-center justify-between px-4 py-3 border-t border-zinc-200 dark:border-zinc-800 text-xs">
                        <span className="text-zinc-500">
                          Showing <strong>{((currentInvPage - 1) * invItemsPerPage) + 1}</strong> to{" "}
                          <strong>{Math.min(currentInvPage * invItemsPerPage, totalInvItems)}</strong> of{" "}
                          <strong>{totalInvItems}</strong> items
                        </span>
                        <div className="flex items-center gap-1.5">
                          <button
                            disabled={currentInvPage === 1}
                            onClick={() => setInvPage(p => Math.max(1, p - 1))}
                            className="px-2.5 py-1.5 border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 rounded-md disabled:opacity-40 text-xs hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-all font-semibold cursor-pointer"
                          >
                            Prev
                          </button>
                          <span className="text-zinc-400 mx-1">Page {currentInvPage} of {totalInvPages}</span>
                          <button
                            disabled={currentInvPage === totalInvPages}
                            onClick={() => setInvPage(p => Math.min(totalInvPages, p + 1))}
                            className="px-2.5 py-1.5 border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 rounded-md disabled:opacity-40 text-xs hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-all font-semibold cursor-pointer"
                          >
                            Next
                          </button>
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </motion.div>
            )}

            {activeTab === "transactions" && (
              <motion.div
                key="transactions-tab"
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -15 }}
                transition={{ duration: 0.2 }}
                className="space-y-4"
              >
                {/* Search and Filters Bar */}
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="relative flex-1 max-w-md">
                    <Search className="absolute left-3 top-2.5 h-4 w-4 text-zinc-500" />
                    <Input
                      type="text"
                      placeholder="Search transactions..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="pl-9 bg-white dark:bg-zinc-950 border-zinc-200 dark:border-zinc-800 rounded-lg text-xs"
                    />
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    {/* Type Filter */}
                    <div className="flex rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 p-0.5">
                      <button
                        onClick={() => setTxFilter("all")}
                        className={`px-3 py-1 text-[10px] font-bold rounded-md cursor-pointer transition-all ${txFilter === "all"
                          ? "bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100"
                          : "text-zinc-500 hover:text-zinc-900"
                          }`}
                      >
                        All
                      </button>
                      <button
                        onClick={() => setTxFilter("income")}
                        className={`px-3 py-1 text-[10px] font-bold rounded-md cursor-pointer transition-all ${txFilter === "income"
                          ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                          : "text-zinc-500 hover:text-zinc-900"
                          }`}
                      >
                        Inflows
                      </button>
                      <button
                        onClick={() => setTxFilter("expense")}
                        className={`px-3 py-1 text-[10px] font-bold rounded-md cursor-pointer transition-all ${txFilter === "expense"
                          ? "bg-red-500/10 text-red-600 dark:text-red-400"
                          : "text-zinc-500 hover:text-zinc-900"
                          }`}
                      >
                        Outflows
                      </button>
                    </div>

                    {/* Category Filter */}
                    <select
                      value={txCategoryFilter}
                      onChange={(e) => setTxCategoryFilter(e.target.value)}
                      className="h-8 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-3 text-[10px] font-bold text-zinc-600 dark:text-zinc-300 focus:outline-none"
                    >
                      <option value="all">All Categories</option>
                      <option value="stocks">Stocks</option>
                      <option value="bazaar">Bazaar</option>
                      <option value="item_market">Item Market</option>
                      <option value="company">Company</option>
                      <option value="crimes">Crimes</option>
                      <option value="outbound_mugs">Outbound Mugs</option>
                      <option value="faction_withdrawals">Faction withdrawals</option>
                      <option value="consumables">Consumables</option>
                      <option value="upkeep">Upkeep</option>
                      <option value="loan_interest">Loan Interest</option>
                      <option value="inbound_mugs">Inbound Mugs</option>
                      <option value="other">Other</option>
                    </select>
                  </div>
                </div>

                {/* Transactions Table */}
                <Card className="border-zinc-200/80 dark:border-zinc-800/80">
                  <CardContent className="p-0">
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow className="border-zinc-200 dark:border-zinc-800">
                            {renderTxSortHeader("timestamp", "Time")}
                            {renderTxSortHeader("category", "Category")}
                            {renderTxSortHeader("title", "Title")}
                            {renderTxSortHeader("description", "Description")}
                            {renderTxSortHeader("amount", "Amount", true)}
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {paginatedTransactions.length === 0 ? (
                            <TableRow>
                              <TableCell colSpan={5} className="text-center py-8 text-xs text-zinc-500">
                                No transactions found matching filters.
                              </TableCell>
                            </TableRow>
                          ) : (
                            paginatedTransactions.map((tx) => (
                              <TableRow key={tx.id} className="border-zinc-200 dark:border-zinc-800/50">
                                <TableCell className="text-xs text-zinc-500 font-medium py-3">
                                  {new Date(tx.timestamp * 1000).toLocaleString(undefined, {
                                    month: "short",
                                    day: "numeric",
                                    hour: "2-digit",
                                    minute: "2-digit",
                                  })}
                                </TableCell>
                                <TableCell className="py-3">
                                  <Badge className="bg-amber-500/10 text-amber-600 dark:text-amber-400 border-none font-bold text-[9px] uppercase tracking-wider">
                                    {tx.category.replace("_", " ")}
                                  </Badge>
                                </TableCell>
                                <TableCell className="font-semibold text-zinc-900 dark:text-zinc-50 py-3 text-xs">
                                  {tx.title}
                                </TableCell>
                                <TableCell className="text-xs text-zinc-500 dark:text-zinc-400 max-w-xs truncate py-3">
                                  {tx.description}
                                </TableCell>
                                <TableCell
                                  className={`text-right font-bold py-3 text-xs font-mono ${tx.type === "income"
                                    ? "text-emerald-600 dark:text-emerald-400"
                                    : "text-red-600 dark:text-red-400"
                                    }`}
                                >
                                  {tx.type === "income" ? "+" : "-"}
                                  {formatCurrency(tx.amount)}
                                </TableCell>
                              </TableRow>
                            ))
                          )}
                        </TableBody>
                      </Table>
                    </div>

                    {/* Pagination Controls */}
                    {totalTxPages > 1 && (
                      <div className="flex items-center justify-between px-4 py-3 border-t border-zinc-200 dark:border-zinc-800 text-xs">
                        <span className="text-zinc-500">
                          Showing <strong>{((currentTxPage - 1) * txItemsPerPage) + 1}</strong> to{" "}
                          <strong>{Math.min(currentTxPage * txItemsPerPage, totalTxItems)}</strong> of{" "}
                          <strong>{totalTxItems}</strong> transactions
                        </span>
                        <div className="flex items-center gap-1.5">
                          <button
                            disabled={currentTxPage === 1}
                            onClick={() => setTxPage(p => Math.max(1, p - 1))}
                            className="px-2.5 py-1.5 border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 rounded-md disabled:opacity-40 text-xs hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-all font-semibold cursor-pointer"
                          >
                            Prev
                          </button>
                          <span className="text-zinc-400 mx-1">Page {currentTxPage} of {totalTxPages}</span>
                          <button
                            disabled={currentTxPage === totalTxPages}
                            onClick={() => setTxPage(p => Math.min(totalTxPages, p + 1))}
                            className="px-2.5 py-1.5 border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 rounded-md disabled:opacity-40 text-xs hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-all font-semibold cursor-pointer"
                          >
                            Next
                          </button>
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </DashboardLayout>
  );
}
