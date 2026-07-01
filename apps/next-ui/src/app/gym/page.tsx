"use client";

import { useState, useEffect } from "react";
import { DashboardLayout } from "@/components/dashboard-layout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, ResponsiveContainer } from "recharts";
import { Flame, Sparkles, RefreshCw, ArrowRight, Target } from "lucide-react";
import { toast } from "sonner";
import { ErrorState } from "@/components/error-state";

interface MilestoneInfo {
  target: number;
  days: number | null;
  energy: number | null;
}

interface ProjectionInfo {
  stat: string;
  currentValue: number;
  allocation: number;
  dailyEnergy: number;
  milestones: MilestoneInfo[];
}

interface HistoryLog {
  day: string;
  strength: number;
  speed: number;
  defense: number;
  dexterity: number;
  energy: number;
}

interface GymLog {
  id: string;
  timestamp: number;
  stat: string;
  gain: number;
  energy: number;
  happy: number;
  gym_name: string | null;
}

interface MilestonesData {
  currentStats: {
    strength: number;
    speed: number;
    defense: number;
    dexterity: number;
    total: number;
  };
  activeGym: string;
  avgHappy: number;
  maxHappy: number;
  currentHappy: number;
  avgDailyEnergy: number;
  projections: ProjectionInfo[];
  history: HistoryLog[];
  recentLogs: GymLog[];
  syncStatus: {
    totalRecords: number;
    lastSyncAt: string | null;
    nextRunAt: string | null;
    isBackfillComplete: boolean;
  };
  recommendation: {
    stat: string;
    statKey: string;
    diff: number;
    text: string;
    gymRecommendation: string | null;
    currentEnergy: number;
    maxEnergy: number;
    factionPerks: Record<string, number>;
  };
}

const chartConfig = {
  strength: {
    label: "Strength",
    color: "var(--color-strength)",
  },
  speed: {
    label: "Speed",
    color: "var(--color-speed)",
  },
  defense: {
    label: "Defense",
    color: "var(--color-defense)",
  },
  dexterity: {
    label: "Dexterity",
    color: "var(--color-dexterity)",
  },
};

