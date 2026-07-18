"use client";

import React, { useEffect, useState, useCallback, useMemo } from "react";
import { useSync } from "@/hooks/use-sync";
import { DashboardLayout } from "@/components/dashboard-layout";
import GlobalLoading from "@/components/dashboard/GlobalLoading";
import { useMinimumLoading } from "@/hooks/use-minimum-loading";
import { RefreshCw, Target, TrendingUp, DollarSign, Activity } from "lucide-react";
import { ModuleGuard } from "@/components/module-guard";
import { useSettings } from "@/components/settings-provider";
import { TornStockDocument, UserStockDocument, StockLedgerDocument } from "@sentinel/shared";
import Image from "next/image";

type EnhancedTornStock = TornStockDocument & {
  calculated_apr?: number;
  calculated_dividend_value?: number;
  dividend_type?: string;
};

type StocksStateData = {
  torn_stocks: EnhancedTornStock[];
  user_stocks: UserStockDocument[];
  backfill_progress?: {
    status?: string;
    logs_parsed?: number;
    oldest_timestamp_reached?: number | null;
  } | null;
};

export default function StocksDashboard() {
  const [history, setHistory] = useState<StockLedgerDocument[]>([]);
  const [stocksState, setStocksState] = useState<StocksStateData | null>(null);
  const [loading, setLoading] = useState(true);
  const [isPolling, setIsPolling] = useState(false);
  const [moduleDisabled, setModuleDisabled] = useState(false);

  const showLoader = useMinimumLoading(loading, 1000);
  const { settings, setSettings } = useSettings();
  const { setSyncOptions, setLastSyncedText } = useSync();

  const fetchStocksData = useCallback(async (isBackgroundRefresh: boolean = false) => {
    if (!isBackgroundRefresh) {
      setLoading(true);
    }
    try {
      const [historyRes, stateRes] = await Promise.all([
        fetch("/api/stocks/history"),
        fetch("/api/stocks/state")
      ]);

      if (!historyRes.ok || !stateRes.ok) {
        throw new Error("Failed to fetch stocks data");
      }

      const historyJson = await historyRes.json();
      const stateJson = await stateRes.json();

      if (historyJson.module_disabled || stateJson.module_disabled) {
        setModuleDisabled(true);
        setIsPolling(false);
        setHistory([]);
        setStocksState(null);
      } else if (historyJson.initializing || stateJson.data?.backfill_progress?.status === "in_progress") {
        setModuleDisabled(false);
        setIsPolling(true);
      } else {
        setModuleDisabled(false);
        setIsPolling(false);
        setHistory(historyJson.data || []);
        setStocksState(stateJson.data || null);
        setLastSyncedText(`Last synced at ${new Date().toLocaleTimeString()}`);
      }
    } catch (error) {
      console.error("Error fetching stocks data:", error);
    } finally {
      setLoading(false);
    }
  }, [setLastSyncedText]);

  useEffect(() => {
    if (isPolling) {
      const timer = setInterval(() => fetchStocksData(true), 2000);
      return () => clearInterval(timer);
    }
  }, [isPolling, fetchStocksData]);

  useEffect(() => {
    let isMounted = true;
    setTimeout(() => {
      if (!isMounted) return;
      setSyncOptions([
        {
          label: "Sync Stocks Data",
          action: fetchStocksData,
        },
      ]);
    }, 0);

    setTimeout(() => {
      fetchStocksData(false);
    }, 0);

    return () => {
      isMounted = false;
      setTimeout(() => {
        setSyncOptions(null);
        setLastSyncedText("");
      }, 0);
    };
  }, [setSyncOptions, fetchStocksData, setLastSyncedText, stocksState?.backfill_progress?.status, isPolling]);

  const globalStats = useMemo(() => {
    if (!stocksState || !history) return { totalSpent: 0, totalReturned: 0, roi: 0, apr: 0 };

    let totalSpent = 0;
    let totalAnnualReturn = 0;

    for (const userStock of stocksState.user_stocks) {
      const tStock = stocksState.torn_stocks.find(t => String(t.id) === String(userStock.id));
      if (!tStock) continue;

      const n = userStock.shares > 0 ? Math.floor(Math.log2((userStock.shares / tStock.bonus.requirement) + 1)) : 0;
      if (n > 0) {
        const sharesUsed = tStock.bonus.requirement * (Math.pow(2, n) - 1);
        totalSpent += sharesUsed * tStock.market.price;
        if (tStock.calculated_dividend_value) {
          totalAnnualReturn += n * (365 / tStock.bonus.frequency) * tStock.calculated_dividend_value;
        }
      }
    }

    let totalReturned = 0;
    for (const log of history) {
      totalReturned += log.value || 0;
    }

    const roi = totalSpent > 0 ? (totalReturned / totalSpent) * 100 : 0;
    const apr = totalSpent > 0 ? (totalAnnualReturn / totalSpent) * 100 : 0;

    return { totalSpent, totalReturned, roi, apr };
  }, [stocksState, history]);

  const formatStatNumber = (value: number) => {
    if (value >= 1_000_000_000) {
      return `$${(value / 1_000_000_000).toFixed(2)}B`;
    }
    if (value >= 1_000_000) {
      return `$${(value / 1_000_000).toFixed(2)}M`;
    }
    if (value >= 1_000) {
      return `$${(value / 1_000).toFixed(2)}K`;
    }
    return `$${value.toFixed(0)}`;
  };

  const handleInitialize = async () => {
    try {
      await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stocks_module_enabled: true })
      });
      setSettings({ ...settings, stocks_module_enabled: true });
      setModuleDisabled(false);
      setIsPolling(true);
      fetchStocksData(true);
    } catch (e) {
      console.error(e);
    }
  };

  if (showLoader || isPolling) {
    return (
      <DashboardLayout>
        <GlobalLoading />
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <ModuleGuard>
        {moduleDisabled ? (
          <div className="flex-1 flex flex-col items-center justify-center h-[80vh] text-center p-8">
            <Target size={32} className="text-foreground mb-6" />
            <div className="text-foreground font-mono tracking-widest text-sm mb-4 uppercase">
              [ STOCKS_MODULE_OFFLINE ]
            </div>
            <div className="text-muted-foreground font-mono text-[10px] uppercase tracking-widest max-w-md leading-relaxed mb-8">
              This module is currently disabled. Initializing this module will track your Torn stock portfolio, dividends, and calculate your total ROI across all your investments.
            </div>
            <button
              onClick={handleInitialize}
              className="px-6 py-3 bg-foreground text-background font-mono text-[10px] uppercase tracking-[0.2em] hover:opacity-90 transition-colors"
            >
              INITIALIZE_MODULE
            </button>
          </div>
        ) : (
          <div className="max-w-7xl p-2 md:p-8 mx-auto flex flex-col gap-6 pt-15">
            <header className="mb-2 border-b border-border pb-4 flex items-start justify-between">
              <div>
                <h1 className="text-xl font-mono text-foreground flex items-center gap-3 uppercase tracking-[0.2em]">
                  <TrendingUp size={20} className="text-foreground" /> STOCK_PORTFOLIO
                </h1>
                <p className="text-muted-foreground font-mono text-[10px] mt-2 uppercase tracking-[0.2em]">
                  Track stock dividends, calculate return on investment, and view market metrics.
                </p>
              </div>
              <button
                className="px-4 py-2 border border-border text-xs font-mono uppercase tracking-widest text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                onClick={async () => {
                  await fetch("/api/stocks/reset-ledger", { method: "POST" });
                  fetchStocksData(true);
                }}
              >
                Reset Ledger
              </button>
            </header>

            <div className="flex gap-4 mb-2 flex-wrap">
              <div className="bg-muted/50 p-4 border border-border rounded-none flex-1 min-w-[200px]">
                <div className="text-[10px] text-muted-foreground font-mono uppercase tracking-widest mb-2 flex items-center gap-2">
                  <DollarSign size={12} /> Total Invested
                </div>
                <div className="text-xl font-medium font-mono text-foreground">{formatStatNumber(globalStats.totalSpent)}</div>
              </div>
              <div className="bg-muted/50 p-4 border border-border rounded-none flex-1 min-w-[200px]">
                <div className="text-[10px] text-muted-foreground font-mono uppercase tracking-widest mb-2 flex items-center gap-2">
                  <Activity size={12} /> Value Returned
                </div>
                <div className="text-xl font-medium font-mono text-green-500">{formatStatNumber(globalStats.totalReturned)}</div>
              </div>
              <div className="bg-muted/50 p-4 border border-border rounded-none flex-1 min-w-[200px]">
                <div className="text-[10px] text-muted-foreground font-mono uppercase tracking-widest mb-2 flex items-center gap-2">
                  <TrendingUp size={12} /> Portfolio ROI
                </div>
                <div className="text-xl font-medium font-mono text-foreground">{globalStats.roi.toFixed(2)}%</div>
              </div>
              <div className="bg-muted/50 p-4 border border-border rounded-none flex-1 min-w-[200px]">
                <div className="text-[10px] text-muted-foreground font-mono uppercase tracking-widest mb-2 flex items-center gap-2">
                  <TrendingUp size={12} /> Portfolio APR
                </div>
                <div className="text-xl font-medium font-mono text-foreground">{globalStats.apr.toFixed(2)}%</div>
              </div>
            </div>

            {stocksState?.backfill_progress && stocksState.backfill_progress.status === "in_progress" && (
              <div className="bg-indigo-500/10 border border-indigo-500/20 rounded-lg p-4 flex items-center gap-4">
                <RefreshCw className="size-5 text-indigo-400 animate-spin" />
                <div className="flex-1">
                  <h3 className="font-semibold text-indigo-400">Historical Dividend Backfill in Progress</h3>
                  <p className="text-sm text-indigo-300/80">
                    Parsing past log events... {stocksState.backfill_progress.logs_parsed || 0} logs processed.
                    {stocksState.backfill_progress.oldest_timestamp_reached && (
                      <span> Earliest log reached: {new Date(stocksState.backfill_progress.oldest_timestamp_reached * 1000).toLocaleDateString()}</span>
                    )}
                  </p>
                </div>
              </div>
            )}

            {/* TODO: Add Owned Stocks List */}
            <div className="border border-border bg-card p-6">
              <h2 className="text-sm font-mono text-foreground mb-4 uppercase tracking-widest flex items-center gap-2">
                <Target size={14} /> My Portfolio
              </h2>
              {stocksState && stocksState.user_stocks.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-left font-mono text-xs border-collapse">
                    <thead>
                      <tr className="border-b border-border/50 text-muted-foreground">
                        <th className="py-3 px-4 font-normal tracking-wider">STOCK</th>
                        <th className="py-3 px-4 font-normal tracking-wider text-right">INCREMENT</th>
                        <th className="py-3 px-4 font-normal tracking-wider text-right">INVESTED</th>
                        <th className="py-3 px-4 font-normal tracking-wider text-right">ROI</th>
                        <th className="py-3 px-4 font-normal tracking-wider text-right">APR</th>
                      </tr>
                    </thead>
                    <tbody>
                      {stocksState.user_stocks.map(userStock => {
                        const tStock = stocksState.torn_stocks.find(t => String(t.id) === String(userStock.id));
                        if (!tStock) return null;

                        let invested = 0;
                        userStock.transactions.forEach((t: { shares: number, price: number }) => invested += (t.shares * t.price));

                        // Calculate ROI
                        let totalReturned = 0;
                        const stockHistory = history.filter(h => String(h.stock_id) === String(userStock.id));
                        stockHistory.forEach(h => totalReturned += (h.value || 0));
                        const roi = invested > 0 ? (totalReturned / invested) * 100 : 0;

                        // Calculate APR
                        const n = userStock.shares > 0 ? Math.floor(Math.log2((userStock.shares / tStock.bonus.requirement) + 1)) : 0;
                        let apr = 0;
                        if (n > 0 && tStock.calculated_dividend_value) {
                          const annualReturn = n * (365 / tStock.bonus.frequency) * tStock.calculated_dividend_value;
                          const sharesUsed = tStock.bonus.requirement * (Math.pow(2, n) - 1);
                          const costForActiveShares = sharesUsed * tStock.market.price;
                          apr = costForActiveShares > 0 ? (annualReturn / costForActiveShares) * 100 : 0;
                        }

                        const isPassive = tStock.bonus.passive;

                        let incrementBadge = null;
                        if (!isPassive) {
                          const baseReq = tStock.bonus.requirement;
                          const currentShares = userStock.shares;
                          const currentInc = currentShares > 0 ? Math.floor(Math.log2((currentShares / baseReq) + 1)) : 0;
                          const sharesForCurrent = baseReq * (Math.pow(2, currentInc) - 1);
                          const sharesForNext = baseReq * (Math.pow(2, currentInc + 1) - 1);
                          const progressToNext = ((currentShares - sharesForCurrent) / (sharesForNext - sharesForCurrent)) * 100;

                          incrementBadge = (
                            <div className="flex flex-col items-end gap-0.5">
                              <span className="text-[9px] font-bold tracking-widest uppercase px-1.5 py-0.5 rounded-sm bg-foreground/10 text-foreground">
                                {currentInc > 0 ? `INC ${currentInc}` : 'INC 0'}
                              </span>
                              {progressToNext > 0 && (
                                <span className="text-[10px] text-muted-foreground font-mono">
                                  {progressToNext.toFixed(0)}% TO NEXT
                                </span>
                              )}
                            </div>
                          );
                        }

                        return (
                          <tr key={userStock.id} className="border-b border-border/10 hover:bg-muted/20 transition-colors">
                            <td className="py-3 px-4 flex items-center gap-3">
                              {tStock.images?.logo && (
                                <Image src={tStock.images.logo} alt={tStock.acronym} width={24} height={24} className="rounded-sm" />
                              )}
                              <div className="flex flex-col">
                                <span className="font-medium text-foreground leading-tight">{tStock.acronym}</span>
                                <span className="text-muted-foreground text-[10px] leading-tight">{tStock.name}</span>
                              </div>
                            </td>
                            <td className="py-3 px-4 text-right">
                              {incrementBadge ? incrementBadge : <span className="text-muted-foreground">-</span>}
                            </td>
                            <td className="py-3 px-4 text-right text-muted-foreground">{formatStatNumber(invested)}</td>
                            <td className="py-3 px-4 text-right text-foreground">
                              {isPassive ? "-" : `${roi.toFixed(2)}%`}
                            </td>
                            <td className="py-3 px-4 text-right text-foreground">
                              {isPassive ? "-" : `${apr.toFixed(2)}%`}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="text-center py-8 text-muted-foreground text-xs font-mono uppercase tracking-widest">
                  No active investments found
                </div>
              )}
            </div>

            <div className="border border-border bg-card p-6">
              <h2 className="text-sm font-mono text-foreground mb-4 uppercase tracking-widest flex items-center gap-2">
                <Activity size={14} /> Torn Stocks Directory
              </h2>
              {stocksState && stocksState.torn_stocks.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-left font-mono text-xs border-collapse">
                    <thead>
                      <tr className="border-b border-border/50 text-muted-foreground">
                        <th className="py-3 px-4 font-normal tracking-wider">STOCK</th>
                        <th className="py-3 px-4 font-normal tracking-wider text-right">NEXT BB COST</th>
                        <th className="py-3 px-4 font-normal tracking-wider text-right">DIVIDEND</th>
                        <th className="py-3 px-4 font-normal tracking-wider text-right">APR</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(() => {
                        const personalizedStocks = stocksState.torn_stocks.map(s => {
                          const u = stocksState.user_stocks.find(u => String(u.id) === String(s.id));
                          const userShares = u ? u.shares : 0;
                          const increments = userShares > 0 ? Math.floor(Math.log2((userShares / s.bonus.requirement) + 1)) : 0;

                          const nextInc = increments + 1;
                          const targetShares = s.bonus.requirement * (Math.pow(2, nextInc) - 1);
                          const sharesRemaining = targetShares - userShares;

                          const personalizedCost = sharesRemaining * s.market.price;
                          const personalizedApr = (s.calculated_apr || 0) / Math.pow(2, increments);

                          const score = personalizedApr > 0 && personalizedCost > 1 ? personalizedApr / Math.log10(personalizedCost) : -1;

                          return { ...s, personalizedCost, personalizedApr, score, nextInc };
                        });

                        let bestScore = -1;
                        let recommendedStockId: string | number | null = null;
                        personalizedStocks.forEach(s => {
                          if (s.score > bestScore) {
                            bestScore = s.score;
                            recommendedStockId = s.id;
                          }
                        });

                        return personalizedStocks
                          .sort((a, b) => b.score - a.score)
                          .map(stock => {
                            const blockCost = stock.personalizedCost;
                            const isRecommended = stock.id === recommendedStockId;

                            return (
                              <tr key={stock.id} className="border-b border-border/10 hover:bg-muted/20 transition-colors">
                                <td className="py-3 px-4 flex items-center gap-3">
                                  {stock.images?.logo && (
                                    <Image src={stock.images.logo} alt={stock.acronym} width={24} height={24} className="rounded-sm" />
                                  )}
                                  <div className="flex flex-col gap-0.5">
                                    <div className="flex items-center gap-2">
                                      <span className="font-medium text-foreground leading-tight">{stock.acronym}</span>
                                      {isRecommended && (
                                        <span className="px-1.5 py-0.5 rounded-sm bg-foreground text-background text-[8px] font-bold tracking-widest uppercase">
                                          Recommended
                                        </span>
                                      )}
                                    </div>
                                    <span className="text-muted-foreground text-[10px] leading-tight">{stock.name}</span>
                                  </div>
                                </td>
                                <td className="py-3 px-4 text-right text-foreground">{formatStatNumber(blockCost)}</td>
                                <td className="py-3 px-4 text-right">
                                  <div className="flex flex-col items-end">
                                    <span className="text-foreground truncate max-w-[150px] sm:max-w-xs">{stock.bonus.description}</span>
                                    {!stock.bonus.passive && (
                                      <span className="text-muted-foreground text-[10px]">{stock.bonus.frequency} days</span>
                                    )}
                                  </div>
                                </td>
                                <td className="py-3 px-4 text-right">
                                  {stock.personalizedApr !== undefined && stock.personalizedApr > 0 ? (
                                    <div className="flex flex-col items-end">
                                      <span className="text-green-500 font-medium">{stock.personalizedApr.toFixed(2)}%</span>
                                      <span className="text-[10px] text-muted-foreground font-mono">INC {stock.nextInc}</span>
                                    </div>
                                  ) : (
                                    <span className="text-muted-foreground">-</span>
                                  )}
                                </td>
                              </tr>
                            );
                          })
                      })()}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="text-center py-8 text-muted-foreground text-xs font-mono uppercase tracking-widest">
                  No stock data available
                </div>
              )}
            </div>

          </div>
        )}
      </ModuleGuard>
    </DashboardLayout>
  );
}
