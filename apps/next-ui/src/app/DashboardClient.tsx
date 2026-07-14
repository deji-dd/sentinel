"use client";

import React, { useState, useEffect } from "react";
import { useSync } from "@/hooks/use-sync";
import { Card, CardContent } from "@/components/ui/card";
import { DashboardLayout } from "@/components/dashboard-layout";
import { Activity, Cpu, Database, Network, Clock, ServerCrash } from "lucide-react";

const now = Date.now();

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function DashboardClient({ initialData }: { initialData: any }) {

  const [data, setData] = useState(initialData || {
    status: "offline",
    uptime: 0,
    timestamp: now,
    system: { memory: { total: 0, used: 0, free: 0, percent: 0 }, cpu: { cores: 0, model: "", load: 0 } },
    services: [],
    ledger: { active_parsers: 0, events_processed_today: 0 }
  });

  const [syncData, setSyncData] = useState<{
    is_historical_sync_complete: boolean;
    earliest_timestamp: number;
    latest_timestamp: number;
  } | null>(null);

  const { setSyncOptions, setLastSyncedText } = useSync();

  const fetchStatus = async () => {
    try {
      const res = await fetch("/api/status", {
        cache: "no-store",
      });
      if (res.ok) {
        const freshData = await res.json();
        setData(freshData);
        setLastSyncedText(`Last synced at ${new Date().toLocaleTimeString()}`);
      } else {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        setData((prev: any) => ({ ...prev, status: "offline" }));
      }
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
    } catch (err) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      setData((prev: any) => ({ ...prev, status: "offline" }));
    }

    try {
      const syncRes = await fetch("/api/status/sync", { cache: "no-store" });
      if (syncRes.ok) {
        const syncJson = await syncRes.json();
        setSyncData(syncJson);
      }
    } catch (err) {
      console.error("Failed to fetch sync status", err);
    }
  };

  useEffect(() => {
    let isMounted = true;
    setTimeout(() => {
      if (!isMounted) return;
      setSyncOptions([
        {
          label: "Sync Gateway Status",
          action: fetchStatus,
        },
      ]);

      if (data.status !== "offline") {
        setLastSyncedText(`Last synced at ${new Date().toLocaleTimeString()}`);
      }
    }, 0);

    // Initial fetch on page load
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchStatus();

    return () => {
      isMounted = false;
      setTimeout(() => {
        setSyncOptions(null);
        setLastSyncedText("");
      }, 0);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setSyncOptions, setLastSyncedText]);



  const isOnline = data.status === "online";

  return (
    <DashboardLayout>
      <div className="md:p-8 p-0 max-w-7xl mx-auto min-h-screen pt-15 md:pt-20">

        <div className="flex items-center justify-between mb-12">
          <div>
            <h1 className="text-5xl font-black tracking-tighter text-zinc-900 dark:text-zinc-50 mb-2">
              System Overview
            </h1>
            <p className="text-zinc-500 dark:text-zinc-400 flex items-center gap-2">
              <span className="relative flex h-3 w-3">
                {isOnline && <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>}
                <span className={`relative inline-flex rounded-full h-3 w-3 ${isOnline ? 'bg-emerald-500' : 'bg-red-500'}`}></span>
              </span>
              {isOnline ? "Gateway Online & Routing" : "Gateway Offline"}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">

          {/* Left Column: System Vitals */}
          <div className="space-y-8">
            <Card>
              <CardContent className="p-6">
                <div className="flex items-center gap-3 mb-6">
                  <div className="p-2 bg-indigo-500/20 text-indigo-400 rounded-lg">
                    <Activity size={24} />
                  </div>
                  <h2 className="text-xl font-bold">System Vitals</h2>
                </div>

                <div className="space-y-6">
                  <div>
                    <div className="flex justify-between text-sm mb-2">
                      <span className="text-zinc-400 flex items-center gap-2"><Cpu size={14} /> CPU Load</span>
                      <span className="font-mono">{data.system.cpu.load}%</span>
                    </div>
                    <div className="h-2 w-full bg-zinc-800/50 rounded-full overflow-hidden">
                      <div className="h-full bg-indigo-500 rounded-full" style={{ width: `${Math.min(data.system.cpu.load, 100)}%` }} />
                    </div>
                  </div>

                  <div>
                    <div className="flex justify-between text-sm mb-2">
                      <span className="text-zinc-400 flex items-center gap-2"><Database size={14} /> Memory Usage</span>
                      <span className="font-mono">{data.system.memory.percent}%</span>
                    </div>
                    <div className="h-2 w-full bg-zinc-800/50 rounded-full overflow-hidden">
                      <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${data.system.memory.percent}%` }} />
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-6">
                <div className="flex items-center gap-3 mb-4">
                  <div className="p-2 bg-violet-500/20 text-violet-400 rounded-lg">
                    <Clock size={24} />
                  </div>
                  <h2 className="text-xl font-bold">Gateway Uptime</h2>
                </div>
                <div className="text-4xl font-black font-mono tracking-tighter mb-4">
                  {Math.floor(data.uptime / 3600)}<span className="text-zinc-500 text-xl font-sans">h</span> {" "}
                  {Math.floor((data.uptime % 3600) / 60)}<span className="text-zinc-500 text-xl font-sans">m</span>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-6 flex flex-col justify-between">
                <div className="flex items-center gap-2 mb-4">
                  <Database size={16} className="text-blue-500" />
                  <h3 className="font-semibold text-sm">Ledger Backfill Status</h3>
                </div>

                {syncData ? (
                  <div className="space-y-4">
                    {syncData.is_historical_sync_complete ? (
                      <div className="flex items-center gap-2 text-emerald-400 bg-emerald-500/10 p-3 rounded-lg border border-emerald-500/20">
                        <Activity size={16} />
                        <span className="font-medium text-sm">100% Complete</span>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        <div className="flex items-center gap-2 text-amber-400 bg-amber-500/10 p-3 rounded-lg border border-amber-500/20">
                          <Clock size={16} className="animate-pulse" />
                          <span className="font-medium text-sm">Backfilling in progress...</span>
                        </div>
                        <div className="text-xs text-muted-foreground flex justify-between">
                          <span>Reached Date:</span>
                          <span className="font-mono text-foreground">
                            {new Date(syncData.earliest_timestamp * 1000).toLocaleDateString()}
                          </span>
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="text-sm text-zinc-500">Status unknown</div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Middle Column: Architecture Matrix */}
          <div className="md:col-span-2 space-y-8">
            <Card className="h-full">
              <CardContent className="p-6">
                <div className="flex items-center gap-3 mb-8">
                  <div className="p-2 bg-emerald-500/20 text-emerald-400 rounded-lg">
                    <Network size={24} />
                  </div>
                  <h2 className="text-xl font-bold">Service Routing Matrix</h2>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {data.services.length > 0 ? (
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    data.services.map((service: any, idx: number) => (
                      <div key={idx} className="p-4 rounded-xl bg-white/5 dark:bg-black/20 border border-white/5 hover:bg-white/10 transition-colors">
                        <div className="flex items-center justify-between mb-2">
                          <span className="font-semibold text-sm">{service.name}</span>
                          <span className={`px-2 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider ${service.status === 'healthy' || service.status === 'connected'
                            ? 'bg-emerald-500/20 text-emerald-400'
                            : 'bg-red-500/20 text-red-400'
                            }`}>
                            {service.status}
                          </span>
                        </div>
                        <div className="flex items-center gap-4 text-xs text-zinc-500">
                          <span className="flex items-center gap-1">
                            <Activity size={12} />
                            {service.latency}ms latency
                          </span>
                          {service.cpu !== undefined && (
                            <span className="flex items-center gap-1">
                              <Cpu size={12} />
                              {service.cpu}%
                            </span>
                          )}
                          {service.memory !== undefined && (
                            <span className="flex items-center gap-1">
                              <Database size={12} />
                              {service.memory} MB
                            </span>
                          )}
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="col-span-2 py-12 flex flex-col items-center justify-center text-zinc-500">
                      <ServerCrash size={48} className="mb-4 opacity-50" />
                      <p>Gateway Unreachable. Services unknown.</p>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>

        </div>
      </div>
    </DashboardLayout>
  );
}
