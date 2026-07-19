"use client";

import React, { useEffect, useState, useMemo } from "react";
import Image from "next/image";
import { DashboardLayout } from "@/components/dashboard-layout";
import { useSettings } from "@/components/settings-provider";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { motion } from "framer-motion";
import { Plane, TrendingUp, Settings, MapPin, Package, AlertTriangle } from "lucide-react";
import GlobalLoading from "@/components/dashboard/GlobalLoading";
import { useMinimumLoading } from "@/hooks/use-minimum-loading";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { UnmappedAreas } from "./unmapped-areas";
import { TravelChart } from "@/components/travel/TravelChart";

const FLIGHT_TIMES: Record<string, number> = {
  mex: 18, cay: 25, can: 29, haw: 94, uni: 111,
  arg: 117, swi: 123, jap: 158, chi: 169, uae: 190, sou: 207
};

const COUNTRY_NAMES: Record<string, string> = {
  mex: "Mexico", cay: "Cayman Islands", can: "Canada", haw: "Hawaii",
  uni: "United Kingdom", arg: "Argentina", swi: "Switzerland",
  jap: "Japan", chi: "China", uae: "UAE", sou: "South Africa"
};

interface TravelItem {
  id: number;
  name: string;
  quantity: number;
  cost: number;
  market_price: number;
  depletion_rate: number;
  data_points: number;
  type?: string;
  tracked_profit: number;
}

interface Destination {
  id: string;
  updatedAt: number;
  stocks: TravelItem[];
  tracked_profit?: number;
}

interface ProcessedRoute {
  destination: string;
  item: TravelItem;
  flightTimeOneWay: number;
  profitPerItem: number;
  totalProfit: number;
  ppm: number;
  warnings: string[];
}

interface LiveState {
  bars: {
    energy: { current: number; maximum: number; increment: number; interval: number; full_time: number };
    nerve: { current: number; maximum: number; increment: number; interval: number; full_time: number };
    happy: { current: number; maximum: number; increment: number; interval: number; full_time: number };
    life: { current: number; maximum: number; increment: number; interval: number; full_time: number };
  };
  cooldowns: {
    drug: number;
    medical: number;
    booster: number;
  };
  money?: {
    wallet: number;
  };
  timestamp: number;
}

