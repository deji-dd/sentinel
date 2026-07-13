import { DashboardClient } from "./DashboardClient";
import { getServerEnv } from "@/lib/server-config";

export const dynamic = "force-dynamic"; // Ensure fresh data on every load

export default async function Home() {
  let initialData = null;

  try {
    const env = getServerEnv();
    const apiUrl = env.API_URL || env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:3001";
    
    // Add a fast timeout so SSR doesn't hang if the API is offline
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 1500);

    // Attempt to fetch live status from the API Gateway
    const res = await fetch(`${apiUrl}/api/status`, {
      cache: "no-store",
      signal: controller.signal
    });
    
    clearTimeout(timeoutId);

    if (res.ok) {
      initialData = await res.json();
    }
  } catch (err) {
    console.warn("Could not reach API gateway during SSR:", err instanceof Error ? err.message : err);
  }

  return <DashboardClient initialData={initialData} />;
}
