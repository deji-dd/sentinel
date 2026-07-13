"use client";

import React, { useEffect, useState } from "react";
import { DashboardLayout } from "@/components/dashboard-layout";
import { Card, CardContent } from "@/components/ui/card";
import { usePush } from "@/hooks/use-push";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Bell, BellOff, Settings, Zap, Target, Activity } from "lucide-react";
import { toast } from "sonner";
import GlobalLoading from "@/components/dashboard/GlobalLoading";
import { useMinimumLoading } from "@/hooks/use-minimum-loading";

export default function SettingsPage() {
  const { subscribed, loading, toggle } = usePush();
  const [preferences, setPreferences] = useState({
    energy_full: false,
    nerve_full: false,
    bazaar_sales: false,
    territory_changes: false,
  });

  const [isLoadingPreferences, setIsLoadingPreferences] = useState(true);
  const showLoader = useMinimumLoading(loading || isLoadingPreferences, 2000);

  // Fetch initial preferences from backend
  useEffect(() => {
    const fetchPreferences = async () => {
      try {
        const res = await fetch("/api/settings/preferences");
        if (res.ok) {
          const data = await res.json();
          if (data && data.preferences) {
            setPreferences(data.preferences);
          }
        }
      } catch (err) {
        console.error("Failed to fetch preferences:", err);
      } finally {
        setIsLoadingPreferences(false);
      }
    };
    fetchPreferences();
  }, []);

  const handlePreferenceChange = async (key: keyof typeof preferences, checked: boolean) => {
    const newPreferences = { ...preferences, [key]: checked };
    setPreferences(newPreferences);

    try {
      const res = await fetch("/api/settings/preferences", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(newPreferences),
      });

      if (!res.ok) throw new Error("Failed to save preferences");
      toast.success("Preferences updated");
    } catch (err) {
      console.error(err);
      toast.error("Failed to update preferences");
      // Revert on failure
      setPreferences(preferences);
    }
  };

  if (showLoader) {
    return (
      <DashboardLayout>
        <GlobalLoading />
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="p-8 max-w-4xl mx-auto min-h-screen pt-20">
        <div className="flex items-center gap-4 mb-12">
          <div className="dashboard-title">
            <h1 className="text-4xl font-black tracking-tighter text-zinc-900 dark:text-zinc-50 flex items-center gap-3">
              <Settings className="w-10 h-10" />
              Settings
            </h1>
            <p className="text-zinc-500 dark:text-zinc-400 mt-2">
              Manage your notifications and system preferences.
            </p>
          </div>
        </div>

        <div className="space-y-8">
          {/* Push Notifications Card */}
          <Card>
            <CardContent className="p-6">
              <div className="flex items-center gap-3 mb-6">
                <div className="p-2 bg-indigo-500/20 text-indigo-400 rounded-lg">
                  {subscribed ? <Bell size={24} /> : <BellOff size={24} />}
                </div>
                <div>
                  <h2 className="text-xl font-bold">Push Notifications</h2>
                  <p className="text-sm text-zinc-400">Receive real-time alerts even when the app is closed.</p>
                </div>
              </div>

              <div className="flex items-center justify-between p-6 bg-white/5 dark:bg-black/20 rounded-xl border border-zinc-200 dark:border-white/5">
                <div>
                  <p className="font-semibold text-zinc-900 dark:text-zinc-100">Status</p>
                  <p className="text-sm text-zinc-500 flex items-center gap-2 mt-1">
                    <span className="relative flex h-2 w-2">
                      {subscribed && <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>}
                      <span className={`relative inline-flex rounded-full h-2 w-2 ${subscribed ? 'bg-emerald-500' : 'bg-zinc-500'}`}></span>
                    </span>
                    {subscribed ? "Active" : "Inactive"}
                  </p>
                </div>
                <Button
                  onClick={toggle}
                  disabled={loading}
                  className={subscribed ? "bg-red-500 hover:bg-red-600 text-white" : "bg-indigo-500 hover:bg-indigo-600 text-white"}
                >
                  {loading
                    ? "Loading..."
                    : subscribed
                      ? "Disable Notifications"
                      : "Enable Notifications"}
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Preferences Card */}
          <Card>
            <CardContent className="p-6">
              <div className="flex items-center gap-3 mb-6">
                <div className="p-2 bg-emerald-500/20 text-emerald-400 rounded-lg">
                  <Target size={24} />
                </div>
                <div>
                  <h2 className="text-xl font-bold">Alert Preferences</h2>
                  <p className="text-sm text-zinc-400">Select which events you want to be notified about.</p>
                </div>
              </div>

              <div className="space-y-4">
                {[
                  {
                    id: "energy_full",
                    title: "Energy Full",
                    description: "Get notified when your energy reaches maximum capacity.",
                    icon: <Zap className="w-5 h-5 text-amber-500" />
                  },
                  {
                    id: "nerve_full",
                    title: "Nerve Full",
                    description: "Get notified when your nerve reaches maximum capacity.",
                    icon: <Activity className="w-5 h-5 text-rose-500" />
                  },
                  {
                    id: "bazaar_sales",
                    title: "Bazaar Sales",
                    description: "Get notified immediately when an item sells in your bazaar.",
                    icon: <span className="text-xl">🏪</span>
                  },
                  {
                    id: "territory_changes",
                    title: "Territory Changes",
                    description: "Get notified about relevant faction territory events.",
                    icon: <span className="text-xl">🗺️</span>
                  }
                ].map((item) => (
                  <div key={item.id} className="flex items-center justify-between p-4 bg-white/5 dark:bg-black/20 rounded-xl border border-zinc-200 dark:border-white/5 transition-colors hover:bg-white/10 dark:hover:bg-white/5">
                    <div className="flex items-center gap-4">
                      <div className="p-2 bg-white/10 dark:bg-white/5 rounded-lg shadow-sm">
                        {item.icon}
                      </div>
                      <div>
                        <h3 className="font-semibold text-zinc-900 dark:text-zinc-100">{item.title}</h3>
                        <p className="text-sm text-zinc-500">{item.description}</p>
                      </div>
                    </div>
                    <Switch
                      checked={preferences[item.id as keyof typeof preferences]}
                      onCheckedChange={(checked) => handlePreferenceChange(item.id as keyof typeof preferences, checked)}
                      disabled={isLoadingPreferences || !subscribed}
                    />
                  </div>
                ))}
                {!subscribed && (
                  <p className="text-sm text-amber-500/80 mt-4 px-2">
                    * You must enable Push Notifications above before toggling these preferences.
                  </p>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </DashboardLayout>
  );
}
