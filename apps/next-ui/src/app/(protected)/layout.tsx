import { ReactNode } from "react";
import { redirect } from "next/navigation";
import { getServerEnv } from "@/lib/server-config";

import { SettingsProvider } from "@/components/settings-provider";

export default async function ProtectedLayout({ children }: { children: ReactNode }) {
  const env = getServerEnv();
  const apiUrl = env.API_URL || env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:3001";
  
  let isConfigured = true;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 1500);

    const configRes = await fetch(`${apiUrl}/api/config`, {
      cache: "no-store",
      signal: controller.signal
    });
    
    clearTimeout(timeoutId);

    if (configRes.ok) {
      const configData = await configRes.json();
      if (!configData.configured) {
        isConfigured = false;
      }
    }
  } catch (err) {
    console.warn("Could not reach API gateway to check config during SSR:", err instanceof Error ? err.message : err);
  }

  if (!isConfigured) {
    redirect("/onboarding");
  }

  return <SettingsProvider>{children}</SettingsProvider>;
}
