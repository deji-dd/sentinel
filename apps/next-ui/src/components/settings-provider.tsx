"use client";

import React, { createContext, useContext, useEffect, useState } from "react";

type Settings = {
  log_manager_enabled: boolean;
  log_manager_cadence: number;
  crimes_module_enabled: boolean;
  gym_module_enabled: boolean;
  stocks_module_enabled: boolean;
  travel_module_enabled: boolean;
  wealth_module_enabled: boolean;
  travel_capacity: number;
  travel_method: string;
};

const defaultSettings: Settings = {
  log_manager_enabled: true, // Default true to prevent flash of disabled state if enabled
  log_manager_cadence: 60,
  crimes_module_enabled: false,
  gym_module_enabled: false,
  stocks_module_enabled: false,
  travel_module_enabled: false,
  wealth_module_enabled: false,
  travel_capacity: 15,
  travel_method: "1.0", // Standard
};

type SettingsContextType = {
  settings: Settings;
  setSettings: (settings: Settings) => void;
  isLoading: boolean;
};

const SettingsContext = createContext<SettingsContextType>({
  settings: defaultSettings,
  setSettings: () => {},
  isLoading: true,
});

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const [settings, setSettings] = useState<Settings>(defaultSettings);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;

    const fetchSettings = async (retries = 5, delay = 500) => {
      try {
        const res = await fetch("/api/settings", { cache: "no-store" });
        if (!res.ok) throw new Error("Failed to fetch settings");
        const data = await res.json();
        
        if (data && isMounted) {
          setSettings({
            log_manager_enabled: data.log_manager_enabled ?? false,
            log_manager_cadence: data.log_manager_cadence ?? 60,
            crimes_module_enabled: data.crimes_module_enabled ?? false,
            gym_module_enabled: data.gym_module_enabled ?? false,
            stocks_module_enabled: data.stocks_module_enabled ?? false,
            travel_module_enabled: data.travel_module_enabled ?? false,
            wealth_module_enabled: data.wealth_module_enabled ?? false,
            travel_capacity: data.travel_capacity ?? 15,
            travel_method: data.travel_method ?? "1.0",
          });
          setIsLoading(false);
        }
      } catch (err) {
        if (retries > 0 && isMounted) {
          setTimeout(() => fetchSettings(retries - 1, delay * 1.5), delay);
        } else if (isMounted) {
          console.error("Exhausted retries fetching settings:", err);
          setIsLoading(false);
        }
      }
    };

    fetchSettings();

    return () => {
      isMounted = false;
    };
  }, []);

  return (
    <SettingsContext.Provider value={{ settings, setSettings, isLoading }}>
      {children}
    </SettingsContext.Provider>
  );
}

export const useSettings = () => useContext(SettingsContext);
