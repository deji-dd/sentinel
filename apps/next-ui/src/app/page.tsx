"use client";

import { DashboardLayout } from "@/components/dashboard-layout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Bar, BarChart, XAxis, YAxis } from "recharts";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { ShieldAlert, Users, HeartPulse, Zap } from "lucide-react";

// Mock data for the sync chart
const chartData = [
  { name: "Mon", hits: 120 },
  { name: "Tue", hits: 180 },
  { name: "Wed", hits: 340 },
  { name: "Thu", hits: 280 },
  { name: "Fri", hits: 420 },
  { name: "Sat", hits: 390 },
  { name: "Sun", hits: 450 },
];

const chartConfig = {
  hits: {
    label: "Sync Requests",
    color: "var(--color-hits)",
  },
};

export default function Home() {
  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header Title Section */}
        <div>
          <h1 className="text-2xl font-bold tracking-tight md:text-3xl">Overview</h1>
          <p className="text-zinc-500 dark:text-zinc-400">
            Real-time status of Torn integrations and Sentinel synchronization schedules.
          </p>
        </div>

        {/* Stats Grid */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Card className="border-zinc-200 dark:border-zinc-900 bg-white/50 dark:bg-zinc-950/50 backdrop-blur">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-zinc-500">Tracked Targets</CardTitle>
              <ShieldAlert className="h-4 w-4 text-rose-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">14</div>
              <p className="text-xs text-rose-500">3 online targets active</p>
            </CardContent>
          </Card>

          <Card className="border-zinc-200 dark:border-zinc-900 bg-white/50 dark:bg-zinc-950/50 backdrop-blur">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-zinc-500">Active Factions</CardTitle>
              <Users className="h-4 w-4 text-amber-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">2</div>
              <p className="text-xs text-zinc-500">Main and sister alliances</p>
            </CardContent>
          </Card>

          <Card className="border-zinc-200 dark:border-zinc-900 bg-white/50 dark:bg-zinc-950/50 backdrop-blur">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-zinc-500">Revives Assisted</CardTitle>
              <HeartPulse className="h-4 w-4 text-emerald-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">1,842</div>
              <p className="text-xs text-emerald-500">+12% increase this week</p>
            </CardContent>
          </Card>

          <Card className="border-zinc-200 dark:border-zinc-900 bg-white/50 dark:bg-zinc-950/50 backdrop-blur">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-zinc-500">Sync Health</CardTitle>
              <Zap className="h-4 w-4 text-amber-400" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">99.8%</div>
              <p className="text-xs text-zinc-500">Last run 42s ago</p>
            </CardContent>
          </Card>
        </div>

        {/* Charts & Log Activity Feed */}
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-7">
          <Card className="col-span-4 border-zinc-200 dark:border-zinc-900 bg-white/50 dark:bg-zinc-950/50 backdrop-blur">
            <CardHeader>
              <CardTitle>Sync Activity</CardTitle>
              <CardDescription>Torn City API queries processed per day by worker sync processes.</CardDescription>
            </CardHeader>
            <CardContent className="pl-2">
              <div className="h-[240px] w-full">
                <ChartContainer config={chartConfig} className="h-full w-full">
                  <BarChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                    <XAxis
                      dataKey="name"
                      stroke="#888888"
                      fontSize={12}
                      tickLine={false}
                      axisLine={false}
                    />
                    <YAxis
                      stroke="#888888"
                      fontSize={12}
                      tickLine={false}
                      axisLine={false}
                      tickFormatter={(value) => `${value}`}
                    />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <Bar
                      dataKey="hits"
                      fill="var(--color-hits)"
                      radius={[4, 4, 0, 0]}
                      className="fill-amber-500 dark:fill-amber-400"
                    />
                  </BarChart>
                </ChartContainer>
              </div>
            </CardContent>
          </Card>

          <Card className="col-span-3 border-zinc-200 dark:border-zinc-900 bg-white/50 dark:bg-zinc-950/50 backdrop-blur">
            <CardHeader>
              <CardTitle>System Log Summary</CardTitle>
              <CardDescription>Recent logs reported by bot HTTP and sync workers.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {[
                  {
                    app: "bot",
                    msg: "WebSocket client connected to real-time feed",
                    time: "Just now",
                    level: "info",
                  },
                  {
                    app: "worker",
                    msg: "Sync completed for faction alliances snapshot",
                    time: "2m ago",
                    level: "info",
                  },
                  {
                    app: "bot",
                    msg: "API secret token verification succeeded",
                    time: "5m ago",
                    level: "info",
                  },
                  {
                    app: "worker",
                    msg: "Rate limiter threshold reached for public endpoint",
                    time: "12m ago",
                    level: "warning",
                  },
                ].map((log, idx) => (
                  <div key={idx} className="flex items-start justify-between text-xs">
                    <div className="space-y-1">
                      <span
                        className={`inline-flex items-center rounded-md px-1.5 py-0.5 font-medium ring-1 ring-inset ${
                          log.app === "bot"
                            ? "bg-indigo-500/10 text-indigo-500 dark:bg-indigo-500/15 dark:text-indigo-400 ring-indigo-500/20"
                            : "bg-amber-500/10 text-amber-500 dark:bg-amber-500/15 dark:text-amber-400 ring-amber-500/20"
                        }`}
                      >
                        {log.app}
                      </span>
                      <p className="text-zinc-600 dark:text-zinc-300 font-mono mt-1 pr-4">{log.msg}</p>
                    </div>
                    <span className="text-[10px] text-zinc-500 whitespace-nowrap">{log.time}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>


      </div>
    </DashboardLayout>
  );
}