function formatRelativeTime(timestamp: number) {
  const diff = Date.now() - timestamp * 1000;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function formatNumber(num: number) {
  return new Intl.NumberFormat().format(Math.round(num * 100) / 100);
}

function formatShortNumber(num: number) {
  if (num >= 1e9) {
    return (num / 1e9).toFixed(1).replace(/\.0$/, "") + "b";
  }
  if (num >= 1e6) {
    return (num / 1e6).toFixed(1).replace(/\.0$/, "") + "m";
  }
  if (num >= 1e3) {
    return (num / 1e3).toFixed(1).replace(/\.0$/, "") + "k";
  }
  return num.toString();
}

export default function GymPage() {
  const [timeframe, setTimeframe] = useState<"7d" | "30d" | "90d" | "all">("30d");
  const [data, setData] = useState<MilestonesData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchData = async (tf: typeof timeframe, showRefreshIndicator = false) => {
    setError(null);
    if (showRefreshIndicator) setRefreshing(true);
    if (!data) setLoading(true);
    try {
      const res = await fetch(`/api/bot/config/personal/milestones?timeframe=${tf}`);
      if (res.ok) {
        const json = await res.json();
        setData(json);
        if (showRefreshIndicator) {
          toast.success("Gym milestones updated successfully");
        }
      } else {
        throw new Error(`Server returned ${res.status} ${res.statusText}`);
      }
    } catch (err: unknown) {
      console.error("Error fetching milestones data:", err);
      setError(err instanceof Error ? err.message : String(err));
      toast.error("Network error fetching milestones data");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchData(timeframe);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeframe]);

  const handleSyncClick = () => {
    fetchData(timeframe, true);
  };

  if (loading && !data) {
    return (
      <DashboardLayout>
        <div className="flex h-64 items-center justify-center gap-2">
          <RefreshCw className="h-6 w-6 animate-spin text-amber-500" />
          <span className="text-zinc-500 dark:text-zinc-400">Loading gym analytics...</span>
        </div>
      </DashboardLayout>
    );
  }

  if (error && !data) {
    return (
      <DashboardLayout>
        <div className="space-y-6">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold tracking-tight md:text-3xl">Gym</h1>
              <p className="text-zinc-500 dark:text-zinc-400">
                Track your gym gains, analyze training efficiency, and get optimal gym recommendations.
              </p>
            </div>
          </div>
          <ErrorState
            title="Failed to Load Gym Data"
            description="We were unable to connect to the bot server to retrieve your gym logs and training recommendations."
            errorDetails={error}
            onRetry={() => fetchData(timeframe)}
          />
        </div>
      </DashboardLayout>
    );
  }

  if (!data) {
    return null;
  }

  const gymCards = [
    {
      title: "Training Target",
      value: `${data.recommendation.stat}`,
      icon: Target,
      iconColor: "text-indigo-500",
    },
    {
      title: "Avg. Daily Energy",
      value: `${formatNumber(data.avgDailyEnergy)} E`,
      description: "Based on recent activity",
      icon: Flame,
      iconColor: "text-rose-500",
    },

  ];

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight md:text-3xl">Gym</h1>
            <p className="text-zinc-500 dark:text-zinc-400">
              Track your gym gains, analyze training efficiency, and get optimal gym recommendations.
            </p>
          </div>
          <button
            onClick={handleSyncClick}
            disabled={refreshing}
            className="inline-flex h-9 items-center justify-center gap-2 rounded-xl bg-amber-500 px-4 text-sm font-semibold text-zinc-950 hover:bg-amber-600 transition-colors shadow-md disabled:opacity-50 cursor-pointer"
          >
            <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
            <span>Sync</span>
          </button>
        </div>

        {/* Switch Recommendation Banner */}
        {data.recommendation.gymRecommendation && (
          <Card className="border-zinc-200 dark:border-zinc-900 bg-gradient-to-r from-amber-500/10 via-rose-500/5 to-transparent relative overflow-hidden">
            <div className="absolute inset-0 bg-grid-white/[0.02] dark:bg-grid-zinc-950/[0.05]" />
            <CardContent className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 p-6">
              <div className="space-y-1 z-10">
                <div className="flex items-center gap-2 text-amber-600 dark:text-amber-400 font-semibold text-sm">
                  <Sparkles className="h-4 w-4" />
                  <span>Gym Optimization Alert</span>
                </div>
                <h3 className="text-lg font-bold">Switch to {data.recommendation.gymRecommendation} Recommended</h3>
                <p className="text-sm text-zinc-500 dark:text-zinc-400 max-w-2xl">
                  Your current active focus is <strong>{data.recommendation.stat}</strong>, but you are training in <strong>{data.activeGym}</strong>.
                  Switching to <strong>{data.recommendation.gymRecommendation}</strong> will optimize your attribute training multiplier gains.
                </p>
              </div>
              <a
                href="https://www.torn.com/gym.php"
                target="_blank"
                rel="noopener noreferrer"
                className="z-10 inline-flex items-center justify-center gap-2 rounded-xl bg-zinc-900 px-4 py-2.5 text-xs font-bold text-white dark:bg-white dark:text-zinc-950 hover:opacity-90 transition-opacity"
              >
                <span>Open Gym Page</span>
                <ArrowRight className="h-3 w-3" />
              </a>
            </CardContent>
          </Card>
        )}

        {/* Stats Grid */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {gymCards.map((card, idx) => {
            const Icon = card.icon;
            return (
              <Card key={idx} className="border-zinc-200 dark:border-zinc-900 bg-white/50 dark:bg-zinc-950/50 backdrop-blur">
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                  <CardTitle className="text-sm font-medium text-zinc-500">{card.title}</CardTitle>
                  <Icon className={`h-4 w-4 ${card.iconColor}`} />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{card.value}</div>
                  <p className="text-xs text-zinc-500 mt-1">{card.description}</p>
                </CardContent>
              </Card>
            );
          })}
        </div>

        {/* Progression Chart & Logs Table */}
        <div className="grid gap-4 lg:grid-cols-7">
          {/* Recharts Chart */}
          <Card className="col-span-4 border-zinc-200 dark:border-zinc-900 bg-white/50 dark:bg-zinc-950/50 backdrop-blur">
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle>Training Gains Progression</CardTitle>
                <CardDescription>Daily stat increases mapped across attributes.</CardDescription>
              </div>
              <div className="flex rounded-lg border border-zinc-200 dark:border-zinc-800 p-0.5 text-xs bg-zinc-100 dark:bg-zinc-900 select-none">
                {(["7d", "30d", "90d", "all"] as const).map((tf) => (
                  <button
                    key={tf}
                    onClick={() => setTimeframe(tf)}
                    className={`px-2.5 py-1 rounded-md font-semibold transition-all cursor-pointer ${timeframe === tf
                      ? "bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 shadow-sm"
                      : "text-zinc-500 hover:text-zinc-950 dark:hover:text-zinc-200"
                      }`}
                  >
                    {tf.toUpperCase()}
                  </button>
                ))}
              </div>
            </CardHeader>
            <CardContent>
              {data.history.length === 0 ? (
                <div className="h-[300px] flex items-center justify-center text-zinc-400 text-sm">
                  No historical log data available for this timeframe.
                </div>
              ) : (
                <div className="h-[300px] w-full mt-2">
                  <ChartContainer config={chartConfig} className="h-full w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={data.history} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                        <defs>
                          <linearGradient id="colorStrength" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#ef4444" stopOpacity={0.2} />
                            <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
                          </linearGradient>
                          <linearGradient id="colorSpeed" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.2} />
                            <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                          </linearGradient>
                          <linearGradient id="colorDefense" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#10b981" stopOpacity={0.2} />
                            <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                          </linearGradient>
                          <linearGradient id="colorDexterity" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.2} />
                            <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" className="stroke-zinc-200 dark:stroke-zinc-900" vertical={false} />
                        <XAxis dataKey="day" stroke="#888888" fontSize={10} tickLine={false} axisLine={false} />
                        <YAxis stroke="#888888" fontSize={10} tickLine={false} axisLine={false} tickFormatter={formatShortNumber} />
                        <ChartTooltip content={<ChartTooltipContent />} />
                        <Area type="monotone" dataKey="strength" stroke="#ef4444" fillOpacity={1} fill="url(#colorStrength)" strokeWidth={2} />
                        <Area type="monotone" dataKey="speed" stroke="#3b82f6" fillOpacity={1} fill="url(#colorSpeed)" strokeWidth={2} />
                        <Area type="monotone" dataKey="defense" stroke="#10b981" fillOpacity={1} fill="url(#colorDefense)" strokeWidth={2} />
                        <Area type="monotone" dataKey="dexterity" stroke="#8b5cf6" fillOpacity={1} fill="url(#colorDexterity)" strokeWidth={2} />
                      </AreaChart>
                    </ResponsiveContainer>
                  </ChartContainer>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Logs Table */}
          <Card className="col-span-4 lg:col-span-3 border-zinc-200 dark:border-zinc-900 bg-white/50 dark:bg-zinc-950/50 backdrop-blur">
            <CardHeader>
              <CardTitle>Recent Training Logs</CardTitle>
              <CardDescription>Direct synchronization records from Torn API.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="overflow-hidden">
                {data.recentLogs.length === 0 ? (
                  <div className="py-12 text-center text-zinc-400 text-xs">
                    No recent training logs found.
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Stat</TableHead>
                        <TableHead className="text-right">Gain</TableHead>
                        <TableHead className="text-right">Energy</TableHead>
                        <TableHead className="text-right">Happy</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.recentLogs.map((log) => {
                        const capitalize = (str: string) => str.charAt(0).toUpperCase() + str.slice(1);
                        return (
                          <TableRow key={log.id}>
                            <TableCell>
                              <div className="flex flex-col gap-1">
                                <span className="font-semibold text-xs text-zinc-900 dark:text-zinc-100">{capitalize(log.stat)}</span>
                                <span className="text-[10px] text-zinc-500 font-mono" title={new Date(log.timestamp * 1000).toLocaleString()}>
                                  {formatRelativeTime(log.timestamp)}
                                </span>
                              </div>
                            </TableCell>
                            <TableCell className="text-right font-medium text-xs font-mono text-emerald-500">
                              +{formatNumber(log.gain)}
                            </TableCell>
                            <TableCell className="text-right font-medium text-xs font-mono text-zinc-700 dark:text-zinc-300">
                              {log.energy} E
                            </TableCell>
                            <TableCell className="text-right font-mono text-xs text-amber-500">
                              {formatNumber(log.happy)} H
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </DashboardLayout>
  );
}
