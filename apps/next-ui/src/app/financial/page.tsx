"use client";

import { useState, useEffect } from "react";
import { DashboardLayout } from "@/components/dashboard-layout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import {
  RefreshCw,
  Search,
  ArrowUpDown,
  CheckCircle,
} from "lucide-react";
import { toast } from "sonner";
import { ErrorState } from "@/components/error-state";

interface StockRoiInfo {
  cost: number;
  benefitType: "cash" | "items" | "points" | "stats" | "passive";
  itemName?: string;
  benefitAmount?: number;
  occurenceValue: number;
  annualYield: number;
  roiPercent: number;
  incrementIndex: number;
  sharesRequirement: number;
  totalSharesAccumulated: number;
  financialValue: number;
  gameplayValue: number;
  strategicValue: number;
  pesScore: number;
}

interface StockData {
  id: string; // generated ID e.g. "1_inc_1"
  stock_id: number;
  name: string;
  acronym: string;
  logo: string | null;
  full: string | null;
  price: number;
  market_cap: number;
  shares: number;
  investors: number;
  ownedQuantity: number;
  isOwned: boolean;
  incrementIndex: number;
  isPassive: boolean;
  showRoi: boolean;
  bonus: {
    passive: boolean;
    frequency: number;
    requirement: number;
    description: string;
  };
  roi: StockRoiInfo;
}

interface Valuations {
  points: number;
  average_property_cost: number;
  source: {
    points: string;
    average_property_cost: string;
  };
}

interface FinancialData {
  stocks: StockData[];
  valuations: Valuations;
  syncStatus: {
    lastSyncAt: string | null;
    nextRunAt: string | null;
  };
}