export default function TravelDashboard() {
  const { settings, setSettings, isLoading: isSettingsLoading } = useSettings();
  const [data, setData] = useState<Destination[]>([]);
  const [historicalData, setHistoricalData] = useState<{timestamp: number, dailyYield: number}[]>([]);
  const [liveState, setLiveState] = useState<LiveState | null>(null);
  const [unmapped, setUnmapped] = useState([]);
  const [loading, setLoading] = useState(true);
  const showLoader = useMinimumLoading(loading || isSettingsLoading, 1500);

  // Settings State
  const [capacity, setCapacity] = useState<number | string>(settings.travel_capacity);
  const [method, setMethod] = useState(settings.travel_method);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  const [categoryFilter, setCategoryFilter] = useState("profit"); // "all" | "profit"
  const [timeframe, setTimeframe] = useState<"7d" | "30d" | "90d" | "all">("30d");

  useEffect(() => {
    if (isSettingsOpen) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setCapacity(settings.travel_capacity || 15);
      setMethod(settings.travel_method || "1.0");
    }
  }, [isSettingsOpen, settings.travel_capacity, settings.travel_method]);

  const saveSettings = async () => {
    try {
      const payload = {
        travel_module_enabled: settings.travel_module_enabled,
        travel_capacity: Number(capacity) || 15,
        travel_method: method,
      };
      await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      setSettings({ ...settings, ...payload });
      setIsSettingsOpen(false);
    } catch (e) {
      console.error("Failed to save settings", e);
    }
  };

  useEffect(() => {
    if (isSettingsLoading) return;

    if (!settings.travel_module_enabled) {
      // Use setTimeout to avoid synchronous setState warning
      setTimeout(() => setLoading(false), 0);
      return;
    }

    const fetchData = async () => {
      try {
        const [travelRes, unmappedRes] = await Promise.all([
          fetch("/api/travel"),
          fetch("/api/travel/unmapped")
        ]);

        const travelJson = await travelRes.json();
        if (travelJson.data) setData(travelJson.data);
        if (travelJson.historicalData) setHistoricalData(travelJson.historicalData);
        if (travelJson.live_state) setLiveState(travelJson.live_state);

        const unmappedJson = await unmappedRes.json();
        setUnmapped(unmappedJson);
      } catch (e) {
        console.error("Failed to fetch travel data", e);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
    const timer = setInterval(fetchData, 60000); // poll every 60s
    return () => clearInterval(timer);
  }, [settings.travel_module_enabled, isSettingsLoading]);

  const processedRoutes = useMemo(() => {
    const routes: ProcessedRoute[] = [];
    const multiplier = parseFloat(settings.travel_method) || 1.0;

    for (const dest of data) {
      const flightTimeBase = FLIGHT_TIMES[dest.id] || 0;
      if (!flightTimeBase) continue;

      const flightTimeOneWay = flightTimeBase * multiplier;
      const totalFlightTime = flightTimeOneWay * 2; // Round trip

      for (const item of dest.stocks) {
        if (item.quantity <= 0) continue;
        const profitPerItem = item.market_price - item.cost;

        // Negative profit items are never worth flying for
        if (profitPerItem < 0) continue;

        if (categoryFilter === "profit") {
          if (item.type !== "Plushie" && item.type !== "Flower") continue;
        }

        const totalProfit = profitPerItem * settings.travel_capacity;
        const ppm = totalFlightTime > 0 ? totalProfit / totalFlightTime : 0;

        // Hide if projected stock when landing is less than capacity
        if (item.data_points >= 2 && item.depletion_rate > 0) {
          const projectedStock = item.quantity - (item.depletion_rate * flightTimeOneWay);
          if (projectedStock < settings.travel_capacity) {
            continue;
          }
        }

        const warnings: string[] = [];
        let shouldHide = false;

        if (liveState) {
          const e = liveState.bars.energy;
          const n = liveState.bars.nerve;
          const c = liveState.cooldowns;

          // Max fill times
          const eMaxTime = (e.maximum / e.increment) * (e.interval / 60);
          const nMaxTime = (n.maximum / n.increment) * (n.interval / 60);

          if (totalFlightTime > eMaxTime) shouldHide = true;
          else if (e.full_time > 0 && totalFlightTime > e.full_time / 60) warnings.push("Spend Energy");

          if (totalFlightTime > nMaxTime) shouldHide = true;
          else if (n.full_time > 0 && totalFlightTime > n.full_time / 60) warnings.push("Spend Nerve");

          if (c.drug > 0 && totalFlightTime > c.drug / 60) shouldHide = true;
          if (c.booster > 0 && totalFlightTime > c.booster / 60) warnings.push("Use Booster");

          const costTotal = item.cost * settings.travel_capacity;
          if (liveState.money && liveState.money.wallet < costTotal) {
            const short = costTotal - liveState.money.wallet;
            warnings.push(`Carry $${short.toLocaleString()} more`);
          }
        }

        if (shouldHide) continue;

        routes.push({
          destination: COUNTRY_NAMES[dest.id] || dest.id,
          item,
          flightTimeOneWay,
          profitPerItem,
          totalProfit,
          ppm,
          warnings
        });
      }
    }

    return routes.sort((a, b) => b.ppm - a.ppm);
  }, [data, settings.travel_capacity, settings.travel_method, categoryFilter, liveState]);

  if (showLoader) {
    return (
      <DashboardLayout>
        <GlobalLoading />
      </DashboardLayout>
    );
  }

  if (!settings.travel_module_enabled) {
    return (
      <DashboardLayout>
        <div className="flex-1 flex flex-col items-center justify-center h-[80vh] text-center p-8">
          <Plane size={32} className="text-muted-foreground mb-6" />
          <div className="text-muted-foreground font-mono tracking-widest text-sm mb-4 uppercase">
            [ TRAVEL_AGENCY_DISABLED ]
          </div>
          <div className="text-neutral-500 font-mono text-[10px] uppercase tracking-widest max-w-md leading-relaxed mb-8">
            This module is currently disabled. Initializing this module will allow Sentinel to pull live YATA restock data and calculate maximum PPM routes based on your flight capacity.
          </div>
          <button
            onClick={() => {
              // Open settings dialog so they can configure their capacity/method
              // or we can just enable it directly and then let them configure.
              // Let's just enable it directly with defaults!
              setSettings({ ...settings, travel_module_enabled: true });
              fetch("/api/settings", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ travel_module_enabled: true })
              });
            }}
            className="px-6 py-3 bg-foreground text-background font-mono text-[10px] uppercase tracking-[0.2em] hover:opacity-90 transition-colors"
          >
            INITIALIZE_MODULE
          </button>
        </div>
      </DashboardLayout>
    );
  }

  const bestRoute = processedRoutes.length > 0 ? processedRoutes[0] : null;

  return (
    <DashboardLayout>
      <div className="flex flex-col gap-8 max-w-6xl mx-auto w-full mb-16 p-2 md:p-4">
        <header className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-black tracking-tight flex items-center gap-3">
              <Plane className="size-8 text-primary" />
              TRAVEL AGENCY
            </h1>
            <p className="text-muted-foreground mt-1">Live profitability routes calculated automatically.</p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Button variant="outline" className="gap-2" onClick={async () => {
              await fetch("/api/travel/reset-ledger", { method: "POST" });
              // trigger refresh
              const res = await fetch("/api/travel");
              const json = await res.json();
              if (json.data) setData(json.data);
            }}>
              Reset Ledger
            </Button>

            <Button variant="outline" className="gap-2" onClick={() => setIsSettingsOpen(true)}>
              <Settings className="size-4" />
              Flight Config
            </Button>
          </div>

          <Dialog open={isSettingsOpen} onOpenChange={setIsSettingsOpen}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Flight Configuration</DialogTitle>
              </DialogHeader>
              <div className="grid gap-4 py-4">
                <div className="grid gap-2">
                  <label className="text-sm font-medium">Luggage Capacity</label>
                  <Input
                    type="number"
                    value={capacity}
                    onChange={(e) => setCapacity(e.target.value === "" ? "" : Number(e.target.value))}
                  />
                  <p className="text-xs text-muted-foreground">Includes base, faction, and property upgrades.</p>
                </div>
                <div className="grid gap-2">
                  <label className="text-sm font-medium">Travel Method</label>
                  <Select value={method} onValueChange={(val) => setMethod(val ?? "1.0")}>
                    <SelectTrigger className={"w-full"}>
                      <SelectValue className={"w-full"} placeholder="Select method" />
                    </SelectTrigger>
                    <SelectContent className={"w-full"}>
                      <SelectItem value="1.0">Standard (1.0x)</SelectItem>
                      <SelectItem value="0.7">Airstrip / PI (0.7x)</SelectItem>
                      <SelectItem value="0.5">WLT / Business Class (0.5x)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-2">
                  <label className="text-sm font-medium">Item Filtering</label>
                  <Select value={categoryFilter} onValueChange={(val) => setCategoryFilter(val as string)}>
                    <SelectTrigger className="w-full">
                      <SelectValue>
                        {categoryFilter === "profit" ? "Plushies & Flowers" : "All Items"}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="profit">Plushies & Flowers</SelectItem>
                      <SelectItem value="all">All Items</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <DialogFooter>
                <Button onClick={saveSettings}>Save Config</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </header>

        <UnmappedAreas
          unmappedAreas={unmapped}
          onMapped={async () => {
            const [travelRes, unmappedRes] = await Promise.all([
              fetch("/api/travel"),
              fetch("/api/travel/unmapped")
            ]);
            const travelJson = await travelRes.json();
            if (travelJson.data) setData(travelJson.data);
            if (travelJson.historicalData) setHistoricalData(travelJson.historicalData);
            const unmappedJson = await unmappedRes.json();
            setUnmapped(unmappedJson);
          }}
        />

        <div className="mb-8 mt-8">
          <div className="bg-card border border-border p-6 rounded-none shadow-sm">
            <div className="flex flex-row items-center justify-between mb-4">
              <h3 className="text-foreground font-mono uppercase tracking-[0.2em] flex items-center gap-2">
                <TrendingUp className="w-5 h-5 text-emerald-500" />
                <span>Historical Daily Profit</span>
              </h3>
              <div className="flex bg-muted p-1">
                {(["7d", "30d", "90d", "all"] as const).map((t) => (
                  <button
                    key={t}
                    onClick={() => setTimeframe(t)}
                    className={`px-3 py-1 text-[10px] font-mono uppercase tracking-widest cursor-pointer transition-colors ${
                      timeframe === t
                        ? "bg-background text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground hover:bg-white/5"
                    }`}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>
            <TravelChart data={historicalData} timeframe={timeframe} />
          </div>
        </div>

        {bestRoute && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="rounded-xl overflow-hidden border border-border bg-card shadow-sm"
          >
            <div className="p-6 bg-gradient-to-r from-primary/10 via-background to-background">
              <div className="flex flex-col md:flex-row gap-6 justify-between items-start md:items-center">
                <div className="flex gap-4">
                  <div className="h-16 w-16 bg-primary/20 rounded-full flex items-center justify-center shrink-0">
                    <TrendingUp className="size-8 text-primary" />
                  </div>
                  <div>
                    <p className="text-xs font-bold tracking-widest text-primary mb-1 uppercase">Recommended Route</p>
                    <h2 className="text-2xl font-bold">{bestRoute.item.name} <span className="text-muted-foreground font-normal mx-2">→</span> {bestRoute.destination}</h2>
                    <div className="flex items-center gap-4 mt-2 text-sm text-muted-foreground">
                      <span className="flex items-center gap-1"><Package className="size-4" /> {bestRoute.item.quantity.toLocaleString()} in stock</span>
                      <span className="flex items-center gap-1"><Plane className="size-4" /> {Math.ceil(bestRoute.flightTimeOneWay)}m one-way</span>
                    </div>
                    {bestRoute.warnings.length > 0 && (
                      <div className="flex flex-wrap gap-2 mt-3">
                        {bestRoute.warnings.map((w, i) => (
                          <span key={i} className="flex items-center text-[10px] uppercase font-bold tracking-wider text-red-500 bg-red-500/10 px-2 py-1 rounded-sm border border-red-500/20">
                            <AlertTriangle className="size-3 mr-1.5" />
                            {w}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-x-8 gap-y-2 shrink-0 bg-background/50 backdrop-blur-md p-4 rounded-lg border border-border/50">
                  <div>
                    <p className="text-xs text-muted-foreground uppercase tracking-wider">Est. Profit</p>
                    <p className="text-xl font-bold text-emerald-500">${bestRoute.totalProfit.toLocaleString()}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground uppercase tracking-wider">PPM</p>
                    <p className="text-xl font-bold">${Math.floor(bestRoute.ppm).toLocaleString()}</p>
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        )}

        <div className="rounded-xl border border-border bg-card overflow-hidden shadow-sm">
          <Table>
            <TableHeader className="bg-muted/50">
              <TableRow>
                <TableHead>Item</TableHead>
                <TableHead>Destination</TableHead>
                <TableHead className="text-right">Stock</TableHead>
                <TableHead className="text-right">Depletion (qty/min)</TableHead>
                <TableHead className="text-right">Profit</TableHead>
                <TableHead className="text-right">PPM</TableHead>
                <TableHead className="text-right text-emerald-500 border-l border-border pl-4">Tracked Profit</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {processedRoutes.map((route) => (
                <TableRow key={`${route.destination}-${route.item.id}`}>
                  <TableCell className="font-medium flex items-center gap-3">
                    <div className="size-8 rounded-md bg-muted flex items-center justify-center shrink-0 overflow-hidden relative">
                      <Image
                        src={`https://www.torn.com/images/items/${route.item.id}/large.png`}
                        alt={route.item.name}
                        fill
                        className="object-contain p-1"
                        unoptimized
                      />
                    </div>
                    {route.item.name}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <MapPin className="size-3 text-muted-foreground" />
                      {route.destination}
                      {route.warnings.length > 0 && (
                        <span className="flex items-center text-[10px] uppercase font-bold tracking-wider text-red-500 bg-red-500/10 px-2 py-0.5 rounded-full ml-2" title={route.warnings.join(", ")}>
                          <AlertTriangle className="size-3 mr-1" />
                          {route.warnings[0]} {route.warnings.length > 1 && `+${route.warnings.length - 1}`}
                        </span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-right font-mono">{route.item.quantity.toLocaleString()}</TableCell>
                  <TableCell className="text-right font-mono">
                    <div className="flex items-center justify-end gap-2">
                      {route.item.data_points < 2 ? (
                        <span className="flex items-center text-xs text-amber-500 gap-1" title="Not enough data points yet">
                          <AlertTriangle className="size-3" /> Pending
                        </span>
                      ) : (
                        <span className={route.item.depletion_rate > 5 ? "text-red-500" : route.item.depletion_rate > 0 ? "text-amber-500" : "text-emerald-500"}>
                          -{route.item.depletion_rate.toFixed(1)}
                        </span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-right font-mono text-emerald-500">${route.totalProfit.toLocaleString()}</TableCell>
                  <TableCell className="text-right font-mono font-bold">${Math.floor(route.ppm).toLocaleString()}</TableCell>
                  <TableCell className="text-right font-mono text-emerald-500 font-bold border-l border-border pl-4">
                    ${(route.item.tracked_profit || 0).toLocaleString()}
                  </TableCell>
                </TableRow>
              ))}
              {processedRoutes.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-12 text-muted-foreground">
                    No active travel routes found. Fetching from YATA...
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </div>
    </DashboardLayout>
  );
}
