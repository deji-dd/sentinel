"use client";

import React, { useState, useEffect } from "react";
import { useSync } from "@/hooks/use-sync";
import { DashboardLayout } from "@/components/dashboard-layout";
import { useSettings } from "@/components/settings-provider";
import { Cpu, Database, Network, Clock, ServerCrash, Settings } from "lucide-react";
import { motion, animate } from "framer-motion";

const now = Date.now();

function AnimatedNumber({ value, suffix = "" }: { value: number; suffix?: string }) {
  const ref = React.useRef<HTMLSpanElement>(null);

  React.useEffect(() => {
    const node = ref.current;
    if (node) {
      const current = parseFloat(node.textContent || "0");
      const controls = animate(current, value, {
        duration: 0.8,
        ease: "easeOut",
        onUpdate(v) {
          node.textContent = v.toFixed(1) + suffix;
        },
      });
      return () => controls.stop();
    }
  }, [value, suffix]);

  return <span ref={ref}>{value.toFixed(1)}{suffix}</span>;
}

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

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [syncData, setSyncData] = useState<{
    is_historical_sync_complete: boolean;
    earliest_timestamp: number;
    latest_timestamp: number;
  } | null>(null);

  const { settings, setSettings } = useSettings();

  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  const { setSyncOptions, setLastSyncedText } = useSync();

  useEffect(() => {
    let ws: WebSocket | null = null;
    let reconnectTimer: NodeJS.Timeout;

    const connectWs = () => {
      // Resolve proper WS URL dynamically for network dev
      let apiUrl = process.env.BOT_ORIGIN || process.env.NEXT_PUBLIC_API_URL;
      if (!apiUrl && typeof window !== "undefined") {
        apiUrl = `${window.location.protocol}//${window.location.hostname}:3001`;
      } else if (!apiUrl) {
        apiUrl = "http://127.0.0.1:3001";
      }
      const wsUrl = apiUrl.replace(/^http/, "ws") + "/api/status/stream";

      ws = new WebSocket(wsUrl);

      ws.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data);
          if (payload.type === "update") {
            if (payload.status) setData(payload.status);
            if (payload.sync) setSyncData(payload.sync);
            if (payload.settings) setSettings(payload.settings);
            setLastSyncedText(`LIVE_STREAM_ACTIVE`);
          }
        } catch (e) {
          console.error("Failed to parse WS message", e);
        }
      };

      ws.onclose = () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        setData((prev: any) => ({ ...prev, status: "offline" }));
        setLastSyncedText(`CONNECTION_LOST`);
        reconnectTimer = setTimeout(connectWs, 3000);
      };

      ws.onerror = () => {
        ws?.close();
      };
    };

    connectWs();

    // Disable manual sync button as data is streaming
    setTimeout(() => {
      setSyncOptions(null);
    }, 0);

    return () => {
      clearTimeout(reconnectTimer);
      if (ws) {
        ws.onclose = null; // Prevent reconnect logic on unmount
        ws.close();
      }
      setTimeout(() => {
        setLastSyncedText("");
      }, 0);
    };
  }, [setSyncOptions, setLastSyncedText, setSettings]);

  const isOnline = data.status === "online";

  return (
    <DashboardLayout>
      <div className="p-4 md:p-8 max-w-7xl mx-auto min-h-screen pt-12 md:pt-16">

        {/* Header Block */}
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex flex-col md:flex-row items-start md:items-end justify-between mb-12 border-b border-neutral-900 pb-8"
        >
          <div>
            <h1 className="text-4xl md:text-5xl font-black tracking-tight text-white mb-4">
              SYSTEM_OVERVIEW
            </h1>
            <div className="flex items-center gap-4 text-xs font-mono tracking-[0.2em] uppercase">
              <span className={isOnline ? "text-white" : "text-red-500"}>
                [ STATUS: {isOnline ? "ONLINE" : "OFFLINE"} ]
              </span>
              <span className="text-neutral-500">
                {"//"} ACTIVE NODES: {data.services.length}
              </span>
              <button
                onClick={() => setIsSettingsOpen(true)}
                className="ml-4 p-2 text-neutral-500 hover:text-white hover:bg-neutral-900 transition-colors rounded-sm"
              >
                <Settings size={16} />
              </button>
            </div>
          </div>
        </motion.div>

        {/* Matrix Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-px bg-neutral-900 border border-neutral-900">

          {/* Left Column (2 spans on desktop) */}
          <div className="lg:col-span-2 grid grid-cols-1 md:grid-cols-2 gap-px bg-neutral-900">
            {/* CPU */}
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.1 }}
              className="bg-black p-8 flex flex-col justify-between min-h-[200px]"
            >
              <div className="text-[10px] text-neutral-500 tracking-[0.3em] uppercase mb-8 flex items-center gap-2">
                <Cpu size={12} /> PROCESSOR_LOAD
              </div>
              <div className="text-5xl font-mono text-white tracking-tighter">
                <AnimatedNumber value={data.system.cpu.load} suffix="%" />
              </div>
            </motion.div>

            {/* MEMORY */}
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.2 }}
              className="bg-black p-8 flex flex-col justify-between min-h-[200px]"
            >
              <div className="text-[10px] text-neutral-500 tracking-[0.3em] uppercase mb-8 flex items-center gap-2">
                <Database size={12} /> MEMORY_ALLOCATION
              </div>
              <div className="text-5xl font-mono text-white tracking-tighter">
                <AnimatedNumber value={data.system.memory.percent} suffix="%" />
              </div>
            </motion.div>

            {/* SERVICES MATRIX */}
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.3 }}
              className="md:col-span-2 bg-black p-8"
            >
              <div className="text-[10px] text-neutral-500 tracking-[0.3em] uppercase mb-8 flex items-center gap-2">
                <Network size={12} /> ROUTING_MANIFEST
              </div>
              <div className="space-y-4">
                {data.services.length > 0 ? (
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  data.services.map((service: any, idx: number) => (
                    <div key={idx} className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-neutral-900 pb-4 last:border-0 last:pb-0">
                      <div className="flex items-center gap-4 mb-2 sm:mb-0">
                        <span className={`h-2 w-2 ${service.status === 'healthy' || service.status === 'connected' ? 'bg-white' : 'bg-red-500'}`} />
                        <span className="font-mono text-sm text-white tracking-widest uppercase">{service.name}</span>
                      </div>
                      <div className="flex items-center gap-6 text-[10px] font-mono tracking-widest text-neutral-500">
                        <span>LAT:{service.latency}MS</span>
                        {service.cpu !== undefined && <span>CPU:{service.cpu}%</span>}
                        {service.memory !== undefined && <span>MEM:{service.memory}MB</span>}
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="flex flex-col items-center justify-center py-12 text-neutral-600 font-mono text-sm tracking-[0.2em]">
                    <ServerCrash size={32} className="mb-4" />
                    [ NO SERVICES RESPONDING ]
                  </div>
                )}
              </div>
            </motion.div>
          </div>

          {/* Right Column */}
          <div className="grid grid-cols-1 gap-px bg-neutral-900">
            {/* UPTIME */}
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.4 }}
              className="bg-black p-8 flex flex-col min-h-[200px]"
            >
              <div className="text-[10px] text-neutral-500 tracking-[0.3em] uppercase mb-8 flex items-center gap-2">
                <Clock size={12} /> SYSTEM_UPTIME
              </div>
              <div className="text-4xl font-mono text-white tracking-tighter mt-auto">
                {Math.floor(data.uptime / 3600)}<span className="text-neutral-600 text-lg ml-1 mr-2">H</span>
                {Math.floor((data.uptime % 3600) / 60)}<span className="text-neutral-600 text-lg ml-1">M</span>
              </div>
            </motion.div>

          </div>
        </div>

        {/* Settings Modal */}
        {isSettingsOpen && (
          <SettingsModal
            initialSettings={settings}
            onClose={() => setIsSettingsOpen(false)}
            onSave={async (newSettings) => {
              setSettings(newSettings);
              await fetch("/api/settings", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(newSettings)
              });
            }}
          />
        )}
      </div>
    </DashboardLayout>
  );
}

