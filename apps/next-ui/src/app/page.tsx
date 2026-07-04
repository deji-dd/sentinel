"use client";

import { useEffect, useState } from "react";
import { DashboardLayout } from "@/components/dashboard-layout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  TrendingUp,
  Landmark,
  Dumbbell,
  Fingerprint,
  ArrowRight,
} from "lucide-react";
import Link from "next/link";

interface LedgerData {
  networth: number;
  liquid_capital: number;
  income: { total: number };
  expenses: { total: number };
}

interface GymData {
  currentStats: {
    strength: number;
    speed: number;
    defense: number;
    dexterity: number;
    total: number;
  };
  activeGym: string;
  avgDailyEnergy: number;
}

interface Crime {
  id: number;
  name: string;
  attempts: { total: number; success: number };
}

interface CrimesData {
  crimes: Crime[];
  recommendations: {
    focus_crime_id: number | null;
  };
}

interface PortfolioData {
  stocks: {
    total_value: number;
    benefits: Array<{
      stock_id: number;
      acronym: string;
      active_increments: number;
      annual_payout_value: number;
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
    formatted = "$" + absNum.toString();
  }
  return num < 0 ? `-${formatted}` : formatted;
}

function formatShortNumber(num: number) {
  if (num >= 1e9) {
    return (num / 1e9).toFixed(2) + "B";
  } else if (num >= 1e6) {
    return (num / 1e6).toFixed(2) + "M";
  } else if (num >= 1e3) {
    return (num / 1e3).toFixed(1) + "K";
  }
  return num.toLocaleString();
}

export default function Home() {
  const [ledger, setLedger] = useState<LedgerData | null>(null);
  const [gym, setGym] = useState<GymData | null>(null);
  const [crimes, setCrimes] = useState<CrimesData | null>(null);
  const [portfolio, setPortfolio] = useState<PortfolioData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadDashboardData() {
      try {
        const [ledgerRes, gymRes, crimesRes, portfolioRes] = await Promise.all([
          fetch("/api/bot/finance/ledger"),
          fetch("/api/bot/config/personal/milestones?timeframe=30d"),
          fetch("/api/bot/config/personal/crimes"),
          fetch("/api/bot/finance/portfolio"),
        ]);

        if (ledgerRes.ok) setLedger(await ledgerRes.json());
        if (gymRes.ok) setGym(await gymRes.json());
        if (crimesRes.ok) setCrimes(await crimesRes.json());
        if (portfolioRes.ok) setPortfolio(await portfolioRes.json());
      } catch (err) {
        console.error("Failed to load dashboard overview data:", err);
      } finally {
        setLoading(false);
      }
    }

    loadDashboardData();
  }, []);

  // Calculate composite metrics
  const totalNetworth = ledger?.networth ?? 0;
  const totalStockAssets = portfolio?.stocks?.total_value ?? 0;
  const totalGymStats = gym?.currentStats?.total ?? 0;
  const totalCrimesCommitted = crimes?.crimes?.reduce((sum, c) => sum + (c.attempts?.total ?? 0), 0) ?? 0;

  // Active benefits count
  const activeStockBlocks = portfolio?.stocks?.benefits?.filter(b => b.active_increments >= 1).length ?? 0;
  const totalStockBlocks = portfolio?.stocks?.benefits?.length ?? 0;

  // Recommended focus crime name
  const focusCrimeId = crimes?.recommendations?.focus_crime_id;
  const recommendedCrimeName = focusCrimeId
    ? crimes?.crimes?.find(c => c.id === focusCrimeId)?.name ?? "N/A"
    : "N/A";

  // Total crimes success rate
  const totalCrimeSuccesses = crimes?.crimes?.reduce((sum, c) => sum + (c.attempts?.success ?? 0), 0) ?? 0;
  const crimesSuccessRate = totalCrimesCommitted > 0 ? (totalCrimeSuccesses / totalCrimesCommitted) * 100 : 0;

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Title Section */}
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <h1 className="text-3xl font-extrabold tracking-tight text-zinc-900 dark:text-zinc-50 font-heading">
              Overview
            </h1>

          </div>

        </div>

        {/* Top Summary Stats */}
        {loading ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {[...Array(4)].map((_, i) => (
              <Card key={i} className="animate-pulse border-zinc-200 dark:border-zinc-900 h-28 bg-white/50 dark:bg-zinc-950/50" />
            ))}
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Card className="border-zinc-200 dark:border-zinc-900 bg-white/50 dark:bg-zinc-950/50 backdrop-blur shadow-sm relative overflow-hidden group">
              <div className="absolute top-0 right-0 h-16 w-16 bg-emerald-500/10 rounded-bl-full flex items-center justify-center transition-all group-hover:scale-110">
                <Landmark className="h-5 w-5 text-emerald-500" />
              </div>
              <CardHeader className="pb-2">
                <CardDescription className="text-xs uppercase tracking-wider text-zinc-500">Net Worth</CardDescription>
                <CardTitle className="text-2xl font-bold font-heading text-emerald-600 dark:text-emerald-400">
                  {formatCurrency(totalNetworth)}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-[10px] text-zinc-400 font-medium">Liquid: {formatCurrency(ledger?.liquid_capital ?? 0)}</p>
              </CardContent>
            </Card>

            <Card className="border-zinc-200 dark:border-zinc-900 bg-white/50 dark:bg-zinc-950/50 backdrop-blur shadow-sm relative overflow-hidden group">
              <div className="absolute top-0 right-0 h-16 w-16 bg-indigo-500/10 rounded-bl-full flex items-center justify-center transition-all group-hover:scale-110">
                <TrendingUp className="h-5 w-5 text-indigo-500" />
              </div>
              <CardHeader className="pb-2">
                <CardDescription className="text-xs uppercase tracking-wider text-zinc-500">Stock Assets</CardDescription>
                <CardTitle className="text-2xl font-bold font-heading text-indigo-600 dark:text-indigo-400">
                  {formatCurrency(totalStockAssets)}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-[10px] text-zinc-400 font-medium">{activeStockBlocks} / {totalStockBlocks} benefit blocks active</p>
              </CardContent>
            </Card>

            <Card className="border-zinc-200 dark:border-zinc-900 bg-white/50 dark:bg-zinc-950/50 backdrop-blur shadow-sm relative overflow-hidden group">
              <div className="absolute top-0 right-0 h-16 w-16 bg-amber-500/10 rounded-bl-full flex items-center justify-center transition-all group-hover:scale-110">
                <Dumbbell className="h-5 w-5 text-amber-500" />
              </div>
              <CardHeader className="pb-2">
                <CardDescription className="text-xs uppercase tracking-wider text-zinc-500">Total Attributes</CardDescription>
                <CardTitle className="text-2xl font-bold font-heading text-amber-600 dark:text-amber-400">
                  {formatShortNumber(totalGymStats)}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-[10px] text-zinc-400 font-medium">Active: {gym?.activeGym ?? "Loading..."}</p>
              </CardContent>
            </Card>

            <Card className="border-zinc-200 dark:border-zinc-900 bg-white/50 dark:bg-zinc-950/50 backdrop-blur shadow-sm relative overflow-hidden group">
              <div className="absolute top-0 right-0 h-16 w-16 bg-rose-500/10 rounded-bl-full flex items-center justify-center transition-all group-hover:scale-110">
                <Fingerprint className="h-5 w-5 text-rose-500" />
              </div>
              <CardHeader className="pb-2">
                <CardDescription className="text-xs uppercase tracking-wider text-zinc-500">Crimes Committed</CardDescription>
                <CardTitle className="text-2xl font-bold font-heading text-rose-600 dark:text-rose-400">
                  {totalCrimesCommitted.toLocaleString()}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-[10px] text-zinc-400 font-medium">Success Rate: {crimesSuccessRate.toFixed(1)}%</p>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Modules Section */}
        <h2 className="text-lg font-bold text-zinc-800 dark:text-zinc-200 font-heading">
          Core Modules
        </h2>

        {loading ? (
          <div className="grid gap-6 md:grid-cols-2">
            {[...Array(4)].map((_, i) => (
              <Card key={i} className="animate-pulse border-zinc-200 dark:border-zinc-900 h-44 bg-white/50 dark:bg-zinc-950/50" />
            ))}
          </div>
        ) : (
          <div className="grid gap-6 md:grid-cols-2">
            {/* Wealth Summary Card */}
            <Card className="border-zinc-200 dark:border-zinc-900 bg-white/50 dark:bg-zinc-950/50 shadow-sm hover:shadow-md transition-shadow flex flex-col justify-between">
              <CardHeader className="pb-3">
                <div className="flex items-center gap-2">
                  <div className="p-1.5 rounded bg-emerald-500/10 text-emerald-500">
                    <Landmark className="h-5 w-5" />
                  </div>
                  <div>
                    <CardTitle className="text-base font-bold font-heading">Wealth & Finance Ledger</CardTitle>
                    <CardDescription className="text-xs">Balance logs, daily net profits, and cashflow details</CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4 flex-1 flex flex-col justify-between">
                <div className="grid grid-cols-2 gap-4 bg-zinc-50/50 dark:bg-zinc-900/30 p-3 rounded-lg border border-zinc-200/40 dark:border-zinc-800/40">
                  <div>
                    <span className="text-[10px] text-zinc-400 uppercase font-bold tracking-wider">Inflow Total</span>
                    <p className="text-sm font-bold text-zinc-800 dark:text-zinc-200 mt-0.5">{formatCurrency(ledger?.income?.total ?? 0)}</p>
                  </div>
                  <div>
                    <span className="text-[10px] text-zinc-400 uppercase font-bold tracking-wider">Outflow Total</span>
                    <p className="text-sm font-bold text-zinc-800 dark:text-zinc-200 mt-0.5">{formatCurrency(ledger?.expenses?.total ?? 0)}</p>
                  </div>
                </div>
                <Link
                  href="/finance"
                  className="flex items-center justify-between text-xs font-bold text-emerald-600 dark:text-emerald-400 hover:underline pt-2"
                >
                  <span>Go to Finance Ledger</span>
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </CardContent>
            </Card>

            {/* Investments Card */}
            <Card className="border-zinc-200 dark:border-zinc-900 bg-white/50 dark:bg-zinc-950/50 shadow-sm hover:shadow-md transition-shadow flex flex-col justify-between">
              <CardHeader className="pb-3">
                <div className="flex items-center gap-2">
                  <div className="p-1.5 rounded bg-indigo-500/10 text-indigo-500">
                    <TrendingUp className="h-5 w-5" />
                  </div>
                  <div>
                    <CardTitle className="text-base font-bold font-heading">Stock Investments Portfolio</CardTitle>
                    <CardDescription className="text-xs">Benefit increments, buy price tracking, and APR sorting</CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4 flex-1 flex flex-col justify-between">
                <div className="grid grid-cols-2 gap-4 bg-zinc-50/50 dark:bg-zinc-900/30 p-3 rounded-lg border border-zinc-200/40 dark:border-zinc-800/40">
                  <div>
                    <span className="text-[10px] text-zinc-400 uppercase font-bold tracking-wider">Portfolio Assets</span>
                    <p className="text-sm font-bold text-zinc-800 dark:text-zinc-200 mt-0.5">{formatCurrency(totalStockAssets)}</p>
                  </div>
                  <div>
                    <span className="text-[10px] text-zinc-400 uppercase font-bold tracking-wider">Active Blocks</span>
                    <p className="text-sm font-bold text-zinc-800 dark:text-zinc-200 mt-0.5">{activeStockBlocks} / {totalStockBlocks}</p>
                  </div>
                </div>
                <Link
                  href="/portfolio"
                  className="flex items-center justify-between text-xs font-bold text-indigo-600 dark:text-indigo-400 hover:underline pt-2"
                >
                  <span>Go to Stock Portfolio</span>
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </CardContent>
            </Card>

            {/* Gym Card */}
            <Card className="border-zinc-200 dark:border-zinc-900 bg-white/50 dark:bg-zinc-950/50 shadow-sm hover:shadow-md transition-shadow flex flex-col justify-between">
              <CardHeader className="pb-3">
                <div className="flex items-center gap-2">
                  <div className="p-1.5 rounded bg-amber-500/10 text-amber-500">
                    <Dumbbell className="h-5 w-5" />
                  </div>
                  <div>
                    <CardTitle className="text-base font-bold font-heading">Gym Analytics & Milestones</CardTitle>
                    <CardDescription className="text-xs">Stat progression, average energy, and booster efficiency</CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4 flex-1 flex flex-col justify-between">
                <div className="grid grid-cols-2 gap-4 bg-zinc-50/50 dark:bg-zinc-900/30 p-3 rounded-lg border border-zinc-200/40 dark:border-zinc-800/40">
                  <div>
                    <span className="text-[10px] text-zinc-400 uppercase font-bold tracking-wider">Active Gym</span>
                    <p className="text-sm font-bold text-zinc-800 dark:text-zinc-200 mt-0.5 truncate">{gym?.activeGym ?? "N/A"}</p>
                  </div>
                  <div>
                    <span className="text-[10px] text-zinc-400 uppercase font-bold tracking-wider">Avg. Daily Energy</span>
                    <p className="text-sm font-bold text-zinc-800 dark:text-zinc-200 mt-0.5">{gym?.avgDailyEnergy ?? 0} E</p>
                  </div>
                </div>
                <Link
                  href="/gym"
                  className="flex items-center justify-between text-xs font-bold text-amber-600 dark:text-amber-400 hover:underline pt-2"
                >
                  <span>Go to Gym Analytics</span>
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </CardContent>
            </Card>

            {/* Crimes Card */}
            <Card className="border-zinc-200 dark:border-zinc-900 bg-white/50 dark:bg-zinc-950/50 shadow-sm hover:shadow-md transition-shadow flex flex-col justify-between">
              <CardHeader className="pb-3">
                <div className="flex items-center gap-2">
                  <div className="p-1.5 rounded bg-rose-500/10 text-rose-500">
                    <Fingerprint className="h-5 w-5" />
                  </div>
                  <div>
                    <CardTitle className="text-base font-bold font-heading">Crimes & Nerve Efficiency</CardTitle>
                    <CardDescription className="text-xs">Nerve yields, success probabilities, and focus recommendations</CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4 flex-1 flex flex-col justify-between">
                <div className="grid grid-cols-2 gap-4 bg-zinc-50/50 dark:bg-zinc-900/30 p-3 rounded-lg border border-zinc-200/40 dark:border-zinc-800/40">
                  <div>
                    <span className="text-[10px] text-zinc-400 uppercase font-bold tracking-wider">Focus Target</span>
                    <p className="text-sm font-bold text-zinc-800 dark:text-zinc-200 mt-0.5 truncate">{recommendedCrimeName}</p>
                  </div>
                  <div>
                    <span className="text-[10px] text-zinc-400 uppercase font-bold tracking-wider">Average Success</span>
                    <p className="text-sm font-bold text-zinc-800 dark:text-zinc-200 mt-0.5">{crimesSuccessRate.toFixed(1)}%</p>
                  </div>
                </div>
                <Link
                  href="/crimes"
                  className="flex items-center justify-between text-xs font-bold text-rose-600 dark:text-rose-400 hover:underline pt-2"
                >
                  <span>Go to Crimes Analysis</span>
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
