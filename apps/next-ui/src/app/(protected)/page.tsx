import { DashboardClient } from "./DashboardClient";
import { getServerEnv } from "@/lib/server-config";

export const dynamic = "force-dynamic"; // Ensure fresh data on every load

export default async function Home() {
  let initialData = null;
  
  const env = getServerEnv();
  const apiUrl = env.API_URL || env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:3001";

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 1500);

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