function SettingsModal({
  initialSettings,
  onClose,
  onSave
}: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  initialSettings: any;
  onClose: () => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onSave: (settings: any) => Promise<void>;
}) {
  const [draft, setDraft] = useState<{ log_manager_enabled: boolean; log_manager_cadence: number | string; crimes_module_enabled: boolean }>(initialSettings);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async () => {
    const cadence = typeof draft.log_manager_cadence === 'string' ? parseInt(draft.log_manager_cadence) : draft.log_manager_cadence;
    if (!cadence || isNaN(cadence) || cadence < 5) {
      setError("Cadence must be a valid number of at least 5 seconds.");
      return;
    }

    setIsSaving(true);
    setError(null);
    try {
      await onSave({
        log_manager_enabled: draft.log_manager_enabled,
        log_manager_cadence: cadence,
        crimes_module_enabled: draft.crimes_module_enabled,
      });
      onClose();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (e: any) {
      setError(e.message || "Failed to save settings");
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="w-full max-w-md bg-black border border-neutral-800 p-6 shadow-2xl relative"
      >
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-neutral-500 hover:text-white"
        >
          ✕
        </button>
        <h2 className="text-xl font-mono text-white mb-6 uppercase tracking-widest border-b border-neutral-900 pb-4">
          SYSTEM_SETTINGS
        </h2>

        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <div className="font-mono text-sm text-white">LOG_MANAGER</div>
              <div className="text-xs text-neutral-500 mt-1">Intercept and persist event logs.</div>
            </div>
            <button
              onClick={() => setDraft(s => ({ ...s, log_manager_enabled: !s.log_manager_enabled }))}
              className={`w-12 h-6 rounded-none transition-colors relative ${draft.log_manager_enabled ? 'bg-white' : 'bg-neutral-800'}`}
            >
              <div className={`absolute top-1 left-1 size-4 bg-black rounded-none transition-transform ${draft.log_manager_enabled ? 'translate-x-6' : ''}`} />
            </button>
          </div>

          <div className="flex items-center justify-between">
            <div>
              <div className="font-mono text-sm text-white">CRIMES_MODULE</div>
              <div className="text-xs text-neutral-500 mt-1">Enable crime ledger tracking and analysis.</div>
            </div>
            <button
              onClick={() => setDraft(s => ({ ...s, crimes_module_enabled: !s.crimes_module_enabled }))}
              className={`w-12 h-6 rounded-none transition-colors relative ${draft.crimes_module_enabled ? 'bg-white' : 'bg-neutral-800'}`}
            >
              <div className={`absolute top-1 left-1 size-4 bg-black rounded-none transition-transform ${draft.crimes_module_enabled ? 'translate-x-6' : ''}`} />
            </button>
          </div>

          <div className="pt-4 border-t border-neutral-900" />

          <div>
            <label className="font-mono text-sm text-white block mb-2">POLLING_CADENCE (SEC)</label>
            <div className="text-xs text-neutral-500 mb-2">Interval between API requests (Min: 5).</div>
            <input
              type="number"
              min="5"
              max="3600"
              value={draft.log_manager_cadence}
              onChange={(e) => {
                const val = e.target.value;
                setDraft(s => ({ ...s, log_manager_cadence: val === "" ? "" : parseInt(val) }));
              }}
              className="w-full bg-neutral-900 border border-neutral-800 text-white font-mono p-2 focus:outline-none focus:border-neutral-600"
            />
            {error && <div className="text-red-500 text-xs font-mono mt-2">{error}</div>}
          </div>

          <div className="pt-4 border-t border-neutral-900 flex justify-end gap-3">
            <button
              onClick={onClose}
              className="px-4 py-2 text-xs font-mono tracking-widest text-neutral-500 hover:text-white transition-colors"
            >
              CANCEL
            </button>
            <button
              onClick={handleSave}
              disabled={isSaving}
              className="px-4 py-2 bg-white text-black text-xs font-mono tracking-widest hover:bg-neutral-200 transition-colors disabled:opacity-50"
            >
              {isSaving ? "SAVING..." : "SAVE"}
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
