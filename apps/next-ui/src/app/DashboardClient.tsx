"use client";

import React, { useRef, useState, useEffect } from "react";
import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { GlassCard } from "@/components/dashboard/GlassCard";
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
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        const res = await fetch("/api/status", {
          cache: "no-store",
          signal: AbortSignal.timeout(2000),
        });
        if (res.ok) {
          const freshData = await res.json();
          setData(freshData);
        } else {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          setData((prev: any) => ({ ...prev, status: "offline" }));
        }
      } catch (err) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        setData((prev: any) => ({ ...prev, status: "offline" }));
      }
    }, 3000);
    return () => clearInterval(interval);
  }, []);

  useGSAP(() => {
    // Staggered entrance animation for all glass cards
    gsap.from(".glass-widget", {
      y: 50,
      opacity: 0,
      duration: 1,
      stagger: 0.1,
      ease: "back.out(1.2)",
      delay: 0.2,
      clearProps: "all"
    });

    // Animate the main title
    gsap.from(".dashboard-title", {
      y: -30,
      opacity: 0,
      duration: 1,
      ease: "power3.out"
    });
  }, { scope: containerRef, dependencies: [] });

  const isOnline = data.status === "online";

  return (
    <DashboardLayout>
        <div ref={containerRef} className="p-8 max-w-7xl mx-auto min-h-screen pt-20">

          <div className="flex items-center justify-between mb-12">
            <div className="dashboard-title">
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
              <GlassCard className="glass-widget" tiltIntensity={10}>
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
              </GlassCard>

              <GlassCard className="glass-widget" tiltIntensity={15}>
                <div className="flex items-center gap-3 mb-4">
                  <div className="p-2 bg-violet-500/20 text-violet-400 rounded-lg">
                    <Clock size={24} />
                  </div>
                  <h2 className="text-xl font-bold">Gateway Uptime</h2>
                </div>
                <div className="text-4xl font-black font-mono tracking-tighter">
                  {Math.floor(data.uptime / 3600)}<span className="text-zinc-500 text-xl font-sans">h</span> {" "}
                  {Math.floor((data.uptime % 3600) / 60)}<span className="text-zinc-500 text-xl font-sans">m</span>
                </div>
              </GlassCard>
            </div>

            {/* Middle Column: Architecture Matrix */}
            <div className="md:col-span-2 space-y-8">
              <GlassCard className="glass-widget h-full" tiltIntensity={5}>
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

                {isOnline && (
                  <div className="mt-8 p-6 rounded-2xl bg-gradient-to-r from-indigo-500/10 to-violet-500/10 border border-indigo-500/20">
                    <h3 className="text-sm font-bold text-indigo-400 uppercase tracking-widest mb-4">Ledger Activity</h3>
                    <div className="flex items-end justify-between">
                      <div>
                        <p className="text-4xl font-black">{data.ledger.events_processed_today.toLocaleString()}</p>
                        <p className="text-zinc-400 text-sm mt-1">Events digested today</p>
                      </div>
                      <div className="text-right">
                        <p className="text-2xl font-bold">{data.ledger.active_parsers}</p>
                        <p className="text-zinc-400 text-sm mt-1">Active Parsers</p>
                      </div>
                    </div>
                  </div>
                )}
              </GlassCard>
            </div>

          </div>
        </div>
    </DashboardLayout>
  );
}