function formatCurrency(num: number) {
  if (num === 0) return "$0";
  if (num >= 1e9) {
    return "$" + (num / 1e9).toFixed(2) + "B";
  }
  if (num >= 1e6) {
    return "$" + (num / 1e6).toFixed(2) + "M";
  }
  return "$" + num.toLocaleString(undefined, { maximumFractionDigits: 0 });
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

export default function FinancialPage() {
  const [data, setData] = useState<FinancialData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Table parameters
  const [search, setSearch] = useState("");
  const [benefitFilter, setBenefitFilter] = useState<string>("all");
  const [sortField, setSortField] = useState<"pes" | "roi" | "cost" | "price" | "acronym">("pes");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;

  const fetchData = async (showRefreshIndicator = false) => {
    setError(null);
    if (showRefreshIndicator) setRefreshing(true);
    if (!data) setLoading(true);
    try {
      const res = await fetch("/api/bot/financials/stocks");
      if (res.ok) {
        const json = await res.json();
        setData(json);
        if (showRefreshIndicator) {
          toast.success("Financial data refreshed successfully");
        }
      } else {
        throw new Error(`Server returned ${res.status} ${res.statusText}`);
      }
    } catch (err: unknown) {
      console.error("Error fetching financial data:", err);
      setError(err instanceof Error ? err.message : String(err));
      toast.error("Error connecting to server");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (loading && !data) {
    return (
      <DashboardLayout>
        <div className="flex h-64 items-center justify-center gap-2">
          <RefreshCw className="h-6 w-6 animate-spin text-amber-500" />
          <span className="text-zinc-500 dark:text-zinc-400">Loading stock valuations & Progression metrics...</span>
        </div>
      </DashboardLayout>
    );
  }

  if (error && !data) {
    return (
      <DashboardLayout>
        <div className="space-y-6">
          <div>
            <h1 className="text-2xl font-bold tracking-tight md:text-3xl text-zinc-900 dark:text-zinc-50 font-heading">Financial</h1>
            <p className="text-zinc-500 dark:text-zinc-400">
              Track stock prices, evaluate benefit ROIs dynamically, and plan investments.
            </p>
          </div>
          <ErrorState
            title="Failed to Load Financial Data"
            description="We were unable to connect to the bot server to retrieve current stock valuations."
            errorDetails={error}
            onRetry={() => fetchData()}
          />
        </div>
      </DashboardLayout>
    );
  }

  // Filter stocks/increments
  const filteredStocks = (data?.stocks || []).filter((s) => {
    const matchesSearch =
      s.name.toLowerCase().includes(search.toLowerCase()) ||
      s.acronym.toLowerCase().includes(search.toLowerCase());

    if (benefitFilter === "all") return matchesSearch;
    if (benefitFilter === "passive") return matchesSearch && s.bonus.passive;
    if (benefitFilter === "active") return matchesSearch && !s.bonus.passive;
    return matchesSearch && s.roi.benefitType === benefitFilter;
  });

  // Sort stocks/increments
  const sortedStocks = [...filteredStocks].sort((a, b) => {
    let aVal: number | string = 0;
    let bVal: number | string = 0;

    if (sortField === "pes") {
      // Put owned at the absolute bottom
      if (a.isOwned && !b.isOwned) return 1;
      if (!a.isOwned && b.isOwned) return -1;
      if (a.isOwned && b.isOwned) {
        if (a.acronym !== b.acronym) return a.acronym.localeCompare(b.acronym);
        return a.incrementIndex - b.incrementIndex;
      }

      aVal = a.roi.pesScore;
      bVal = b.roi.pesScore;
    } else if (sortField === "roi") {
      // Put owned at bottom
      if (a.isOwned && !b.isOwned) return 1;
      if (!a.isOwned && b.isOwned) return -1;

      aVal = a.roi.roiPercent;
      bVal = b.roi.roiPercent;
    } else if (sortField === "cost") {
      aVal = a.roi.cost;
      bVal = b.roi.cost;
    } else if (sortField === "price") {
      aVal = a.price;
      bVal = b.price;
    } else {
      aVal = a.acronym;
      bVal = b.acronym;
    }

    if (aVal < bVal) return sortOrder === "asc" ? -1 : 1;
    if (aVal > bVal) return sortOrder === "asc" ? 1 : -1;
    return 0;
  });

  const handleSort = (field: typeof sortField) => {
    if (sortField === field) {
      setSortOrder(sortOrder === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortOrder("desc");
    }
  };

  // Table Pagination
  const totalItems = sortedStocks.length;
  const totalPages = Math.ceil(totalItems / itemsPerPage) || 1;
  const startIndex = (currentPage - 1) * itemsPerPage;
  const paginatedStocks = sortedStocks.slice(startIndex, startIndex + itemsPerPage);

  const handlePageChange = (page: number) => {
    if (page >= 1 && page <= totalPages) {
      setCurrentPage(page);
    }
  };

  // The top recommended checklist are the first 5 unowned elements from the master list (sorted by PES Score)
  const checklistRecommendations = (data?.stocks || [])
    .filter((s) => !s.isOwned)
    .slice(0, 5);



  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight md:text-3xl text-zinc-900 dark:text-zinc-50 font-heading font-heading">Financials</h1>
            <p className="text-zinc-500 dark:text-zinc-400">
              Personalized roadmap showing which stock block or Private Island increment to save up for next, ranked by Progression Efficiency Score.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-zinc-400 font-mono">
              Synced: {formatRelativeTime(data?.syncStatus.lastSyncAt || null)}
            </span>
            <button
              onClick={() => fetchData(true)}
              disabled={refreshing}
              className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-3 py-1.5 text-xs font-semibold text-zinc-700 dark:text-zinc-300 shadow-sm transition hover:bg-zinc-50 dark:hover:bg-zinc-900 hover:text-zinc-900 dark:hover:text-zinc-50 disabled:opacity-40 cursor-pointer"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
              Sync Market
            </button>
          </div>
        </div>

        {/* Focus & Recommendations Panel */}
        <div className="grid gap-6 md:grid-cols-3">
          {/* Investment Focus Card */}
          <Card className="md:col-span-2 border-amber-500/20 dark:border-amber-500/30 bg-amber-500/[0.02] dark:bg-amber-500/[0.03] backdrop-blur shadow-sm">
            <CardHeader className="pb-3 border-b border-zinc-100 dark:border-zinc-900/60">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-base font-bold text-amber-700 dark:text-amber-400 font-heading">Investment Focus Checklist</CardTitle>
                  <CardDescription className="text-xs font-medium">Your next unowned financial moves, ranked by Progression Efficiency Score (PES).</CardDescription>
                </div>
                <Badge className="bg-amber-500/10 text-amber-600 dark:text-amber-400 hover:bg-amber-500/15 border-none font-bold">Recommended Focus</Badge>
              </div>
            </CardHeader>
            <CardContent className="pt-4 px-4 pb-4">
              <div className="divide-y divide-zinc-100 dark:divide-zinc-900/60">
                {checklistRecommendations.length === 0 ? (
                  <div className="py-6 text-center text-xs text-zinc-500 font-medium">
                    No recommendations. All roadmap items are owned!
                  </div>
                ) : (
                  checklistRecommendations.map((rec, idx) => (
                    <div key={rec.id} className="py-3 flex items-center justify-between gap-4 first:pt-0 last:pb-0">
                      <div className="flex items-center gap-3">
                        <span className="flex items-center justify-center font-bold text-xs bg-amber-500/10 text-amber-600 dark:text-amber-400 rounded-full h-5 w-5 shrink-0">
                          {idx + 1}
                        </span>
                        {rec.logo ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={rec.logo}
                            alt={rec.acronym}
                            className="h-7 w-7 object-contain bg-zinc-100 dark:bg-zinc-900 p-0.5 rounded shrink-0"
                          />
                        ) : (
                          <div className="h-7 w-7 bg-zinc-100 dark:bg-zinc-900 rounded font-bold text-xs flex items-center justify-center text-zinc-500 shrink-0">
                            {rec.acronym[0]}
                          </div>
                        )}
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="font-bold text-xs text-zinc-900 dark:text-zinc-100 font-mono shrink-0">{rec.acronym}</span>
                            <span className="text-zinc-400 dark:text-zinc-500 text-[10px] truncate max-w-[150px] sm:max-w-none font-medium">
                              {rec.name}
                            </span>
                          </div>
                          <span className="text-[10px] text-zinc-500 dark:text-zinc-400 mt-0.5 block font-semibold leading-normal break-words whitespace-normal line-clamp-2">
                            {rec.bonus.description}
                          </span>
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <span className="font-bold text-xs font-mono text-zinc-900 dark:text-zinc-100 block">
                          {formatCurrency(rec.roi.cost)}
                        </span>
                        <span className="text-[10px] text-zinc-400 block mt-0.5 font-semibold">
                          <span className="text-amber-600 dark:text-amber-400">
                            PES: {rec.roi.pesScore.toFixed(1)}%
                          </span>
                          {rec.showRoi && (
                            <span className="text-zinc-400 ml-1.5 font-normal">
                              (ROI: {rec.roi.roiPercent.toFixed(1)}%)
                            </span>
                          )}
                        </span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Filter / Search Bar */}
        <div className="flex flex-col sm:flex-row gap-3 items-center justify-between">
          <div className="relative w-full sm:max-w-xs">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-zinc-400" />
            <input
              type="text"
              placeholder="Search code, asset or description..."
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setCurrentPage(1);
              }}
              className="pl-9 h-9 w-full rounded-md border border-zinc-200 dark:border-zinc-800 bg-white/50 dark:bg-zinc-950/50 px-3 text-xs shadow-sm focus:border-amber-500 focus:outline-none text-zinc-900 dark:text-zinc-50 font-medium"
            />
          </div>
          <div className="flex gap-2 w-full sm:w-auto overflow-x-auto pb-1 sm:pb-0">
            {[
              { label: "All Investments", val: "all" },
              { label: "Cash Yields", val: "cash" },
              { label: "Item Yields", val: "items" },
              { label: "Points & Stats", val: "points" },
              { label: "Passives / General", val: "passive" },
            ].map((btn) => (
              <button
                key={btn.val}
                onClick={() => {
                  setBenefitFilter(btn.val);
                  setCurrentPage(1);
                }}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap cursor-pointer transition ${benefitFilter === btn.val
                    ? "bg-amber-500 text-white dark:bg-amber-600"
                    : "border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-900 text-zinc-600 dark:text-zinc-400"
                  }`}
              >
                {btn.label}
              </button>
            ))}
          </div>
        </div>

        {/* Investment Options Table */}
        <Card className="border-zinc-200 dark:border-zinc-900 bg-white/50 dark:bg-zinc-950/50 backdrop-blur shadow-sm">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent border-zinc-200 dark:border-zinc-900">
                  <TableHead className="w-12 text-center text-xs">Logo</TableHead>
                  <TableHead className="cursor-pointer hover:text-zinc-900 dark:hover:text-zinc-50 text-xs" onClick={() => handleSort("acronym")}>
                    <div className="flex items-center gap-1 font-heading">
                      Asset Code
                      <ArrowUpDown className="h-3 w-3" />
                    </div>
                  </TableHead>
                  <TableHead className="min-w-[140px] text-xs">Asset Name</TableHead>
                  <TableHead className="text-center text-xs">Increment / Type</TableHead>
                  <TableHead className="text-center text-xs">Status</TableHead>
                  <TableHead className="cursor-pointer hover:text-zinc-900 dark:hover:text-zinc-50 text-right text-xs" onClick={() => handleSort("cost")}>
                    <div className="flex items-center justify-end gap-1">
                      Purchase Cost
                      <ArrowUpDown className="h-3 w-3" />
                    </div>
                  </TableHead>
                  <TableHead className="text-xs min-w-[200px]">Perk Description</TableHead>
                  <TableHead className="cursor-pointer hover:text-zinc-900 dark:hover:text-zinc-50 text-right text-xs" onClick={() => handleSort("roi")}>
                    <div className="flex items-center justify-end gap-1">
                      ROI
                      <ArrowUpDown className="h-3 w-3" />
                    </div>
                  </TableHead>
                  <TableHead className="cursor-pointer hover:text-zinc-900 dark:hover:text-zinc-50 text-right text-xs" onClick={() => handleSort("pes")}>
                    <div className="flex items-center justify-end gap-1 font-heading">
                      PES Score
                      <ArrowUpDown className="h-3 w-3" />
                    </div>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {paginatedStocks.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={9} className="text-center py-8 text-zinc-500 font-medium">
                      No roadmap investments found matching your filters.
                    </TableCell>
                  </TableRow>
                ) : (
                  paginatedStocks.map((stock) => {
                    return (
                      <TableRow key={stock.id} className={`hover:bg-zinc-50/50 dark:hover:bg-zinc-900/30 border-zinc-100 dark:border-zinc-900/50 ${stock.isOwned ? "opacity-60 bg-zinc-50/10 dark:bg-zinc-950/5" : ""}`}>
                        {/* Logo */}
                        <TableCell className="py-2.5 text-center">
                          {stock.logo ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={stock.logo}
                              alt={stock.acronym}
                              className="h-6 w-6 object-contain inline-block bg-zinc-100 dark:bg-zinc-900 p-0.5 rounded shrink-0"
                            />
                          ) : (
                            <Badge className="bg-zinc-200 text-zinc-700 h-6 w-6 rounded flex items-center justify-center p-0 font-bold shrink-0">
                              {stock.acronym[0]}
                            </Badge>
                          )}
                        </TableCell>

                        {/* Ticker */}
                        <TableCell className="py-2.5 font-bold font-mono text-xs text-zinc-900 dark:text-zinc-100">
                          {stock.acronym}
                        </TableCell>

                        {/* Stock Name */}
                        <TableCell className="py-2.5 text-xs text-zinc-700 dark:text-zinc-300 font-medium">
                          {stock.name}
                        </TableCell>

                        {/* Roadmap Increment index */}
                        <TableCell className="py-2.5 text-center font-mono text-xs font-semibold">
                          {stock.id.startsWith("property_") ? (
                            <span className="text-amber-600 dark:text-amber-400 font-sans text-[11px] font-semibold">Property</span>
                          ) : stock.id.startsWith("stat_enhancer_") ? (
                            <span className="text-rose-600 dark:text-rose-400 font-sans text-[11px] font-semibold">Stat Enhancer</span>
                          ) : stock.isPassive ? (
                            <span className="text-zinc-400 font-normal font-sans text-[11px]">Passive</span>
                          ) : (
                            <span>Increment {stock.incrementIndex}</span>
                          )}
                        </TableCell>

                        {/* Status Badge */}
                        <TableCell className="py-2.5 text-center">
                          {stock.isOwned ? (
                            <Badge className="bg-emerald-500/10 hover:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-none font-bold inline-flex items-center gap-1 text-[10px] py-0.5 px-2">
                              <CheckCircle className="h-3.5 w-3.5" />
                              Owned
                            </Badge>
                          ) : (
                            <Badge className="bg-zinc-100 dark:bg-zinc-900 text-zinc-400 hover:bg-zinc-100 border-none font-semibold text-[10px] py-0.5 px-2">
                              Unowned
                            </Badge>
                          )}
                        </TableCell>

                        {/* Block Cost */}
                        <TableCell className="py-2.5 text-right font-mono text-xs text-zinc-700 dark:text-zinc-300 font-bold">
                          {formatCurrency(stock.roi.cost)}
                          {stock.price > 0 && (
                            <span className="text-[9px] text-zinc-400 block font-normal mt-0.5 font-mono">
                              {stock.roi.sharesRequirement.toLocaleString()} shares
                            </span>
                          )}
                        </TableCell>

                        {/* Perk Description */}
                        <TableCell className="py-2.5 text-xs max-w-[240px] whitespace-normal break-words">
                          <div className="flex flex-col gap-1 items-start">
                            <span className="text-zinc-800 dark:text-zinc-200 font-medium leading-normal">
                              {stock.bonus.description}
                            </span>
                            <span className="text-[9px] uppercase tracking-wider font-semibold">
                              {stock.roi.benefitType === "cash" && (
                                <span className="text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 dark:bg-emerald-500/15 px-1.5 py-0.5 rounded">Cash</span>
                              )}
                              {stock.roi.benefitType === "items" && (
                                <span className="text-indigo-600 dark:text-indigo-400 bg-indigo-500/10 dark:bg-indigo-500/15 px-1.5 py-0.5 rounded">Item</span>
                              )}
                              {stock.roi.benefitType === "points" && (
                                <span className="text-amber-600 dark:text-amber-400 bg-amber-500/10 dark:bg-amber-500/15 px-1.5 py-0.5 rounded">Points</span>
                              )}
                              {stock.roi.benefitType === "stats" && (
                                <span className="text-rose-600 dark:text-rose-400 bg-rose-500/10 dark:bg-rose-500/15 px-1.5 py-0.5 rounded">Stat Boost</span>
                              )}
                              {stock.roi.benefitType === "passive" && (
                                <span className="text-zinc-500 dark:text-zinc-400 bg-zinc-500/10 dark:bg-zinc-500/15 px-1.5 py-0.5 rounded">Passive Benefit</span>
                              )}
                            </span>
                          </div>
                        </TableCell>

                        {/* ROI */}
                        <TableCell className="py-2.5 text-right font-mono text-xs font-bold">
                          {stock.showRoi ? (
                            <span className="text-zinc-600 dark:text-zinc-400">
                              {stock.roi.roiPercent.toFixed(2)}%
                            </span>
                          ) : (
                            <span className="text-zinc-400 font-normal">N/A</span>
                          )}
                        </TableCell>

                        {/* PES Score */}
                        <TableCell className="py-2.5 text-right font-mono text-xs font-bold">
                          <span
                            className={
                              stock.roi.pesScore >= 20
                                ? "text-amber-500 dark:text-amber-400"
                                : stock.roi.pesScore >= 8
                                  ? "text-zinc-600 dark:text-zinc-400"
                                  : "text-zinc-500 dark:text-zinc-500"
                            }
                          >
                            {stock.roi.pesScore.toFixed(2)}%
                          </span>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>

          {/* Pagination Controls */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between border-t border-zinc-100 dark:border-zinc-900 px-4 py-3 bg-zinc-50/50 dark:bg-zinc-950/20 rounded-b-lg">
              <span className="text-xs text-zinc-500 font-medium">
                Showing {startIndex + 1} to {Math.min(startIndex + itemsPerPage, totalItems)} of {totalItems} entries
              </span>
              <div className="flex gap-2 text-xs">
                <button
                  onClick={() => handlePageChange(currentPage - 1)}
                  disabled={currentPage === 1}
                  className="px-3 py-1.5 border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 rounded-lg text-zinc-600 dark:text-zinc-400 disabled:opacity-40 cursor-pointer transition hover:bg-zinc-50 dark:hover:bg-zinc-900"
                >
                  Prev
                </button>
                <div className="flex items-center px-1 font-semibold text-zinc-700 dark:text-zinc-300">
                  Page {currentPage} of {totalPages}
                </div>
                <button
                  onClick={() => handlePageChange(currentPage + 1)}
                  disabled={currentPage === totalPages}
                  className="px-3 py-1.5 border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 rounded-lg text-zinc-600 dark:text-zinc-400 disabled:opacity-40 cursor-pointer transition hover:bg-zinc-50 dark:hover:bg-zinc-900"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </Card>
      </div>
    </DashboardLayout>
  );
}
