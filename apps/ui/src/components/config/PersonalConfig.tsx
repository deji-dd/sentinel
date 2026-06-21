import {
  useEffect,
  useImperativeHandle,
  useMemo,
  useState,
  forwardRef,
} from "react";
import { LoadingScreen } from "@/components/loading-screen";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { fetchWithFallback } from "@/lib/api-base";
import {
  Settings,
  Zap,
  Clock,
  Target,
  Flame,
  RefreshCw,
  TrendingUp,
  BarChart3,
  Calendar,
  Database,
  ArrowRight,
  Sparkles,
} from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface PersonalSettings {
  user_id: string;
  discord_id: string;
  energy_alerts_enabled: number;
  energy_soft_threshold: number;
  energy_aggressive_interval_mins: number;
  admin_log_channel_id: string | null;
  error_pings_enabled: number;
  selected_build?: string;
  target_strength_ratio?: number;
  target_defense_ratio?: number;
  target_speed_ratio?: number;
  target_dexterity_ratio?: number;
}

interface PersonalConfigProps {
  sessionToken: string;
  onDirtyChange?: (isDirty: boolean) => void;
  view?: "alerts" | "oracle" | "logging";
}

interface MilestoneData {
  target: number;
  days: number | null;
  energy: number | null;
}

interface StatProjection {
  stat: string;
  currentValue: number;
  allocation: number;
  dailyEnergy: number;
  milestones: MilestoneData[];
}

interface GymHistoryEntry {
  day: string;
  strength: number;
  speed: number;
  defense: number;
  dexterity: number;
  energy: number;
}

interface MilestoneOracleResponse {
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
  projections: StatProjection[];
  history: GymHistoryEntry[];
  syncStatus: {
    totalRecords: number;
    lastSyncAt: string | null;
    nextRunAt: string | null;
    isBackfillComplete: boolean;
    oldestLogTimestamp: number | null;
    latestLogTimestamp: number | null;
  };
  recommendation: {
    stat: string;
    statKey: string;
    diff: number;
    text: string;
    gymRecommendation: string | null;
    currentEnergy: number;
    maxEnergy: number;
    factionPerks?: {
      strength: number;
      defense: number;
      speed: number;
      dexterity: number;
    };
    buildInfo: {
      selectedBuild: string;
      ratios: {
        strength: number;
        defense: number;
        speed: number;
        dexterity: number;
      }
    }
  };
}

const calculateHanksRatios = (highStat: string) => {
  const lowStat =
    highStat === "strength" ? "speed" :
    highStat === "speed" ? "strength" :
    highStat === "defense" ? "dexterity" :
    "defense";

  const ratios = { strength: 27.78, defense: 27.78, speed: 27.78, dexterity: 27.78 };
  ratios[highStat as keyof typeof ratios] = 34.72;
  ratios[lowStat as keyof typeof ratios] = 9.72;
  return ratios;
};

const calculateBaldrsRatios = (highStat: string, secondaryStat: string) => {
  const ratios = { strength: 22.22, defense: 22.22, speed: 22.22, dexterity: 22.22 };
  ratios[highStat as keyof typeof ratios] = 30.86;
  ratios[secondaryStat as keyof typeof ratios] = 24.70;
  return ratios;
};

