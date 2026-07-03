"use client";

import { useState, useEffect, useCallback } from "react";
import { DashboardLayout } from "@/components/dashboard-layout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Settings, Save, RefreshCw, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { ErrorState } from "@/components/error-state";

interface BuildPreset {
  id: string;
  name: string;
  description: string;
  configurations: Array<{
    main_stat: string;
    notes: string;
    ratios: {
      strength: number;
      speed: number;
      defense: number;
      dexterity: number;
    };
  }>;
}

interface PersonalSettings {
  user_id: string;
  discord_id: string;
  energy_alerts_enabled: number;
  energy_soft_threshold: number;
  energy_aggressive_interval_mins: number;
  drug_alerts_enabled: number;
  crime_alerts_enabled: number;
  crime_soft_threshold: number;
  selected_build: string;
  target_strength_ratio: number;
  target_defense_ratio: number;
  target_speed_ratio: number;
  target_dexterity_ratio: number;
  max_nerve?: number;
}

export default function SettingsPage() {
  const [settings, setSettings] = useState<PersonalSettings>({
    user_id: "",
    discord_id: "",
    energy_alerts_enabled: 0,
    energy_soft_threshold: 130,
    energy_aggressive_interval_mins: 5,
    drug_alerts_enabled: 0,
    crime_alerts_enabled: 0,
    crime_soft_threshold: 15,
    selected_build: "balanced",
    target_strength_ratio: 25,
    target_defense_ratio: 25,
    target_speed_ratio: 25,
    target_dexterity_ratio: 25,
  });

  const [selectedMainStat, setSelectedMainStat] = useState<string>("");
  const [presets, setPresets] = useState<BuildPreset[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch settings and presets
  const loadData = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const [settingsRes, buildsRes] = await Promise.all([
        fetch("/api/bot/config/personal"),
        fetch("/api/bot/config/personal/builds"),
      ]);

      if (!settingsRes.ok) {
        throw new Error(`Failed to fetch personal settings: ${settingsRes.status} ${settingsRes.statusText}`);
      }
      if (!buildsRes.ok) {
        throw new Error(`Failed to fetch build presets: ${buildsRes.status} ${buildsRes.statusText}`);
      }

      const settingsData = await settingsRes.json();
      setSettings(settingsData);
      const currentBuildId = settingsData.selected_build;
      const currentRatios = {
        strength: settingsData.target_strength_ratio,
        speed: settingsData.target_speed_ratio,
        defense: settingsData.target_defense_ratio,
        dexterity: settingsData.target_dexterity_ratio,
      };

      const buildsData = await buildsRes.json();
      setPresets(buildsData);

      if (currentBuildId && currentBuildId !== "custom") {
        const preset = buildsData.find((p: BuildPreset) => p.id === currentBuildId);
        if (preset) {
          let matchedStat = preset.configurations[0]?.main_stat || "";
          for (const config of preset.configurations) {
            const dStr = Math.abs(config.ratios.strength - currentRatios.strength);
            const dSpd = Math.abs(config.ratios.speed - currentRatios.speed);
            const dDef = Math.abs(config.ratios.defense - currentRatios.defense);
            const dDex = Math.abs(config.ratios.dexterity - currentRatios.dexterity);
            if (dStr < 0.2 && dSpd < 0.2 && dDef < 0.2 && dDex < 0.2) {
              matchedStat = config.main_stat;
              break;
            }
          }
          setSelectedMainStat(matchedStat);
        }
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      console.error("Failed to load settings data:", err);
      setError(err.message || String(err));
      toast.error("Failed to load settings from server");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadData();
  }, [loadData]);

  const totalRatio =
    Number(settings.target_strength_ratio) +
    Number(settings.target_defense_ratio) +
    Number(settings.target_speed_ratio) +
    Number(settings.target_dexterity_ratio);

  const isRatioValid = Math.abs(totalRatio - 100) <= 0.01;

  const applyPresetConfiguration = (preset: BuildPreset, mainStat: string) => {
    const config = preset.configurations.find((c) => c.main_stat === mainStat) || preset.configurations[0];
    if (!config) return;

    const strength = config.ratios.strength;
    const speed = config.ratios.speed;
    const defense = config.ratios.defense;
    const dexterity = config.ratios.dexterity;

    // Compute total of original ratios
    const sum = strength + speed + defense + dexterity;
    const delta = 100 - sum;

    // Adjust the primary/main stat so that the total is exactly 100.00%
    let adjStrength = strength;
    let adjSpeed = speed;
    let adjDefense = defense;
    let adjDexterity = dexterity;

    if (Math.abs(delta) > 0.001) {
      if (mainStat === "strength") adjStrength = Math.round((strength + delta) * 100) / 100;
      else if (mainStat === "speed") adjSpeed = Math.round((speed + delta) * 100) / 100;
      else if (mainStat === "defense") adjDefense = Math.round((defense + delta) * 100) / 100;
      else if (mainStat === "dexterity") adjDexterity = Math.round((dexterity + delta) * 100) / 100;
    }

    setSettings((prev) => ({
      ...prev,
      selected_build: preset.id,
      target_strength_ratio: adjStrength,
      target_speed_ratio: adjSpeed,
      target_defense_ratio: adjDefense,
      target_dexterity_ratio: adjDexterity,
    }));
  };

  const handleBuildPresetChange = (presetId: string) => {
    if (presetId === "custom") {
      setSettings((prev) => ({ ...prev, selected_build: "custom" }));
      setSelectedMainStat("");
      return;
    }

    const preset = presets.find((p) => p.id === presetId);
    if (!preset || preset.configurations.length === 0) return;

    const defaultMainStat = preset.configurations[0].main_stat;
    setSelectedMainStat(defaultMainStat);
    applyPresetConfiguration(preset, defaultMainStat);
  };

  const handleMainStatChange = (mainStat: string) => {
    setSelectedMainStat(mainStat);
    const preset = presets.find((p) => p.id === settings.selected_build);
    if (preset) {
      applyPresetConfiguration(preset, mainStat);
    }
  };

  const handleSave = async () => {
    if (!isRatioValid) {
      toast.error(`Target ratios must sum to exactly 100% (currently ${totalRatio}%)`);
      return;
    }

    setSaving(true);

    try {
      const res = await fetch("/api/bot/config/personal", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(settings),
      });

      const data = await res.json();
      if (res.ok) {
        toast.success("Settings saved successfully");
      } else {
        toast.error(data.error || "Failed to save settings");
      }
    } catch (err: unknown) {
      console.error("Error saving settings:", err);
      toast.error("Network error saving settings");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <DashboardLayout>
        <div className="flex h-64 items-center justify-center gap-2">
          <RefreshCw className="h-6 w-6 animate-spin text-amber-500" />
          <span className="text-zinc-500 dark:text-zinc-400">Loading settings...</span>
        </div>
      </DashboardLayout>
    );
  }

  if (error) {
    return (
      <DashboardLayout>
        <div className="space-y-6">
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <Settings className="h-6 w-6 text-zinc-900 dark:text-white" />
              <h1 className="text-2xl font-bold tracking-tight md:text-3xl">Settings</h1>
            </div>
            <p className="text-zinc-500 dark:text-zinc-400">
              Configure your personal stat targets, training builds, and alert notifications.
            </p>
          </div>
          <ErrorState
            title="Failed to Load Settings"
            description="We were unable to connect to the bot server to retrieve your settings. Please verify the bot is online."
            errorDetails={error}
            onRetry={loadData}
          />
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <Settings className="h-6 w-6 text-zinc-900 dark:text-white" />
            <h1 className="text-2xl font-bold tracking-tight md:text-3xl font-heading text-zinc-900 dark:text-zinc-50">Settings</h1>
          </div>
          <p className="text-zinc-500 dark:text-zinc-400">
            Configure your personal stat targets, training builds, and alert notifications.
          </p>
        </div>

        {/* Feedback messages are displayed via Sonner Toast notifications */}

        <div className="grid gap-6 md:grid-cols-2">
          {/* Gym & Stats Section */}
          <Card className="border-zinc-200 dark:border-zinc-900 bg-white/50 dark:bg-zinc-950/50 backdrop-blur shadow-sm">
            <CardHeader>
              <CardTitle className="text-lg font-bold font-heading">Gym & Stats</CardTitle>
              <CardDescription>
                Define your training targets and ratio percentages for optimization.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Build Preset Selection */}
              <div className="space-y-2">
                <label className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">
                  Build Preset
                </label>
                <div className="relative">
                  <select
                    value={settings.selected_build}
                    onChange={(e) => handleBuildPresetChange(e.target.value)}
                    className="w-full rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100 shadow-sm focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
                  >
                    <option value="custom">Custom Build</option>
                    {presets.map((preset) => (
                      <option key={preset.id} value={preset.id}>
                        {preset.name}
                      </option>
                    ))}
                  </select>
                </div>
                {settings.selected_build !== "custom" && (
                  <p className="text-xs text-zinc-500 dark:text-zinc-400 italic">
                    {presets.find((p) => p.id === settings.selected_build)?.description}
                  </p>
                )}
              </div>

              {/* Primary Stat Selection (Only if preset selected) */}
              {settings.selected_build !== "custom" && (
                <div className="space-y-2">
                  <label className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">
                    Primary/Main Stat Focus
                  </label>
                  <div className="relative">
                    <select
                      value={selectedMainStat}
                      onChange={(e) => handleMainStatChange(e.target.value)}
                      className="w-full rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100 shadow-sm focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
                    >
                      {presets
                        .find((p) => p.id === settings.selected_build)
                        ?.configurations.map((config) => (
                          <option key={config.main_stat} value={config.main_stat}>
                            {config.main_stat.charAt(0).toUpperCase() + config.main_stat.slice(1)} Focus
                          </option>
                        ))}
                    </select>
                  </div>
                  {presets.find((p) => p.id === settings.selected_build)?.configurations.find((c) => c.main_stat === selectedMainStat)?.notes && (
                    <p className="text-xs text-zinc-500 dark:text-zinc-400 italic">
                      {presets.find((p) => p.id === settings.selected_build)?.configurations.find((c) => c.main_stat === selectedMainStat)?.notes}
                    </p>
                  )}
                </div>
              )}

              {/* Ratios Input Grid */}
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <label className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">
                    Target Ratios
                  </label>
                  <span
                    className={`text-xs font-bold px-2 py-0.5 rounded-full ${isRatioValid
                      ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                      : "bg-amber-500/10 text-amber-600 dark:text-amber-400"
                      }`}
                  >
                    Total: {totalRatio}%
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <span className="text-xs text-zinc-500 dark:text-zinc-400">Strength (%)</span>
                    <Input
                      type="number"
                      value={settings.target_strength_ratio}
                      disabled={settings.selected_build !== "custom"}
                      onChange={(e) =>
                        setSettings((prev) => ({
                          ...prev,
                          selected_build: "custom",
                          target_strength_ratio: parseFloat(e.target.value) || 0,
                        }))
                      }
                      className="border-zinc-200 dark:border-zinc-800 focus-visible:ring-amber-500 disabled:opacity-60 disabled:cursor-not-allowed"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <span className="text-xs text-zinc-500 dark:text-zinc-400">Defense (%)</span>
                    <Input
                      type="number"
                      value={settings.target_defense_ratio}
                      disabled={settings.selected_build !== "custom"}
                      onChange={(e) =>
                        setSettings((prev) => ({
                          ...prev,
                          selected_build: "custom",
                          target_defense_ratio: parseFloat(e.target.value) || 0,
                        }))
                      }
                      className="border-zinc-200 dark:border-zinc-800 focus-visible:ring-amber-500 disabled:opacity-60 disabled:cursor-not-allowed"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <span className="text-xs text-zinc-500 dark:text-zinc-400">Speed (%)</span>
                    <Input
                      type="number"
                      value={settings.target_speed_ratio}
                      disabled={settings.selected_build !== "custom"}
                      onChange={(e) =>
                        setSettings((prev) => ({
                          ...prev,
                          selected_build: "custom",
                          target_speed_ratio: parseFloat(e.target.value) || 0,
                        }))
                      }
                      className="border-zinc-200 dark:border-zinc-800 focus-visible:ring-amber-500 disabled:opacity-60 disabled:cursor-not-allowed"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <span className="text-xs text-zinc-500 dark:text-zinc-400">Dexterity (%)</span>
                    <Input
                      type="number"
                      value={settings.target_dexterity_ratio}
                      disabled={settings.selected_build !== "custom"}
                      onChange={(e) =>
                        setSettings((prev) => ({
                          ...prev,
                          selected_build: "custom",
                          target_dexterity_ratio: parseFloat(e.target.value) || 0,
                        }))
                      }
                      className="border-zinc-200 dark:border-zinc-800 focus-visible:ring-amber-500 disabled:opacity-60 disabled:cursor-not-allowed"
                    />
                  </div>
                </div>

                {!isRatioValid && (
                  <div className="flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400">
                    <AlertTriangle className="h-4 w-4 shrink-0" />
                    <span>Values must add up to exactly 100% (currently off by {(totalRatio - 100).toFixed(2)}%)</span>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Alerts & Notifications Section */}
          <Card className="border-zinc-200 dark:border-zinc-900 bg-white/50 dark:bg-zinc-950/50 backdrop-blur shadow-sm">
            <CardHeader>
              <CardTitle className="text-lg font-bold font-heading">Alerts & Notifications</CardTitle>
              <CardDescription>
                Configure energy alerts, cooldown timers, and frequency settings.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Energy Alerts Toggle */}
              <div className="flex items-center justify-between border-b border-zinc-100 dark:border-zinc-900 pb-4">
                <div className="space-y-0.5">
                  <label className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">
                    Energy Alerts
                  </label>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">
                    Send push notification when energy passes threshold.
                  </p>
                </div>
                <Switch
                  checked={settings.energy_alerts_enabled === 1}
                  onCheckedChange={(checked) =>
                    setSettings((prev) => ({
                      ...prev,
                      energy_alerts_enabled: checked ? 1 : 0,
                    }))
                  }
                />
              </div>

              {/* Energy Soft Threshold Slider */}
              {settings.energy_alerts_enabled === 1 && (
                <div className="space-y-4 border-b border-zinc-100 dark:border-zinc-900 pb-5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-zinc-500 dark:text-zinc-400">
                      Energy Alert Soft Threshold
                    </span>
                    <span className="text-xs font-bold text-amber-500">
                      {settings.energy_soft_threshold} Energy
                    </span>
                  </div>
                  <div className="px-1 py-2">
                    <Slider
                      min={0}
                      max={150}
                      step={5}
                      value={[settings.energy_soft_threshold]}
                      onValueChange={(value) => {
                        const val = Array.isArray(value) ? value[0] : (value as number);
                        setSettings((prev) => ({
                          ...prev,
                          energy_soft_threshold: val || 130,
                        }));
                      }}
                    />
                  </div>
                  <p className="text-[10px] text-zinc-400 dark:text-zinc-500 leading-normal">
                    You&apos;ll receive a push notification when your energy crosses this threshold (up to full energy).
                  </p>
                </div>
              )}

              {/* Drug Alerts Toggle */}
              <div className="flex items-center justify-between border-b border-zinc-100 dark:border-zinc-900 pb-4">
                <div className="space-y-0.5">
                  <label className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">
                    Drug Cooldown Alerts
                  </label>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">
                    Send push notification when drug cooldown hits 0:00.
                  </p>
                </div>
                <Switch
                  checked={settings.drug_alerts_enabled === 1}
                  onCheckedChange={(checked) =>
                    setSettings((prev) => ({
                      ...prev,
                      drug_alerts_enabled: checked ? 1 : 0,
                    }))
                  }
                />
              </div>

              {/* Crime Alerts Toggle */}
              <div className="flex items-center justify-between border-b border-zinc-100 dark:border-zinc-900 pb-4">
                <div className="space-y-0.5">
                  <label className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">
                    Crime & Nerve Alerts
                  </label>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">
                    Send push notification when Nerve passes threshold.
                  </p>
                </div>
                <Switch
                  checked={settings.crime_alerts_enabled === 1}
                  onCheckedChange={(checked) =>
                    setSettings((prev) => ({
                      ...prev,
                      crime_alerts_enabled: checked ? 1 : 0,
                    }))
                  }
                />
              </div>

              {/* Crime Soft Threshold Slider */}
              {settings.crime_alerts_enabled === 1 && (
                <div className="space-y-4 border-b border-zinc-100 dark:border-zinc-900 pb-5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-zinc-500 dark:text-zinc-400">
                      Nerve Alert Soft Threshold
                    </span>
                    <span className="text-xs font-bold text-amber-500">
                      {settings.crime_soft_threshold} Nerve
                    </span>
                  </div>
                  <div className="px-1 py-2">
                    <Slider
                      min={0}
                      max={settings.max_nerve || 100}
                      step={2}
                      value={[settings.crime_soft_threshold]}
                      onValueChange={(value) => {
                        const val = Array.isArray(value) ? value[0] : (value as number);
                        setSettings((prev) => ({
                          ...prev,
                          crime_soft_threshold: val || 15,
                        }));
                      }}
                    />
                  </div>
                  <p className="text-[10px] text-zinc-400 dark:text-zinc-500 leading-normal">
                    You&apos;ll receive a push notification when your nerve crosses this threshold (up to full nerve).
                  </p>
                </div>
              )}

              {/* Aggressive Alert Repeat Interval */}
              {(settings.energy_alerts_enabled === 1 || settings.drug_alerts_enabled === 1 || settings.crime_alerts_enabled === 1) && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <span className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                        Aggressive Alert Repeat Interval
                      </span>
                      <p className="text-[10px] text-zinc-500">
                        How frequently alerts repeat while energy/nerve is full or drug cooldown remains at 0:00.
                      </p>
                    </div>
                    <span className="text-xs font-bold text-amber-500 shrink-0">
                      {settings.energy_aggressive_interval_mins} mins
                    </span>
                  </div>
                  <Input
                    type="number"
                    min="1"
                    max="1440"
                    value={settings.energy_aggressive_interval_mins}
                    onChange={(e) =>
                      setSettings((prev) => ({
                        ...prev,
                        energy_aggressive_interval_mins: parseInt(e.target.value) || 5,
                      }))
                    }
                    className="border-zinc-200 dark:border-zinc-800 focus-visible:ring-amber-500"
                  />
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Footer Actions */}
        <div className="flex justify-end border-t border-zinc-200 dark:border-zinc-900 pt-6">
          <Button
            onClick={handleSave}
            disabled={saving || !isRatioValid}
            className="flex items-center gap-2 px-5 py-2.5 rounded-lg text-xs font-semibold bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-zinc-950 transition cursor-pointer shadow-sm"
          >
            {saving ? (
              <RefreshCw className="h-4 w-4 animate-spin" />
            ) : (
              <Save className="h-4 w-4" />
            )}
            <span>Save Settings</span>
          </Button>
        </div>
      </div>
    </DashboardLayout>
  );
}
