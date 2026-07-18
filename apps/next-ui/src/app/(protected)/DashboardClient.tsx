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
      let apiUrl = process.env.NEXT_PUBLIC_API_URL;

      if (!apiUrl && typeof window !== "undefined") {
        apiUrl = `${window.location.protocol}//${window.location.hostname}:3001`;
      } else if (!apiUrl) {
        apiUrl = "http://127.0.0.1:3001";
      }

      const cleanApiUrl = apiUrl.replace(/\/$/, "");
      const token = process.env.NEXT_PUBLIC_WS_TOKEN;
      const wsUrl = cleanApiUrl.replace(/^http/, "ws") + `/api/status/stream?token=${token}`;

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
      <div className="p-2 md:p-8 max-w-7xl mx-auto min-h-screen pt-12 md:pt-16">

        {/* Header Block */}
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex flex-col md:flex-row items-start md:items-end justify-between mb-12 border-b border-border pb-8"
        >
          <div>
            <h1 className="text-4xl md:text-5xl font-black tracking-tight text-foreground mb-4">
              SYSTEM_OVERVIEW
            </h1>
            <div className="flex items-center gap-4 text-xs font-mono tracking-[0.2em] uppercase">
              <span className={isOnline ? "text-foreground" : "text-red-500"}>
                [ STATUS: {isOnline ? "ONLINE" : "OFFLINE"} ]
              </span>
              <span className="text-muted-foreground">
                {"//"} ACTIVE NODES: {data.services.length}
              </span>
              <button
                onClick={() => setIsSettingsOpen(true)}
                className="ml-4 p-2 text-muted-foreground hover:text-foreground hover:bg-accent transition-colors rounded-sm"
              >
                <Settings size={16} />
              </button>
              {settings && !settings.log_manager_enabled && (
                <button
                  onClick={async () => {
                    await fetch("/api/settings", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ log_manager_enabled: true }),
                    });
                    setSettings({ ...settings, log_manager_enabled: true });
                  }}
                  className="ml-4 px-3 py-1.5 bg-foreground text-background text-[10px] font-mono tracking-widest uppercase hover:opacity-90 transition-colors"
                >
                  START LOG MANAGER
                </button>
              )}
            </div>
          </div>
        </motion.div>

        {/* Matrix Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-px bg-border border border-border">

          {/* Left Column (2 spans on desktop) */}
          <div className="lg:col-span-2 grid grid-cols-1 md:grid-cols-2 gap-px bg-border">
            {/* CPU */}
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.1 }}
              className="bg-card p-8 flex flex-col justify-between min-h-[200px]"
            >
              <div className="text-[10px] text-muted-foreground tracking-[0.3em] uppercase mb-8 flex items-center gap-2">
                <Cpu size={12} /> PROCESSOR_LOAD
              </div>
              <div className="text-5xl font-mono text-foreground tracking-tighter">
                <AnimatedNumber value={data.system.cpu.load} suffix="%" />
              </div>
            </motion.div>

            {/* MEMORY */}
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.2 }}
              className="bg-card p-8 flex flex-col justify-between min-h-[200px]"
            >
              <div className="text-[10px] text-muted-foreground tracking-[0.3em] uppercase mb-8 flex items-center gap-2">
                <Database size={12} /> MEMORY_ALLOCATION
              </div>
              <div className="text-5xl font-mono text-foreground tracking-tighter">
                <AnimatedNumber value={data.system.memory.percent} suffix="%" />
              </div>
            </motion.div>

            {/* SERVICES MATRIX */}
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.3 }}
              className="md:col-span-2 bg-card p-8"
            >
              <div className="text-[10px] text-muted-foreground tracking-[0.3em] uppercase mb-8 flex items-center gap-2">
                <Network size={12} /> ROUTING_MANIFEST
              </div>
              <div className="space-y-4">
                {data.services.length > 0 ? (
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  data.services.map((service: any, idx: number) => (
                    <div key={idx} className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-border pb-4 last:border-0 last:pb-0">
                      <div className="flex items-center gap-4 mb-2 sm:mb-0">
                        <span className={`h-2 w-2 ${service.status === 'healthy' || service.status === 'connected' ? 'bg-foreground' : 'bg-red-500'}`} />
                        <span className="font-mono text-sm text-foreground tracking-widest uppercase">{service.name}</span>
                      </div>
                      <div className="flex items-center gap-6 text-[10px] font-mono tracking-widest text-muted-foreground">
                        <span>LAT:{service.latency}MS</span>
                        {service.cpu !== undefined && <span>CPU:{service.cpu}%</span>}
                        {service.memory !== undefined && <span>MEM:{service.memory}MB</span>}
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="flex flex-col items-center justify-center py-12 text-muted-foreground font-mono text-sm tracking-[0.2em]">
                    <ServerCrash size={32} className="mb-4" />
                    [ NO SERVICES RESPONDING ]
                  </div>
                )}
              </div>
            </motion.div>
          </div>

          {/* Right Column */}
          <div className="grid grid-cols-1 gap-px bg-border">
            {/* UPTIME */}
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.4 }}
              className="bg-card p-8 flex flex-col min-h-[200px]"
            >
              <div className="text-[10px] text-muted-foreground tracking-[0.3em] uppercase mb-8 flex items-center gap-2">
                <Clock size={12} /> SYSTEM_UPTIME
              </div>
              <div className="text-4xl font-mono text-foreground tracking-tighter mt-auto">
                {Math.floor(data.uptime / 3600)}<span className="text-muted-foreground text-lg ml-1 mr-2">H</span>
                {Math.floor((data.uptime % 3600) / 60)}<span className="text-muted-foreground text-lg ml-1">M</span>
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
  const [draft, setDraft] = useState<{ log_manager_cadence: number | string }>({
    log_manager_cadence: initialSettings.log_manager_cadence,
  });
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
        log_manager_enabled: initialSettings.log_manager_enabled,
        log_manager_cadence: cadence,
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
        className="w-full max-w-md bg-card border border-border p-6 shadow-2xl relative"
      >
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-muted-foreground hover:text-foreground"
        >
          ✕
        </button>
        <h2 className="text-xl font-mono text-foreground mb-6 uppercase tracking-widest border-b border-border pb-4">
          SYSTEM_SETTINGS
        </h2>

        <div className="space-y-6">


          <div>
            <label className="font-mono text-sm text-foreground block mb-2">POLLING_CADENCE (SEC)</label>
            <div className="text-xs text-muted-foreground mb-2">Interval between API requests (Min: 5).</div>
            <input
              type="number"
              min="5"
              max="3600"
              value={draft.log_manager_cadence}
              onChange={(e) => {
                const val = e.target.value;
                setDraft(s => ({ ...s, log_manager_cadence: val === "" ? "" : parseInt(val) }));
              }}
              className="w-full bg-muted border border-border text-foreground font-mono p-2 focus:outline-none focus:border-muted-foreground"
            />
            {error && <div className="text-red-500 text-xs font-mono mt-2">{error}</div>}
          </div>

          <div className="pt-4 border-t border-border flex justify-end gap-3">
            <button
              onClick={onClose}
              className="px-4 py-2 text-xs font-mono tracking-widest text-muted-foreground hover:text-foreground transition-colors"
            >
              CANCEL
            </button>
            <button
              onClick={handleSave}
              disabled={isSaving}
              className="px-4 py-2 bg-foreground text-background text-xs font-mono tracking-widest hover:opacity-90 transition-colors disabled:opacity-50"
            >
              {isSaving ? "SAVING..." : "SAVE"}
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
