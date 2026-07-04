"use client";

import { useState, useEffect } from "react";
import { DashboardLayout } from "@/components/dashboard-layout";
import { useSync } from "@/hooks/use-sync";
import { useIsMobile } from "@/hooks/use-mobile";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid } from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
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
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import Select from "@/components/ui/select";
// import { Separator } from "@/components/ui/separator";
import { ErrorState } from "@/components/error-state";
import {
  RefreshCw,
  Search,
  ArrowUpRight,
  ArrowDownRight,
  Wallet,
  Sparkles,
} from "lucide-react";
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
      company_expenses?: number;
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
    formatted =
      "$" + absNum.toLocaleString(undefined, { maximumFractionDigits: 0 });
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

// eslint-disable-next-line @typescript-eslint/no-unused-vars
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
  const isMobile = useIsMobile();
  const [data, setData] = useState<LedgerData | null>(null);
  const [snapshots, setSnapshots] = useState<DailySnapshot[]>([]);
  const [loading, setLoading] = useState(true);
  const [, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<
    "pl" | "transactions" | "performance"
  >("pl");
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);

  const { setSyncOptions, setLastSyncedText } = useSync();

  // Filters
  const [searchQuery, setSearchQuery] = useState("");
  const [txFilter, setTxFilter] = useState<"all" | "income" | "expense">("all");
  const [txCategoryFilter, setTxCategoryFilter] = useState<string>("all");

  // Inventory pagination and sorting states
  const [invSortField, setInvSortField] = useState<
    "name" | "type" | "quantity" | "value" | "total_value" | "location"
  >("total_value");
  const [invSortOrder, setInvSortOrder] = useState<"asc" | "desc">("desc");
  const [invPage, setInvPage] = useState(1);
  const invItemsPerPage = 10;

  // Transaction pagination and sorting states
  const [txSortField, setTxSortField] = useState<
    "timestamp" | "category" | "title" | "description" | "amount"
  >("timestamp");
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
        fetch("/api/bot/finance/daily-snapshots"),
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

  const handleDebugClearToday = async () => {
    setIsConfirmOpen(true);
  };

  const executeDebugClearToday = async () => {
    const token = localStorage.getItem("sentinel_session_token") || "";
    const toastId = toast.loading("Clearing today's data and triggering recalculation...");
    try {
      const res = await fetch("/api/bot/finance/debug-recalculate-today", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      if (res.ok) {
        const json = await res.json();
        toast.success(json.message || "Recalculation triggered successfully", { id: toastId });
        await fetchData(false);
      } else {
        throw new Error(`Failed with status: ${res.status}`);
      }
    } catch (err: unknown) {
      toast.error((err as Error).message || "Failed to trigger debug recalculation", { id: toastId });
    }
  };
  const runFixHistoryAction = async () => {
    const token = localStorage.getItem("sentinel_session_token") || "";
    const toastId = toast.loading("Recalculating and fixing database history...");
    try {
      const res = await fetch("/api/bot/finance/fix-history", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      if (res.ok) {
        const json = await res.json();
        toast.success(json.message || "Fix complete", { id: toastId });
        await fetchData(false);
      } else {
        throw new Error(`Fix failed with status: ${res.status}`);
      }
    } catch (err: unknown) {
      console.error(err);
      toast.error((err as Error).message || "Failed to fix database history", { id: toastId });
    }
  };

  useEffect(() => {
    setSyncOptions([
      {
        label: "Financial Logs Sync",
        action: () => runSyncAction("logs"),
      },
      {
        label: "Portfolio & Assets Sync",
        action: () => runSyncAction("portfolio"),
      },
      {
        label: "Fix P&L Database History",
        action: runFixHistoryAction,
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
              Track cash flows and calculate real-time physical and liquid
              assets.
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
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const syncStatus = data!.syncStatus;

  // Filter transactions
  const filteredTransactions = pl.transactions.filter((tx) => {
    const matchesSearch =
      tx.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      tx.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
      tx.category.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesType = txFilter === "all" || tx.type === txFilter;
    const matchesCategory =
      txCategoryFilter === "all" || tx.category === txCategoryFilter;
    return matchesSearch && matchesType && matchesCategory;
  });

  const tabOptions = [
    { value: "pl", label: "P&L Ledger" },
    { value: "performance", label: "Daily Performance" },
    {
      value: "transactions",
      label: `Transaction Logs (${filteredTransactions.length})`,
    },
  ] as const;

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
    currentTxPage * txItemsPerPage,
  );

  // Sort inventory
  const sortedInventoryItems = [...(assets.inventory.items || [])].sort((a, b) => {
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
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const paginatedInventoryItems = sortedInventoryItems.slice(
    (currentInvPage - 1) * invItemsPerPage,
    currentInvPage * invItemsPerPage,
  );

  // Calculate ledger totals and distribution percentages
  const totalAssets = assets.total_value;
  const stocksTotal = assets.stocks?.total_value || 0;
  const liquidTotal = assets?.liquid?.total_value ?? 0;
  const inventoryTotal = assets?.inventory?.total_value ?? 0;
  const propertiesTotal = assets?.properties?.total_value ?? 0;
  const companyTotal = assets?.company?.total_value ?? 0;

  // granular liquid fields with fallbacks
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const wallet = assets.liquid?.wallet ?? 0;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const vault = assets.liquid?.vault ?? 0;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const pointsQuantity = assets.liquid?.points ?? 0;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const pointsValue = assets.liquid?.points_value ?? 0;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const companyWithdrawable = assets.liquid?.company_withdrawable ?? 0;

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const liquidPct = totalAssets > 0 ? (liquidTotal / totalAssets) * 100 : 0;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const inventoryPct = totalAssets > 0 ? (inventoryTotal / totalAssets) * 100 : 0;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const propertiesPct = totalAssets > 0 ? (propertiesTotal / totalAssets) * 100 : 0;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const companyPct = totalAssets > 0 ? (companyTotal / totalAssets) * 100 : 0;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const stocksPct = totalAssets > 0 ? (stocksTotal / totalAssets) * 100 : 0;

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const renderInvSortHeader = (
    field: typeof invSortField,
    label: string,
    alignRight = false,
  ) => {
    const isActive = invSortField === field;
    return (
      <TableHead
        className={`font-bold cursor-pointer select-none hover:text-zinc-950 dark:hover:text-zinc-50 transition-colors ${alignRight ? "text-right" : ""}`}
        onClick={() => handleInvSort(field)}
      >
        <span
          className={`inline-flex items-center gap-1 ${alignRight ? "justify-end w-full" : ""}`}
        >
          {label}
          {isActive ? (
            <span className="text-[10px] text-amber-500 font-bold">
              {invSortOrder === "asc" ? "▲" : "▼"}
            </span>
          ) : (
            <span className="text-[10px] text-zinc-300 dark:text-zinc-700 opacity-60">
              ⇅
            </span>
          )}
        </span>
      </TableHead>
    );
  };

  const renderTxSortHeader = (
    field: typeof txSortField,
    label: string,
    alignRight = false,
  ) => {
    const isActive = txSortField === field;
    return (
      <TableHead
        className={`font-bold cursor-pointer select-none hover:text-zinc-950 dark:hover:text-zinc-50 transition-colors ${alignRight ? "text-right" : ""}`}
        onClick={() => handleTxSort(field)}
      >
        <span
          className={`inline-flex items-center gap-1 ${alignRight ? "justify-end w-full" : ""}`}
        >
          {label}
          {isActive ? (
            <span className="text-[10px] text-amber-500 font-bold">
              {txSortOrder === "asc" ? "▲" : "▼"}
            </span>
          ) : (
            <span className="text-[10px] text-zinc-300 dark:text-zinc-700 opacity-60">
              ⇅
            </span>
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
            <h1 className="text-3xl font-extrabold tracking-tight text-zinc-900 dark:text-zinc-50 font-heading">
              Finance Ledger
            </h1>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleDebugClearToday}
              className="px-3 py-1.5 text-xs font-semibold text-red-600 hover:text-red-700 bg-red-50 dark:bg-red-950/20 hover:bg-red-100 dark:hover:bg-red-900/30 border border-red-200 dark:border-red-900/50 rounded-lg transition-colors duration-150"
            >
              Debug: Recalculate Today
            </button>
          </div>
        </div>

        {/* Wealth Summary Cards */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Card className="border-zinc-200 dark:border-zinc-900 bg-white/50 dark:bg-zinc-950/50 backdrop-blur shadow-sm relative overflow-hidden group">
            <div className="absolute top-0 right-0 h-16 w-16 bg-emerald-500/10 rounded-bl-full flex items-center justify-center transition-all group-hover:scale-110">
              <Wallet className="h-5 w-5 text-emerald-500" />
            </div>
            <CardHeader className="pb-2">
              <CardDescription className="text-xs uppercase tracking-wider text-zinc-500">
                Liquid Capital
              </CardDescription>
              <CardTitle className="text-2xl font-bold font-heading text-emerald-600 dark:text-emerald-400">
                {formatCurrency(liquidTotal)}
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
                  ? formatCurrency(
                    Math.round(
                      snapshots.reduce(
                        (sum, s) => sum + Number(s.net_profit),
                        0,
                      ) / snapshots.length,
                    ),
                  )
                  : formatCurrency(pl.net_profit)}
              </CardTitle>
            </CardHeader>
          </Card>

          <Card className="border-zinc-200 dark:border-zinc-900 bg-white/50 dark:bg-zinc-950/50 backdrop-blur shadow-sm relative overflow-hidden group">
            <div
              className={`absolute top-0 right-0 h-16 w-16 ${pl.net_profit >= 0 ? "bg-emerald-500/10" : "bg-red-500/10"} rounded-bl-full flex items-center justify-center transition-all group-hover:scale-110`}
            >
              {pl.net_profit >= 0 ? (
                <ArrowUpRight className="h-5 w-5 text-emerald-500" />
              ) : (
                <ArrowDownRight className="h-5 w-5 text-red-500" />
              )}
            </div>
            <CardHeader className="pb-2">
              <CardDescription className="text-xs uppercase tracking-wider text-zinc-500">
                Net Profit (Today)
              </CardDescription>
              <CardTitle
                className={`text-2xl font-bold font-heading ${pl.net_profit >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}
              >
                {formatCurrency(pl.net_profit)}
              </CardTitle>
            </CardHeader>
          </Card>
        </div>



        {/* Tab Selection */}
        <div className="mb-6">
          <div className="sm:hidden">
            <Select
              id="finance-tab-select"
              value={activeTab}
              onChange={(v) => setActiveTab(v as typeof activeTab)}
              options={tabOptions.map((o) => ({ value: o.value, label: o.label }))}
            />
          </div>

          <Tabs
            defaultValue="pl"
            value={activeTab}
            onValueChange={(val) => setActiveTab(val as typeof activeTab)}
            className="w-full"
          >
            <TabsList className="hidden w-full max-w-3xl grid-cols-3 rounded-lg border border-zinc-200 bg-zinc-100/80 p-0 dark:border-zinc-800 dark:bg-zinc-900/80 sm:grid">
              <TabsTrigger
                value="pl"
                className="whitespace-nowrap p-0 text-xs font-semibold data-[state=active]:bg-white dark:data-[state=active]:bg-zinc-950"
              >
                P&L Ledger
              </TabsTrigger>
              <TabsTrigger
                value="performance"
                className="whitespace-nowrap p-0 text-xs font-semibold data-[state=active]:bg-white dark:data-[state=active]:bg-zinc-950"
              >
                Daily Performance
              </TabsTrigger>
              <TabsTrigger
                value="transactions"
                className="whitespace-nowrap p-0 text-xs font-semibold data-[state=active]:bg-white dark:data-[state=active]:bg-zinc-950"
              >
                Transaction Logs ({filteredTransactions.length})
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>

        {/* Tab Content Rendering */}
        <div className="min-h-100">
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
                        <p className="font-semibold text-sm">
                          No Performance Data Yet
                        </p>
                        <p className="text-xs text-zinc-400 max-w-sm mt-0.5">
                          Daily snapshots will populate here as the background
                          worker records them over time.
                        </p>
                      </div>
                    ) : (
                      <div className="space-y-8">
                        {(() => {
                          const chartConfig: ChartConfig = {
                            net_profit: {
                              label: "Daily Net Profit",
                              color: "#10b981",
                            },
                            estimated_networth: {
                              label: "Net Worth",
                              color: "#f59e0b",
                            },
                            liquid_capital: {
                              label: "Liquid Capital",
                              color: "#3b82f6",
                            },
                          };
                          return (
                            <ChartContainer
                              config={chartConfig}
                              className="h-87.5 w-full"
                            >
                              <AreaChart
                                data={snapshots}
                                margin={{
                                  top: 4,
                                  right: 4,
                                  left: 4,
                                  bottom: 4,
                                }}
                              >
                                <defs>
                                  <linearGradient
                                    id="colorProfit"
                                    x1="0"
                                    y1="0"
                                    x2="0"
                                    y2="1"
                                  >
                                    <stop
                                      offset="5%"
                                      stopColor="#10b981"
                                      stopOpacity={0.15}
                                    />
                                    <stop
                                      offset="95%"
                                      stopColor="#10b981"
                                      stopOpacity={0}
                                    />
                                  </linearGradient>
                                  <linearGradient
                                    id="colorNetworth"
                                    x1="0"
                                    y1="0"
                                    x2="0"
                                    y2="1"
                                  >
                                    <stop
                                      offset="5%"
                                      stopColor="#f59e0b"
                                      stopOpacity={0.15}
                                    />
                                    <stop
                                      offset="95%"
                                      stopColor="#f59e0b"
                                      stopOpacity={0}
                                    />
                                  </linearGradient>
                                  <linearGradient
                                    id="colorLiquid"
                                    x1="0"
                                    y1="0"
                                    x2="0"
                                    y2="1"
                                  >
                                    <stop
                                      offset="5%"
                                      stopColor="#3b82f6"
                                      stopOpacity={0.15}
                                    />
                                    <stop
                                      offset="95%"
                                      stopColor="#3b82f6"
                                      stopOpacity={0}
                                    />
                                  </linearGradient>
                                </defs>
                                <CartesianGrid
                                  vertical={false}
                                  stroke="rgba(113,113,122,0.15)"
                                />
                                <XAxis
                                  dataKey="date"
                                  stroke="#71717a"
                                  fontSize={10}
                                  tickLine={false}
                                  axisLine={false}
                                />
                                <YAxis
                                  yAxisId="left"
                                  stroke="#71717a"
                                  fontSize={10}
                                  tickLine={false}
                                  axisLine={false}
                                  tickFormatter={(val: number) =>
                                    formatCurrency(val)
                                  }
                                  width={isMobile ? 0 : 72}
                                  tick={isMobile ? false : undefined}
                                />
                                <YAxis
                                  yAxisId="right"
                                  orientation="right"
                                  stroke="#f59e0b"
                                  fontSize={10}
                                  tickLine={false}
                                  axisLine={false}
                                  tickFormatter={(val: number) =>
                                    formatCurrency(val)
                                  }
                                  width={isMobile ? 0 : 72}
                                  tick={isMobile ? false : undefined}
                                />
                                <ChartTooltip
                                  content={
                                    <ChartTooltipContent
                                      formatter={(value, name) => [
                                        <span
                                          key="v"
                                          className="font-mono font-bold tabular-nums"
                                        >
                                          {formatCurrency(Number(value))}
                                        </span>,
                                        chartConfig[name as string]?.label ??
                                        name,
                                      ]}
                                    />
                                  }
                                />
                                <Area
                                  yAxisId="left"
                                  type="monotone"
                                  dataKey="net_profit"
                                  stroke="#10b981"
                                  fillOpacity={1}
                                  fill="url(#colorProfit)"
                                  strokeWidth={2}
                                />
                                <Area
                                  yAxisId="right"
                                  type="monotone"
                                  dataKey="estimated_networth"
                                  stroke="#f59e0b"
                                  fillOpacity={1}
                                  fill="url(#colorNetworth)"
                                  strokeWidth={2}
                                />
                                <Area
                                  yAxisId="left"
                                  type="monotone"
                                  dataKey="liquid_capital"
                                  stroke="#3b82f6"
                                  fillOpacity={1}
                                  fill="url(#colorLiquid)"
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
                                <TableHead className="font-bold">
                                  Date
                                </TableHead>
                                <TableHead className="font-bold text-right">
                                  Net Worth
                                </TableHead>
                                <TableHead className="font-bold text-right">
                                  Liquid Capital
                                </TableHead>
                                <TableHead className="font-bold text-right">
                                  Assets Value
                                </TableHead>
                                <TableHead className="font-bold text-right">
                                  Daily Inflow
                                </TableHead>
                                <TableHead className="font-bold text-right">
                                  Daily Outflow
                                </TableHead>
                                <TableHead className="font-bold text-right">
                                  Daily Net Profit
                                </TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {[...snapshots].reverse().map((snap) => (
                                <TableRow key={snap.date}>
                                  <TableCell className="font-mono text-xs">
                                    {snap.date}
                                  </TableCell>
                                  <TableCell className="text-right font-semibold text-zinc-950 dark:text-zinc-50">
                                    {formatCurrency(
                                      Number(snap.estimated_networth),
                                    )}
                                  </TableCell>
                                  <TableCell className="text-right text-emerald-600 dark:text-emerald-400 font-medium">
                                    {formatCurrency(
                                      Number(snap.liquid_capital),
                                    )}
                                  </TableCell>
                                  <TableCell className="text-right text-blue-600 dark:text-blue-400 font-medium">
                                    {formatCurrency(
                                      Number(snap.asset_valuation),
                                    )}
                                  </TableCell>
                                  <TableCell className="text-right text-zinc-600 dark:text-zinc-400">
                                    {formatCurrency(Number(snap.inflow))}
                                  </TableCell>
                                  <TableCell className="text-right text-zinc-600 dark:text-zinc-400">
                                    {formatCurrency(Number(snap.outflow))}
                                  </TableCell>
                                  <TableCell
                                    className={`text-right font-bold ${Number(snap.net_profit) >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}
                                  >
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
                      <span className="text-xs font-bold text-zinc-500 uppercase tracking-wider">
                        Total Inflows
                      </span>
                      <span className="text-lg font-extrabold text-emerald-600 dark:text-emerald-400">
                        {formatCurrency(pl.income.total || 0)}
                      </span>
                    </div>

                    <div className="space-y-3">
                      {/* Sub-categories */}
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-zinc-500 dark:text-zinc-400 font-medium">
                          Bazaar Sales
                        </span>
                        <span className="font-bold text-zinc-950 dark:text-zinc-50">
                          {formatCurrency(pl.income.bazaar)}
                        </span>
                      </div>
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-zinc-500 dark:text-zinc-400 font-medium">
                          Item Market Sales
                        </span>
                        <span className="font-bold text-zinc-950 dark:text-zinc-50">
                          {formatCurrency(pl.income.item_market)}
                        </span>
                      </div>
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-zinc-500 dark:text-zinc-400 font-medium">
                          Stock Block Payouts
                        </span>
                        <span className="font-bold text-zinc-950 dark:text-zinc-50">
                          {formatCurrency(pl.income.stocks)}
                        </span>
                      </div>
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-zinc-500 dark:text-zinc-400 font-medium">
                          Company Income
                        </span>
                        <span className="font-bold text-zinc-950 dark:text-zinc-50">
                          {formatCurrency(pl.income.company)}
                        </span>
                      </div>
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-zinc-500 dark:text-zinc-400 font-medium">
                          Crimes Cash
                        </span>
                        <span className="font-bold text-zinc-950 dark:text-zinc-50">
                          {formatCurrency(pl.income.crimes)}
                        </span>
                      </div>
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-zinc-500 dark:text-zinc-400 font-medium">
                          Outbound Mugs (Mugged Targets)
                        </span>
                        <span className="font-bold text-zinc-950 dark:text-zinc-50">
                          {formatCurrency(pl.income.outbound_mugs)}
                        </span>
                      </div>
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-zinc-500 dark:text-zinc-400 font-medium">
                          Faction Funds Withdrawn
                        </span>
                        <span className="font-bold text-zinc-950 dark:text-zinc-50">
                          {formatCurrency(pl.income.faction_withdrawals)}
                        </span>
                      </div>
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-zinc-500 dark:text-zinc-400 font-medium">
                          Other Cash Streams
                        </span>
                        <span className="font-bold text-zinc-950 dark:text-zinc-50">
                          {formatCurrency(pl.income.other)}
                        </span>
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
                      <span className="text-xs font-bold text-zinc-500 uppercase tracking-wider">
                        Total Outflows
                      </span>
                      <span className="text-lg font-extrabold text-red-600 dark:text-red-400">
                        {formatCurrency(pl.expenses.total)}
                      </span>
                    </div>

                    <div className="space-y-3">
                      {/* Sub-categories */}
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-zinc-500 dark:text-zinc-400 font-medium flex items-center gap-1.5">
                          Consumables Value{" "}
                          <span className="text-[10px] text-zinc-400">
                            (Xanax, Booster, Meds, etc.)
                          </span>
                        </span>
                        <span className="font-bold text-zinc-950 dark:text-zinc-50">
                          {formatCurrency(pl.expenses.consumables)}
                        </span>
                      </div>
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-zinc-500 dark:text-zinc-400 font-medium">
                          Property Upkeep Fees
                        </span>
                        <span className="font-bold text-zinc-950 dark:text-zinc-50">
                          {formatCurrency(pl.expenses.upkeep)}
                        </span>
                      </div>
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-zinc-500 dark:text-zinc-400 font-medium">
                          Loan Interest Fees
                        </span>
                        <span className="font-bold text-zinc-950 dark:text-zinc-50">
                          {formatCurrency(pl.expenses.loan_interest)}
                        </span>
                      </div>
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-zinc-500 dark:text-zinc-400 font-medium">
                          Inbound Mugs (Mugged by others)
                        </span>
                        <span className="font-bold text-zinc-950 dark:text-zinc-50">
                          {formatCurrency(pl.expenses.inbound_mugs)}
                        </span>
                      </div>
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-zinc-500 dark:text-zinc-400 font-medium">
                          Company Expenses (Wages & Ads)
                        </span>
                        <span className="font-bold text-zinc-950 dark:text-zinc-50">
                          {formatCurrency(pl.expenses.company_expenses || 0)}
                        </span>
                      </div>
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-zinc-500 dark:text-zinc-400 font-medium">
                          Other Cash Expenses
                        </span>
                        <span className="font-bold text-zinc-950 dark:text-zinc-50">
                          {formatCurrency(pl.expenses.other)}
                        </span>
                      </div>
                    </div>
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
                      <option value="faction_withdrawals">
                        Faction withdrawals
                      </option>
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
                              <TableCell
                                colSpan={5}
                                className="text-center py-8 text-xs text-zinc-500"
                              >
                                No transactions found matching filters.
                              </TableCell>
                            </TableRow>
                          ) : (
                            paginatedTransactions.map((tx) => (
                              <TableRow
                                key={tx.id}
                                className="border-zinc-200 dark:border-zinc-800/50"
                              >
                                <TableCell className="text-xs text-zinc-500 font-medium py-3">
                                  {new Date(tx.timestamp * 1000).toLocaleString(
                                    undefined,
                                    {
                                      month: "short",
                                      day: "numeric",
                                      hour: "2-digit",
                                      minute: "2-digit",
                                    },
                                  )}
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
                          Showing{" "}
                          <strong>
                            {(currentTxPage - 1) * txItemsPerPage + 1}
                          </strong>{" "}
                          to{" "}
                          <strong>
                            {Math.min(
                              currentTxPage * txItemsPerPage,
                              totalTxItems,
                            )}
                          </strong>{" "}
                          of <strong>{totalTxItems}</strong> transactions
                        </span>
                        <div className="flex items-center gap-1.5">
                          <button
                            disabled={currentTxPage === 1}
                            onClick={() => setTxPage((p) => Math.max(1, p - 1))}
                            className="px-2.5 py-1.5 border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 rounded-md disabled:opacity-40 text-xs hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-all font-semibold cursor-pointer"
                          >
                            Prev
                          </button>
                          <span className="text-zinc-400 mx-1">
                            Page {currentTxPage} of {totalTxPages}
                          </span>
                          <button
                            disabled={currentTxPage === totalTxPages}
                            onClick={() =>
                              setTxPage((p) => Math.min(totalTxPages, p + 1))
                            }
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

      <ConfirmDialog
        isOpen={isConfirmOpen}
        onClose={() => setIsConfirmOpen(false)}
        onConfirm={executeDebugClearToday}
        title="Recalculate Today's Data?"
        description="This will clear all locally saved financial logs and daily snapshots for today, and force the logs sync worker to re-fetch and rebuild today's snapshots from scratch."
        confirmText="Recalculate"
      />
    </DashboardLayout>
  );
}

interface ConfirmDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  description: string;
  confirmText?: string;
  cancelText?: string;
}

function ConfirmDialog({
  isOpen,
  onClose,
  onConfirm,
  title,
  description,
  confirmText = "Confirm",
  cancelText = "Cancel",
}: ConfirmDialogProps) {
  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-zinc-950/40 backdrop-blur-sm"
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 10 }}
            transition={{ duration: 0.15, ease: "easeOut" }}
            className="relative w-full max-w-md overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 p-6 shadow-lg z-10"
          >
            <h3 className="text-lg font-bold text-zinc-900 dark:text-zinc-50 font-heading">
              {title}
            </h3>
            <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400 leading-relaxed">
              {description}
            </p>
            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={onClose}
                className="px-3.5 py-2 text-xs font-semibold text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg transition-colors cursor-pointer"
              >
                {cancelText}
              </button>
              <button
                type="button"
                onClick={() => {
                  onConfirm();
                  onClose();
                }}
                className="px-3.5 py-2 text-xs font-semibold text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors cursor-pointer"
              >
                {confirmText}
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