export const PersonalConfig = forwardRef<any, PersonalConfigProps>(
  ({ sessionToken, onDirtyChange, view = "alerts" }, ref) => {
    const [loading, setLoading] = useState(true);
    const [milestones, setMilestones] = useState<MilestoneOracleResponse | null>(null);
    const [loadingMilestones, setLoadingMilestones] = useState(true);
    const [syncingGym, setSyncingGym] = useState(false);
    const [settings, setSettings] = useState<PersonalSettings | null>(null);
    const [settingsBaseline, setSettingsBaseline] = useState<PersonalSettings | null>(null);
    const [channels, setChannels] = useState<{ id: string; name: string }[]>([]);
    
    // String inputs for soft threshold and aggressive interval to allow full clearing
    const [softThresholdInput, setSoftThresholdInput] = useState("");
    const [aggressiveIntervalInput, setAggressiveIntervalInput] = useState("");
    const [timeframe, setTimeframe] = useState<"7d" | "30d" | "90d" | "all">("30d");

    // Hank's and Baldr's sub-settings
    const [hanksHighStat, setHanksHighStat] = useState<string>("defense");
    const [baldrsHighStat, setBaldrsHighStat] = useState<string>("strength");
    const [baldrsSecondaryStat, setBaldrsSecondaryStat] = useState<string>("speed");

    // String inputs for custom stat build ratios
    const [strRatioInput, setStrRatioInput] = useState("25");
    const [defRatioInput, setDefRatioInput] = useState("25");
    const [spdRatioInput, setSpdRatioInput] = useState("25");
    const [dexRatioInput, setDexRatioInput] = useState("25");

    // Chart selection tab
    const [activeChartTab, setActiveChartTab] = useState<"strength" | "defense" | "speed" | "dexterity" | "energy">("strength");
    // Tooltip hover state for SVG Chart
    const [hoveredPoint, setHoveredPoint] = useState<{ x: number; y: number; label: string; value: string } | null>(null);

    const settingsDirty = useMemo(() => {
      if (!settings || !settingsBaseline) return false;
      return JSON.stringify(settings) !== JSON.stringify(settingsBaseline);
    }, [settings, settingsBaseline]);

    useEffect(() => {
      onDirtyChange?.(settingsDirty);
    }, [settingsDirty, onDirtyChange]);

    const loadData = async (silent = false) => {
      if (!silent) setLoading(true);
      try {
        const response = await fetchWithFallback("/api/config/personal", {
          headers: { Authorization: `Bearer ${sessionToken}` },
        });
        if (!response.ok) throw new Error("Failed to load personal config");
        const payload = await response.json();
        setSettings(payload);
        setSettingsBaseline(payload);
        
        // Sync local input strings
        setSoftThresholdInput(String(payload.energy_soft_threshold));
        setAggressiveIntervalInput(String(payload.energy_aggressive_interval_mins));

        // Sync local stat build strings
        setStrRatioInput(String(payload.target_strength_ratio ?? 25));
        setDefRatioInput(String(payload.target_defense_ratio ?? 25));
        setSpdRatioInput(String(payload.target_speed_ratio ?? 25));
        setDexRatioInput(String(payload.target_dexterity_ratio ?? 25));

        // Deduce sub-settings from loaded ratios
        const loadedRatios = {
          strength: payload.target_strength_ratio ?? 25,
          defense: payload.target_defense_ratio ?? 25,
          speed: payload.target_speed_ratio ?? 25,
          dexterity: payload.target_dexterity_ratio ?? 25,
        };
        const buildPreset = payload.selected_build || "balanced";
        if (buildPreset === "hanks") {
          const entries = Object.entries(loadedRatios);
          entries.sort((a, b) => b[1] - a[1]);
          setHanksHighStat(entries[0][0]);
        } else if (buildPreset === "baldrs") {
          const entries = Object.entries(loadedRatios);
          entries.sort((a, b) => b[1] - a[1]);
          setBaldrsHighStat(entries[0][0]);
          setBaldrsSecondaryStat(entries[1][0]);
        }
      } catch (error) {
        console.error("[PersonalConfig] Failed to load:", error);
        toast.error("Failed to load personal settings");
      } finally {
        if (!silent) setLoading(false);
      }
    };

    const loadChannels = async () => {
      try {
        const response = await fetchWithFallback("/api/admin/channels", {
          headers: { Authorization: `Bearer ${sessionToken}` },
        });
        if (response.ok) {
          const data = await response.json();
          setChannels(data);
        }
      } catch (error) {
        console.error("[PersonalConfig] Failed to load channels:", error);
      }
    };

    const loadMilestones = async (silent = false, selectedTimeframe = timeframe) => {
      if (!silent) setLoadingMilestones(true);
      try {
        const response = await fetchWithFallback(`/api/config/personal/milestones?timeframe=${selectedTimeframe}`, {
          headers: { Authorization: `Bearer ${sessionToken}` },
        });
        if (!response.ok) throw new Error("Failed to load milestones");
        const payload = await response.json();
        setMilestones(payload);
      } catch (error) {
        console.error("[PersonalConfig] Failed to load milestones:", error);
      } finally {
        if (!silent) setLoadingMilestones(false);
      }
    };

    // Load static settings configurations once on load
    useEffect(() => {
      loadData();
      loadChannels();
    }, [sessionToken]);

    // Load milestones dynamically on tab/timeframe changes
    useEffect(() => {
      if (view === "oracle") {
        loadMilestones(false, timeframe);
      }
    }, [sessionToken, view, timeframe]);

    const handleBuildPresetChange = (preset: string) => {
      setSettings((current) => {
        if (!current) return null;
        let ratios = { strength: 25, defense: 25, speed: 25, dexterity: 25 };
        
        if (preset === "balanced") {
          ratios = { strength: 25, defense: 25, speed: 25, dexterity: 25 };
        } else if (preset === "hanks") {
          ratios = calculateHanksRatios(hanksHighStat);
        } else if (preset === "baldrs") {
          ratios = calculateBaldrsRatios(baldrsHighStat, baldrsSecondaryStat);
        } else if (preset === "custom") {
          ratios = {
            strength: Number(strRatioInput) || 25,
            defense: Number(defRatioInput) || 25,
            speed: Number(spdRatioInput) || 25,
            dexterity: Number(dexRatioInput) || 25,
          };
        }

        setStrRatioInput(String(ratios.strength));
        setDefRatioInput(String(ratios.defense));
        setSpdRatioInput(String(ratios.speed));
        setDexRatioInput(String(ratios.dexterity));

        return {
          ...current,
          selected_build: preset,
          target_strength_ratio: ratios.strength,
          target_defense_ratio: ratios.defense,
          target_speed_ratio: ratios.speed,
          target_dexterity_ratio: ratios.dexterity,
        };
      });
    };

    const handleHanksHighStatChange = (stat: string) => {
      setHanksHighStat(stat);
      setSettings((current) => {
        if (!current || current.selected_build !== "hanks") return current;
        const ratios = calculateHanksRatios(stat);
        
        setStrRatioInput(String(ratios.strength));
        setDefRatioInput(String(ratios.defense));
        setSpdRatioInput(String(ratios.speed));
        setDexRatioInput(String(ratios.dexterity));

        return {
          ...current,
          target_strength_ratio: ratios.strength,
          target_defense_ratio: ratios.defense,
          target_speed_ratio: ratios.speed,
          target_dexterity_ratio: ratios.dexterity,
        };
      });
    };

    const handleBaldrsHighStatChange = (stat: string) => {
      setBaldrsHighStat(stat);
      let secondary = baldrsSecondaryStat;
      if (stat === secondary) {
        secondary = stat === "strength" ? "speed" : "strength";
        setBaldrsSecondaryStat(secondary);
      }
      
      setSettings((current) => {
        if (!current || current.selected_build !== "baldrs") return current;
        const ratios = calculateBaldrsRatios(stat, secondary);
        
        setStrRatioInput(String(ratios.strength));
        setDefRatioInput(String(ratios.defense));
        setSpdRatioInput(String(ratios.speed));
        setDexRatioInput(String(ratios.dexterity));

        return {
          ...current,
          target_strength_ratio: ratios.strength,
          target_defense_ratio: ratios.defense,
          target_speed_ratio: ratios.speed,
          target_dexterity_ratio: ratios.dexterity,
        };
      });
    };

    const handleBaldrsSecondaryStatChange = (secondary: string) => {
      setBaldrsSecondaryStat(secondary);
      setSettings((current) => {
        if (!current || current.selected_build !== "baldrs") return current;
        const ratios = calculateBaldrsRatios(baldrsHighStat, secondary);
        
        setStrRatioInput(String(ratios.strength));
        setDefRatioInput(String(ratios.defense));
        setSpdRatioInput(String(ratios.speed));
        setDexRatioInput(String(ratios.dexterity));

        return {
          ...current,
          target_strength_ratio: ratios.strength,
          target_defense_ratio: ratios.defense,
          target_speed_ratio: ratios.speed,
          target_dexterity_ratio: ratios.dexterity,
        };
      });
    };

    const handleRatioValueChange = (stat: "str" | "def" | "spd" | "dex", val: string) => {
      if (val === "" || /^\d+$/.test(val)) {
        if (stat === "str") {
          setStrRatioInput(val);
          const parsed = val === "" ? 0 : parseInt(val, 10);
          setSettings((curr) => curr ? { ...curr, target_strength_ratio: parsed } : null);
        } else if (stat === "def") {
          setDefRatioInput(val);
          const parsed = val === "" ? 0 : parseInt(val, 10);
          setSettings((curr) => curr ? { ...curr, target_defense_ratio: parsed } : null);
        } else if (stat === "spd") {
          setSpdRatioInput(val);
          const parsed = val === "" ? 0 : parseInt(val, 10);
          setSettings((curr) => curr ? { ...curr, target_speed_ratio: parsed } : null);
        } else if (stat === "dex") {
          setDexRatioInput(val);
          const parsed = val === "" ? 0 : parseInt(val, 10);
          setSettings((curr) => curr ? { ...curr, target_dexterity_ratio: parsed } : null);
        }
      }
    };

    const saveSettings = async () => {
      if (!settings) return false;

      const softThreshold = Number(softThresholdInput);
      if (isNaN(softThreshold) || softThreshold < 0 || softThreshold > 150) {
        toast.error("Energy soft threshold must be a number between 0 and 150");
        return false;
      }

      const aggressiveInterval = Number(aggressiveIntervalInput);
      if (isNaN(aggressiveInterval) || aggressiveInterval < 1 || aggressiveInterval > 1440) {
        toast.error("Energy aggressive interval must be between 1 and 1440 minutes");
        return false;
      }

      const strRatio = Number(strRatioInput);
      const defRatio = Number(defRatioInput);
      const spdRatio = Number(spdRatioInput);
      const dexRatio = Number(dexRatioInput);

      if (settings.selected_build === "custom") {
        const total = strRatio + defRatio + spdRatio + dexRatio;
        if (Math.abs(total - 100) > 0.5) {
          toast.error(`Custom target ratios must add up to exactly 100% (currently ${total}%)`);
          return false;
        }
      }

      const updatedSettings = {
        ...settings,
        energy_soft_threshold: softThreshold,
        energy_aggressive_interval_mins: aggressiveInterval,
        target_strength_ratio: strRatio,
        target_defense_ratio: defRatio,
        target_speed_ratio: spdRatio,
        target_dexterity_ratio: dexRatio,
      };

      try {
        const response = await fetchWithFallback("/api/config/personal", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${sessionToken}`,
          },
          body: JSON.stringify(updatedSettings),
        });

        if (!response.ok) {
          const payload = await response
            .json()
            .catch(() => ({ error: "Failed to save settings" }));
          throw new Error(payload.error || "Failed to save settings");
        }

        toast.success("Personal settings saved");
        await loadData(true);
        if (view === "oracle") {
          await loadMilestones(true, timeframe);
        }
        return true;
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Failed to save settings",
        );
        return false;
      }
    };

    const handleForceSync = async () => {
      setSyncingGym(true);
      toast.info("Triggered historical sync in background...");
      try {
        const response = await fetchWithFallback("/api/admin/sync-gym", {
          method: "POST",
          headers: { Authorization: `Bearer ${sessionToken}` },
        });
        if (!response.ok) throw new Error("Sync failed");
        
        // Wait 3 seconds for initial batch and reload
        setTimeout(async () => {
          await loadMilestones(true, timeframe);
          setSyncingGym(false);
          toast.success("Gym logs updated!");
        }, 3000);
      } catch (error) {
        console.error("[PersonalConfig] Sync failed:", error);
        toast.error("Failed to start gym logs sync");
        setSyncingGym(false);
      }
    };

    useImperativeHandle(ref, () => ({
      save: saveSettings,
    }));

    // SVG Chart renderer
    const renderSvgChart = () => {
      if (!milestones || !milestones.history || milestones.history.length === 0) {
        return (
          <div className="flex flex-col items-center justify-center h-48 border border-dashed border-border/30 rounded-2xl bg-secondary/5 p-4 text-center">
            <BarChart3 className="w-8 h-8 text-muted-foreground/50 mb-2" />
            <p className="text-xs text-muted-foreground font-medium">No training history available</p>
            <p className="text-[10px] text-muted-foreground/60 max-w-xs mt-1">
              Click the Sync button above to fetch logs from Torn.
            </p>
          </div>
        );
      }

      const historyData = milestones.history;
      const width = 600;
      const height = 220;
      const padding = { left: 50, right: 20, top: 15, bottom: 35 };

      // Map values
      const rawPoints = historyData.map((d) => ({
        day: d.day,
        value: d[activeChartTab] || 0,
      }));

      const values = rawPoints.map((p) => p.value);
      const minVal = Math.min(...values, 0);
      const maxValRaw = Math.max(...values);
      const maxVal = maxValRaw === minVal ? minVal + 10 : maxValRaw * 1.1; // 10% headroom

      const getSvgX = (index: number) => {
        if (rawPoints.length <= 1) return padding.left + (width - padding.left - padding.right) / 2;
        return padding.left + (index / (rawPoints.length - 1)) * (width - padding.left - padding.right);
      };

      const getSvgY = (val: number) => {
        const span = maxVal - minVal;
        const pct = (val - minVal) / span;
        return height - padding.bottom - pct * (height - padding.top - padding.bottom);
      };

      // Generate grid lines
      const yGridCount = 4;
      const yGridLines = Array.from({ length: yGridCount }).map((_, i) => {
        const val = minVal + (i / (yGridCount - 1)) * (maxVal - minVal);
        return {
          y: getSvgY(val),
          label: formatNumber(val),
        };
      });

      // Generate line path
      let linePath = "";
      let areaPath = "";

      if (rawPoints.length > 0) {
        linePath = rawPoints
          .map((p, idx) => `${idx === 0 ? "M" : "L"} ${getSvgX(idx)} ${getSvgY(p.value)}`)
          .join(" ");

        const bottomY = getSvgY(minVal);
        areaPath = `${linePath} L ${getSvgX(rawPoints.length - 1)} ${bottomY} L ${getSvgX(0)} ${bottomY} Z`;
      }

      // Colors based on activeTab
      const colors = {
        strength: { stroke: "#10b981", fill: "rgba(16, 185, 129, 0.15)", gradient: "strength-grad" },
        defense: { stroke: "#3b82f6", fill: "rgba(59, 130, 246, 0.15)", gradient: "defense-grad" },
        speed: { stroke: "#f59e0b", fill: "rgba(245, 158, 11, 0.15)", gradient: "speed-grad" },
        dexterity: { stroke: "#ec4899", fill: "rgba(236, 72, 153, 0.15)", gradient: "dexterity-grad" },
        energy: { stroke: "#eab308", fill: "rgba(234, 179, 8, 0.15)", gradient: "energy-grad" },
      };
      const activeColor = colors[activeChartTab];

      return (
        <div className="relative">
          <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-auto overflow-visible select-none">
            <defs>
              <linearGradient id={activeColor.gradient} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={activeColor.stroke} stopOpacity={0.25} />
                <stop offset="100%" stopColor={activeColor.stroke} stopOpacity={0.0} />
              </linearGradient>
            </defs>

            {/* Horizontal Grid lines */}
            {yGridLines.map((line, idx) => (
              <g key={idx}>
                <line
                  x1={padding.left}
                  y1={line.y}
                  x2={width - padding.right}
                  y2={line.y}
                  stroke="rgba(255,255,255,0.06)"
                  strokeWidth={1}
                />
                <text
                  x={padding.left - 8}
                  y={line.y + 4}
                  fill="hsl(var(--muted-foreground))"
                  className="text-[9px] font-mono"
                  textAnchor="end"
                >
                  {line.label}
                </text>
              </g>
            ))}

            {/* Area under the line */}
            {areaPath && (
              <path d={areaPath} fill={`url(#${activeColor.gradient})`} className="transition-all duration-300" />
            )}

            {/* Main trend line */}
            {linePath && (
              <path
                d={linePath}
                fill="none"
                stroke={activeColor.stroke}
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                className="transition-all duration-300"
              />
            )}

            {/* X Axis label entries */}
            {rawPoints.map((p, idx) => {
              // Only draw ~5 labels to avoid clutter
              const interval = Math.max(1, Math.ceil(rawPoints.length / 5));
              const shouldShowLabel = idx % interval === 0 || idx === rawPoints.length - 1;
              const dateStr = p.day.substring(5); // MM-DD
              const cx = getSvgX(idx);
              const cy = getSvgY(p.value);

              return (
                <g key={idx}>
                  {shouldShowLabel && (
                    <text
                      x={cx}
                      y={height - 12}
                      fill="hsl(var(--muted-foreground))"
                      className="text-[9px] font-mono"
                      textAnchor="middle"
                    >
                      {dateStr}
                    </text>
                  )}
                  {/* Interactive circles */}
                  <circle
                    cx={cx}
                    cy={cy}
                    r={hoveredPoint?.x === cx ? 5 : 3}
                    fill={hoveredPoint?.x === cx ? activeColor.stroke : "hsl(var(--background))"}
                    stroke={activeColor.stroke}
                    strokeWidth={1.5}
                    className="cursor-pointer transition-all duration-200"
                    onMouseEnter={() => {
                      setHoveredPoint({
                        x: cx,
                        y: cy,
                        label: p.day,
                        value: activeChartTab === "energy" ? `${p.value} E` : formatNumber(p.value),
                      });
                    }}
                    onMouseLeave={() => setHoveredPoint(null)}
                  />
                </g>
              );
            })}
          </svg>

          {/* Interactive HTML Tooltip */}
          {hoveredPoint && (
            <div
              className="absolute pointer-events-none bg-background/95 border border-border/80 px-2.5 py-1.5 rounded-lg shadow-xl text-[10px] space-y-0.5 z-20 transition-all duration-150"
              style={{
                left: `${(hoveredPoint.x / width) * 100}%`,
                top: `${(hoveredPoint.y / height) * 100 - 15}%`,
                transform: "translate(-50%, -100%)",
              }}
            >
              <div className="font-bold text-foreground">{hoveredPoint.label}</div>
              <div className="flex items-center gap-1">
                <span
                  className="w-1.5 h-1.5 rounded-full"
                  style={{ backgroundColor: activeColor.stroke }}
                />
                <span className="text-muted-foreground capitalize">{activeChartTab}:</span>
                <span className="font-mono font-bold text-primary">{hoveredPoint.value}</span>
              </div>
            </div>
          )}
        </div>
      );
    };

    // Loading checks optimized for active view
    if (view === "oracle") {
      if (loadingMilestones) {
        return (
          <LoadingScreen
            fullScreen={false}
            subMessage="Loading Milestone Oracle"
          />
        );
      }
    } else {
      if (loading || !settings) {
        return (
          <LoadingScreen
            fullScreen={false}
            subMessage="Loading Personal Config"
          />
        );
      }
    }

    if (view === "alerts" && settings) {
      return (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-500 max-w-2xl mx-auto">
          {/* Energy Alerts Enable Card */}
          <div className="bg-secondary/5 border border-border/30 rounded-3xl p-6 backdrop-blur-xs flex items-center justify-between shadow-lg">
            <div className="space-y-0.5">
              <Label className="text-sm font-bold text-foreground">Energy Notifications (Disturb Me)</Label>
              <p className="text-xs text-muted-foreground">
                Enable DM notifications when energy is full or approaching full.
              </p>
            </div>
            <Switch
              checked={settings.energy_alerts_enabled === 1}
              onCheckedChange={(checked) =>
                setSettings((current) =>
                  current ? { ...current, energy_alerts_enabled: checked ? 1 : 0 } : null,
                )
              }
            />
          </div>

          {/* Detailed Settings Panel */}
          <div className="space-y-5 bg-secondary/5 border border-border/30 rounded-3xl p-6 backdrop-blur-xs shadow-md">
            <div className="flex items-center gap-2 text-foreground font-bold border-b border-border/30 pb-3">
              <Settings className="w-4 h-4 text-primary" />
              <span>Notification Rules</span>
            </div>

            <div className="space-y-4">
              {/* Soft Alert Threshold */}
              <div className="space-y-2">
                <div className="flex items-center gap-1.5">
                  <Zap className="w-3.5 h-3.5 text-yellow-500" />
                  <Label htmlFor="soft-threshold">Soft Warning Threshold</Label>
                </div>
                <Input
                  id="soft-threshold"
                  type="text"
                  disabled={settings.energy_alerts_enabled !== 1}
                  value={softThresholdInput}
                  onChange={(e) => {
                    const val = e.target.value;
                    if (val === "" || /^\d+$/.test(val)) {
                      setSoftThresholdInput(val);
                      const parsed = val === "" ? 0 : parseInt(val, 10);
                      setSettings((curr) => curr ? { ...curr, energy_soft_threshold: parsed } : null);
                    }
                  }}
                  placeholder="130"
                />
                <p className="text-xs text-muted-foreground/80">
                  Trigger a soft DM warning once when energy reaches this level (e.g. 130). Max limit is 150.
                </p>
              </div>

              {/* Aggressive Alert Frequency */}
              <div className="space-y-2">
                <div className="flex items-center gap-1.5">
                  <Clock className="w-3.5 h-3.5 text-red-500" />
                  <Label htmlFor="aggressive-interval">Aggressive Frequency (Minutes)</Label>
                </div>
                <Input
                  id="aggressive-interval"
                  type="text"
                  disabled={settings.energy_alerts_enabled !== 1}
                  value={aggressiveIntervalInput}
                  onChange={(e) => {
                    const val = e.target.value;
                    if (val === "" || /^\d+$/.test(val)) {
                      setAggressiveIntervalInput(val);
                      const parsed = val === "" ? 0 : parseInt(val, 10);
                      setSettings((curr) => curr ? { ...curr, energy_aggressive_interval_mins: parsed } : null);
                    }
                  }}
                  placeholder="5"
                />
                <p className="text-xs text-muted-foreground/80">
                  How often to aggressively send DM alerts when energy is 100% full (e.g. every 5 minutes).
                </p>
              </div>
            </div>
          </div>
        </div>
      );
    }

    if (view === "logging" && settings) {
      return (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-500 max-w-2xl mx-auto">
          <div className="space-y-5 bg-secondary/5 border border-border/30 rounded-3xl p-6 backdrop-blur-xs shadow-md">
            <div className="flex items-center gap-2 text-foreground font-bold border-b border-border/30 pb-3">
              <Settings className="w-4 h-4 text-primary" />
              <span>Admin Logging Config</span>
            </div>

            <div className="space-y-4">
              {/* Admin Discord Log Channel Dropdown */}
              <div className="space-y-2">
                <div className="flex items-center gap-1.5">
                  <Database className="w-3.5 h-3.5 text-primary" />
                  <Label htmlFor="admin-log-channel">Discord Error Logging Channel</Label>
                </div>
                <Select
                  value={settings.admin_log_channel_id || "none"}
                  onValueChange={(val) =>
                    setSettings((current) =>
                      current
                        ? {
                            ...current,
                            admin_log_channel_id: val === "none" ? null : val,
                          }
                        : null,
                    )
                  }
                >
                  <SelectTrigger className="w-full bg-background border-border/50">
                    <SelectValue placeholder="Select logging channel" />
                  </SelectTrigger>
                  <SelectContent className="bg-background border-border">
                    <SelectItem value="none">Disabled (No channel)</SelectItem>
                    {channels.map((ch) => (
                      <SelectItem key={ch.id} value={ch.id}>
                        #{ch.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground/80">
                  Pipes background worker errors and system crashes as embeds directly to this Discord channel.
                </p>
              </div>

              {/* Error Pings Switch */}
              <div className="flex items-center justify-between border-t border-border/20 pt-4 mt-4">
                <div className="space-y-0.5">
                  <Label className="text-sm font-bold text-foreground">Ping Owner on Errors</Label>
                  <p className="text-xs text-muted-foreground">
                    Pings your Discord ID on critical system error alerts sent to the channel.
                  </p>
                </div>
                <Switch
                  checked={settings.error_pings_enabled === 1}
                  onCheckedChange={(checked) =>
                    setSettings((current) =>
                      current ? { ...current, error_pings_enabled: checked ? 1 : 0 } : null,
                    )
                  }
                />
              </div>
            </div>
          </div>
        </div>
      );
    }

    if (view === "oracle" && milestones) {
      return (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-500 max-w-4xl mx-auto">
          {/* Top Panel: Summary & Sync Status */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
            <div className="lg:col-span-2 bg-secondary/5 border border-border/30 rounded-3xl p-6 backdrop-blur-xs shadow-md space-y-4">
              <div className="flex items-center gap-2 text-foreground font-bold border-b border-border/30 pb-3">
                <Target className="w-4 h-4 text-primary" />
                <span>Predictive Milestone Oracle</span>
              </div>
              <p className="text-xs text-muted-foreground">
                Estimates training times to key milestones based on your active gym multipliers, your historical train frequencies, and Vladar's Torn Gym Gain formulas.
              </p>
              
              <div className="grid grid-cols-3 gap-3 pt-2">
                <div className="bg-secondary/10 border border-border/20 p-3.5 rounded-2xl flex flex-col justify-between">
                  <span className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider">Active Gym</span>
                  <span className="text-xs font-bold text-foreground mt-1 truncate">{milestones.activeGym}</span>
                </div>
                <div className="bg-secondary/10 border border-border/20 p-3.5 rounded-2xl flex flex-col justify-between">
                  <span className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider">Daily Energy</span>
                  <span className="text-xs font-bold text-foreground mt-1">{milestones.avgDailyEnergy} E/day</span>
                </div>
                <div className="bg-secondary/10 border border-border/20 p-3.5 rounded-2xl flex flex-col justify-between">
                  <span className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider">Current Happy</span>
                  <span className="text-xs font-bold text-foreground mt-1 truncate">
                    {milestones.currentHappy.toLocaleString()} / {milestones.maxHappy.toLocaleString()}
                  </span>
                </div>
              </div>
            </div>

             <div className="bg-secondary/5 border border-border/30 rounded-3xl p-6 backdrop-blur-xs shadow-md flex flex-col justify-between space-y-4">
              <div className="space-y-3">
                <div className="flex items-center gap-1.5 text-foreground font-bold border-b border-border/30 pb-3">
                  <Database className="w-3.5 h-3.5 text-primary" />
                  <span>Sync Status</span>
                </div>
                <div className="space-y-2 text-xs">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Synced Records</span>
                    <span className="font-mono font-bold text-foreground">{milestones.syncStatus.totalRecords.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Sync Scope</span>
                    <span className="font-bold text-[10px]">
                      {milestones.syncStatus.isBackfillComplete ? (
                        <span className="text-emerald-500 font-bold">Complete History</span>
                      ) : milestones.syncStatus.oldestLogTimestamp ? (
                        <span className="text-amber-500 font-bold">Crawling History...</span>
                      ) : (
                        <span className="text-muted-foreground">Not Synced</span>
                      )}
                    </span>
                  </div>
                  {milestones.syncStatus.oldestLogTimestamp && milestones.syncStatus.latestLogTimestamp && (
                    <div className="flex flex-col gap-0.5 border-t border-border/10 pt-2 mt-1">
                      <span className="text-muted-foreground text-[10px]">Coverage Range</span>
                      <span className="font-mono font-bold text-foreground text-[9px] truncate">
                        {new Date(milestones.syncStatus.oldestLogTimestamp * 1000).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "2-digit" })}
                        {" - "}
                        {new Date(milestones.syncStatus.latestLogTimestamp * 1000).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "2-digit" })}
                      </span>
                    </div>
                  )}
                  <div className="flex justify-between border-t border-border/10 pt-2">
                    <span className="text-muted-foreground">Last Sync Check</span>
                    <span className="font-mono font-bold text-foreground text-[10px]">
                      {milestones.syncStatus.lastSyncAt
                        ? new Date(milestones.syncStatus.lastSyncAt).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
                        : "Never"}
                    </span>
                  </div>
                </div>
              </div>

              <button
                disabled={syncingGym}
                onClick={handleForceSync}
                className="w-full bg-primary/10 hover:bg-primary/20 border border-primary/30 text-primary text-xs font-bold py-2.5 px-4 rounded-xl flex items-center justify-center gap-2 transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${syncingGym ? "animate-spin" : ""}`} />
                <span>{syncingGym ? "Syncing..." : "Sync Historical Logs"}</span>
              </button>
            </div>
          </div>

          {/* Target Stat Build & Training Recommendations */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
            {/* Recommendations Column */}
            <div className="lg:col-span-2 bg-secondary/5 border border-border/30 rounded-3xl p-6 backdrop-blur-xs shadow-md space-y-4">
              <div className="flex items-center gap-1.5 text-foreground font-bold border-b border-border/30 pb-3">
                <Sparkles className="w-4 h-4 text-amber-500 animate-pulse" />
                <span>Training Recommendations</span>
              </div>
              
              <div className="space-y-4">
                {/* Main Recommendation Text Card */}
                <div className="bg-primary/5 border border-primary/25 p-4 rounded-2xl space-y-2 relative overflow-hidden">
                  <div className="absolute top-0 right-0 w-24 h-24 bg-primary/10 rounded-full blur-2xl -mr-6 -mt-6 pointer-events-none" />
                  <div className="flex items-center gap-2">
                    <TrendingUp className="w-4 h-4 text-primary" />
                    <span className="text-xs font-bold text-foreground uppercase tracking-wider">Optimal Focus</span>
                  </div>
                  <p className="text-xs text-foreground/90 leading-relaxed font-semibold">
                    {milestones.recommendation.text}
                  </p>
                </div>

                {/* Gym Switch Recommendation Card if present */}
                {milestones.recommendation.gymRecommendation && (
                  <div className="bg-amber-500/5 border border-amber-500/30 p-4 rounded-2xl space-y-2 relative overflow-hidden">
                    <div className="absolute top-0 right-0 w-24 h-24 bg-amber-500/10 rounded-full blur-2xl -mr-6 -mt-6 pointer-events-none" />
                    <div className="flex items-center gap-2">
                      <Flame className="w-4 h-4 text-amber-500 animate-pulse" />
                      <span className="text-xs font-bold text-amber-500 uppercase tracking-wider">Gym Selection</span>
                    </div>
                    <p className="text-xs text-foreground/90 leading-relaxed font-medium">
                      {milestones.recommendation.gymRecommendation}
                    </p>
                  </div>
                )}
              </div>
            </div>

            {/* Target Build Settings Column */}
            <div className="bg-secondary/5 border border-border/30 rounded-3xl p-6 backdrop-blur-xs shadow-md space-y-4">
              <div className="flex items-center gap-1.5 text-foreground font-bold border-b border-border/30 pb-3">
                <Target className="w-4 h-4 text-primary" />
                <span>Target Stat Build</span>
              </div>
              
              {settings && (
                <div className="space-y-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="build-preset" className="text-xs text-muted-foreground font-semibold">Select Preset</Label>
                    <Select
                      value={settings.selected_build || "balanced"}
                      onValueChange={handleBuildPresetChange}
                    >
                      <SelectTrigger id="build-preset" className="w-full bg-background border-border/50 text-xs">
                        <SelectValue placeholder="Select build preset" />
                      </SelectTrigger>
                      <SelectContent className="bg-background border-border text-xs">
                        <SelectItem value="balanced">Balanced (25% each)</SelectItem>
                        <SelectItem value="hanks">Hank's Ratio</SelectItem>
                        <SelectItem value="baldrs">Baldr's Ratio</SelectItem>
                        <SelectItem value="custom">Custom Ratios</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {settings.selected_build === "hanks" && (
                    <div className="space-y-3 border-t border-border/20 pt-3 animate-in fade-in slide-in-from-top-1 duration-200">
                      <div className="space-y-1.5">
                        <Label htmlFor="hanks-high-stat" className="text-xs text-muted-foreground font-semibold">Select High Stat</Label>
                        <Select
                          value={hanksHighStat}
                          onValueChange={handleHanksHighStatChange}
                        >
                          <SelectTrigger id="hanks-high-stat" className="w-full bg-background border-border/50 text-xs">
                            <SelectValue placeholder="Select High Stat" />
                          </SelectTrigger>
                          <SelectContent className="bg-background border-border text-xs">
                            <SelectItem value="strength">Strength</SelectItem>
                            <SelectItem value="defense">Defense</SelectItem>
                            <SelectItem value="speed">Speed</SelectItem>
                            <SelectItem value="dexterity">Dexterity</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <p className="text-[10px] text-muted-foreground/80 leading-normal">
                        Hank's Ratio sets the high stat to 34.72%, its opposite low stat to 9.72%, and the other two medium stats to 27.78%.
                      </p>
                    </div>
                  )}

                  {settings.selected_build === "baldrs" && (
                    <div className="space-y-3 border-t border-border/20 pt-3 animate-in fade-in slide-in-from-top-1 duration-200">
                      <div className="space-y-1.5">
                        <Label htmlFor="baldrs-high-stat" className="text-xs text-muted-foreground font-semibold">Select High Stat</Label>
                        <Select
                          value={baldrsHighStat}
                          onValueChange={handleBaldrsHighStatChange}
                        >
                          <SelectTrigger id="baldrs-high-stat" className="w-full bg-background border-border/50 text-xs">
                            <SelectValue placeholder="Select High Stat" />
                          </SelectTrigger>
                          <SelectContent className="bg-background border-border text-xs">
                            <SelectItem value="strength">Strength</SelectItem>
                            <SelectItem value="defense">Defense</SelectItem>
                            <SelectItem value="speed">Speed</SelectItem>
                            <SelectItem value="dexterity">Dexterity</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="space-y-1.5">
                        <Label htmlFor="baldrs-secondary-stat" className="text-xs text-muted-foreground font-semibold">Select Secondary Stat</Label>
                        <Select
                          value={baldrsSecondaryStat}
                          onValueChange={handleBaldrsSecondaryStatChange}
                        >
                          <SelectTrigger id="baldrs-secondary-stat" className="w-full bg-background border-border/50 text-xs">
                            <SelectValue placeholder="Select Secondary Stat" />
                          </SelectTrigger>
                          <SelectContent className="bg-background border-border text-xs">
                            {["strength", "defense", "speed", "dexterity"]
                              .filter((s) => s !== baldrsHighStat)
                              .map((s) => (
                                <SelectItem key={s} value={s}>
                                  {s.charAt(0).toUpperCase() + s.slice(1)}
                                </SelectItem>
                              ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <p className="text-[10px] text-muted-foreground/80 leading-normal">
                        Baldr's Ratio sets the high stat to 30.86%, the secondary stat to 24.70%, and the other two low stats to 22.22%.
                      </p>
                    </div>
                  )}

                  {settings.selected_build === "custom" && (
                    <div className="space-y-3 border-t border-border/20 pt-3 animate-in fade-in slide-in-from-top-1 duration-200">
                      <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider block">Custom Targets (%)</span>
                      <div className="grid grid-cols-2 gap-2">
                        <div className="space-y-1">
                          <div className="flex justify-between items-center">
                            <Label htmlFor="str-ratio" className="text-[10px] text-muted-foreground font-mono">Strength</Label>
                            {milestones?.recommendation?.factionPerks?.strength ? (
                              <span className="text-[9px] text-emerald-400 font-sans font-medium">
                                +{milestones.recommendation.factionPerks.strength}% Steadfast
                              </span>
                            ) : null}
                          </div>
                          <Input
                            id="str-ratio"
                            type="text"
                            className="h-8 text-xs font-mono"
                            value={strRatioInput}
                            onChange={(e) => handleRatioValueChange("str", e.target.value)}
                          />
                        </div>
                        <div className="space-y-1">
                          <div className="flex justify-between items-center">
                            <Label htmlFor="def-ratio" className="text-[10px] text-muted-foreground font-mono">Defense</Label>
                            {milestones?.recommendation?.factionPerks?.defense ? (
                              <span className="text-[9px] text-emerald-400 font-sans font-medium">
                                +{milestones.recommendation.factionPerks.defense}% Steadfast
                              </span>
                            ) : null}
                          </div>
                          <Input
                            id="def-ratio"
                            type="text"
                            className="h-8 text-xs font-mono"
                            value={defRatioInput}
                            onChange={(e) => handleRatioValueChange("def", e.target.value)}
                          />
                        </div>
                        <div className="space-y-1">
                          <div className="flex justify-between items-center">
                            <Label htmlFor="spd-ratio" className="text-[10px] text-muted-foreground font-mono">Speed</Label>
                            {milestones?.recommendation?.factionPerks?.speed ? (
                              <span className="text-[9px] text-emerald-400 font-sans font-medium">
                                +{milestones.recommendation.factionPerks.speed}% Steadfast
                              </span>
                            ) : null}
                          </div>
                          <Input
                            id="spd-ratio"
                            type="text"
                            className="h-8 text-xs font-mono"
                            value={spdRatioInput}
                            onChange={(e) => handleRatioValueChange("spd", e.target.value)}
                          />
                        </div>
                        <div className="space-y-1">
                          <div className="flex justify-between items-center">
                            <Label htmlFor="dex-ratio" className="text-[10px] text-muted-foreground font-mono">Dexterity</Label>
                            {milestones?.recommendation?.factionPerks?.dexterity ? (
                              <span className="text-[9px] text-emerald-400 font-sans font-medium">
                                +{milestones.recommendation.factionPerks.dexterity}% Steadfast
                              </span>
                            ) : null}
                          </div>
                          <Input
                            id="dex-ratio"
                            type="text"
                            className="h-8 text-xs font-mono"
                            value={dexRatioInput}
                            onChange={(e) => handleRatioValueChange("dex", e.target.value)}
                          />
                        </div>
                      </div>
                      
                      {/* Check if sums to 100 */}
                      {(() => {
                        const total = (Number(strRatioInput) || 0) + (Number(defRatioInput) || 0) + (Number(spdRatioInput) || 0) + (Number(dexRatioInput) || 0);
                        const isValid = Math.abs(total - 100) < 0.01;
                        return (
                          <div className={`text-[10px] font-bold text-right mt-1 ${isValid ? "text-emerald-500" : "text-amber-500"}`}>
                            Total: {total}% {isValid ? "(Valid)" : "(Must sum to 100%)"}
                          </div>
                        );
                      })()}
                    </div>
                  )}

                  {/* Summary Target List */}
                  {settings.selected_build !== "custom" && (
                    <div className="space-y-1.5 border-t border-border/20 pt-3">
                      <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider block">Target Percentages</span>
                      <div className="grid grid-cols-2 gap-2 text-xs font-mono">
                        <div className="bg-secondary/15 px-2 py-1 rounded-lg flex justify-between items-center">
                          <span className="text-muted-foreground">Str:</span>
                          <div className="flex items-center gap-1.5">
                            {milestones?.recommendation?.factionPerks?.strength ? (
                              <span className="text-[9px] bg-emerald-500/10 text-emerald-400 px-1 py-0.25 rounded font-sans border border-emerald-500/20 font-medium">
                                +{milestones.recommendation.factionPerks.strength}%
                              </span>
                            ) : null}
                            <span className="font-bold text-foreground">{Number(strRatioInput).toFixed(2)}%</span>
                          </div>
                        </div>
                        <div className="bg-secondary/15 px-2 py-1 rounded-lg flex justify-between items-center">
                          <span className="text-muted-foreground">Def:</span>
                          <div className="flex items-center gap-1.5">
                            {milestones?.recommendation?.factionPerks?.defense ? (
                              <span className="text-[9px] bg-emerald-500/10 text-emerald-400 px-1 py-0.25 rounded font-sans border border-emerald-500/20 font-medium">
                                +{milestones.recommendation.factionPerks.defense}%
                              </span>
                            ) : null}
                            <span className="font-bold text-foreground">{Number(defRatioInput).toFixed(2)}%</span>
                          </div>
                        </div>
                        <div className="bg-secondary/15 px-2 py-1 rounded-lg flex justify-between items-center">
                          <span className="text-muted-foreground">Spd:</span>
                          <div className="flex items-center gap-1.5">
                            {milestones?.recommendation?.factionPerks?.speed ? (
                              <span className="text-[9px] bg-emerald-500/10 text-emerald-400 px-1 py-0.25 rounded font-sans border border-emerald-500/20 font-medium">
                                +{milestones.recommendation.factionPerks.speed}%
                              </span>
                            ) : null}
                            <span className="font-bold text-foreground">{Number(spdRatioInput).toFixed(2)}%</span>
                          </div>
                        </div>
                        <div className="bg-secondary/15 px-2 py-1 rounded-lg flex justify-between items-center">
                          <span className="text-muted-foreground">Dex:</span>
                          <div className="flex items-center gap-1.5">
                            {milestones?.recommendation?.factionPerks?.dexterity ? (
                              <span className="text-[9px] bg-emerald-500/10 text-emerald-400 px-1 py-0.25 rounded font-sans border border-emerald-500/20 font-medium">
                                +{milestones.recommendation.factionPerks.dexterity}%
                              </span>
                            ) : null}
                            <span className="font-bold text-foreground">{Number(dexRatioInput).toFixed(2)}%</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Core Visual Panel: History Graph & Allocation */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
            {/* Custom SVG Line Chart */}
            <div className="lg:col-span-2 bg-secondary/5 border border-border/30 rounded-3xl p-6 backdrop-blur-xs shadow-md space-y-5">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-border/30 pb-3">
                <div className="flex items-center gap-1.5 text-foreground font-bold">
                  <TrendingUp className="w-4 h-4 text-primary" />
                  <span>Training Logs History</span>
                </div>
                
                <div className="flex flex-wrap items-center gap-2">
                  {/* Tabs to select stat to display in chart */}
                  <div className="flex items-center bg-secondary/15 p-1 rounded-xl border border-border/20 text-[10px] font-bold">
                    {([
                      { id: "strength", label: "Str" },
                      { id: "defense", label: "Def" },
                      { id: "speed", label: "Spd" },
                      { id: "dexterity", label: "Dex" },
                      { id: "energy", label: "Energy" },
                    ] as const).map((t) => (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => setActiveChartTab(t.id)}
                        className={`px-2 py-0.5 rounded-lg transition-all cursor-pointer ${
                          activeChartTab === t.id
                            ? "bg-primary text-primary-foreground shadow-sm"
                            : "text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        {t.label}
                      </button>
                    ))}
                  </div>

                  {/* Timeframe Selector */}
                  <div className="flex items-center bg-secondary/15 p-1 rounded-xl border border-border/20 text-[10px] font-bold">
                    {([
                      { id: "7d", label: "7D" },
                      { id: "30d", label: "30D" },
                      { id: "90d", label: "90D" },
                      { id: "all", label: "All" },
                    ] as const).map((t) => (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => setTimeframe(t.id)}
                        className={`px-2 py-0.5 rounded-lg transition-all cursor-pointer ${
                          timeframe === t.id
                            ? "bg-primary text-primary-foreground shadow-sm"
                            : "text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        {t.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {renderSvgChart()}
            </div>

            {/* Stat distribution list */}
            <div className="bg-secondary/5 border border-border/30 rounded-3xl p-6 backdrop-blur-xs shadow-md space-y-4">
              <div className="flex items-center gap-1.5 text-foreground font-bold border-b border-border/30 pb-3">
                <BarChart3 className="w-4 h-4 text-primary" />
                <span>Energy Allocation</span>
              </div>
              <p className="text-[10px] text-muted-foreground">
                Distribution of trains based on historical records. Estimates assume this ratio will continue.
              </p>

              <div className="space-y-4 pt-1">
                {milestones.projections.map((p) => {
                  const colors = {
                    strength: "bg-emerald-500",
                    defense: "bg-blue-500",
                    speed: "bg-amber-500",
                    dexterity: "bg-pink-500",
                  };
                  const activeColor = colors[p.stat as keyof typeof colors] || "bg-primary";
                  
                  return (
                    <div key={p.stat} className="space-y-1.5">
                      <div className="flex justify-between items-center text-xs">
                        <span className="font-bold capitalize text-foreground">{p.stat}</span>
                        <span className="text-muted-foreground font-mono text-[10px]">
                          {p.allocation}% ({p.dailyEnergy} E/day)
                        </span>
                      </div>
                      <div className="w-full bg-secondary/20 h-2 rounded-full overflow-hidden">
                        <div
                          className={`${activeColor} h-full rounded-full transition-all duration-500`}
                          style={{ width: `${p.allocation}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Predictions Timeline Projections */}
          <div className="space-y-5 bg-secondary/5 border border-border/30 rounded-3xl p-6 backdrop-blur-xs shadow-md">
            <div className="flex items-center gap-1.5 text-foreground font-bold border-b border-border/30 pb-3">
              <Calendar className="w-4 h-4 text-primary" />
              <span>Milestone Timeline Predictions</span>
            </div>

            <div className="space-y-6">
              {milestones.projections.map((p) => (
                <div key={p.stat} className="space-y-2 border-l-2 border-border/40 pl-4 py-1">
                  <h4 className="text-xs font-bold capitalize text-foreground flex items-center gap-1.5">
                    <Flame className="w-3.5 h-3.5 text-primary" />
                    <span>{p.stat} Projections</span>
                    <span className="text-[10px] text-muted-foreground font-normal ml-2">
                      (Current: {formatNumber(p.currentValue)})
                    </span>
                  </h4>
                  
                  {p.allocation === 0 ? (
                    <p className="text-[10px] text-muted-foreground italic pl-2">
                      Oracle inactive: Allocation is 0%. Increase trains in this stat to estimate milestones.
                    </p>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 pl-2">
                      {p.milestones.map((m) => (
                        <div
                          key={m.target}
                          className="bg-secondary/10 border border-border/20 p-3 rounded-xl flex items-center justify-between text-xs transition-hover hover:border-border/60"
                        >
                          <div className="space-y-0.5">
                            <span className="text-[10px] text-muted-foreground">Target</span>
                            <div className="font-bold text-foreground">{formatNumber(m.target)}</div>
                          </div>
                          
                          {m.days === 0 ? (
                            <span className="bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 px-2 py-0.5 rounded-md font-bold tracking-wide uppercase text-[8px]">
                              Achieved
                            </span>
                          ) : m.days !== null ? (
                            <div className="text-right space-y-0.5">
                              <div className="font-bold text-foreground flex items-center gap-1 justify-end">
                                <span>{m.days.toLocaleString()}</span>
                                <span className="text-[10px] text-muted-foreground font-normal">days</span>
                              </div>
                              <div className="text-muted-foreground text-[9px] flex items-center gap-1 justify-end font-mono">
                                <ArrowRight className="w-2.5 h-2.5" />
                                {formatDateFromDays(m.days)}
                              </div>
                            </div>
                          ) : (
                            <span className="text-muted-foreground italic text-[10px]">Unavailable</span>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      );
    }

    return null;
  },
);

const formatDateFromDays = (days: number): string => {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
};

const formatNumber = (num: number): string => {
  if (num >= 1_000_000_000) {
    return (num / 1_000_000_000).toFixed(1) + "B";
  }
  if (num >= 1_000_000) {
    return (num / 1_000_000).toFixed(1) + "M";
  }
  if (num >= 1_000) {
    return (num / 1_000).toFixed(1) + "K";
  }
  return num.toLocaleString();
};

PersonalConfig.displayName = "PersonalConfig";
export default PersonalConfig;
