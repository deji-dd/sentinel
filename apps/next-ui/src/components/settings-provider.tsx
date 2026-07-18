"use client";

import React, { createContext, useContext, useEffect, useState } from "react";

type Settings = {
  log_manager_enabled: boolean;
  log_manager_cadence: number;
  crimes_module_enabled: boolean;
  gym_module_enabled: boolean;
};

const defaultSettings: Settings = {
  log_manager_enabled: true, // Default true to prevent flash of disabled state if enabled
  log_manager_cadence: 60,
  crimes_module_enabled: false,
  gym_module_enabled: false,
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
    fetch("/api/settings", { cache: "no-store" })
      .then((res) => res.json())
      .then((data) => {
        if (data) {
          setSettings({
            log_manager_enabled: data.log_manager_enabled ?? false,
            log_manager_cadence: data.log_manager_cadence ?? 60,
            crimes_module_enabled: data.crimes_module_enabled ?? false,
            gym_module_enabled: data.gym_module_enabled ?? false,
          });
        }
      })
      .catch(console.error)
      .finally(() => setIsLoading(false));
  }, []);

  return (
    <SettingsContext.Provider value={{ settings, setSettings, isLoading }}>
      {children}
    </SettingsContext.Provider>
  );
}

export const useSettings = () => useContext(SettingsContext);
