import { DashboardClient } from "./DashboardClient";

export const dynamic = "force-dynamic"; // Ensure fresh data on every load

export default async function Home() {
  let initialData = null;

  try {
    // Attempt to fetch live status from the API Gateway
    const res = await fetch("http://127.0.0.1:3001/api/status", {
      next: { revalidate: 0 }, // No caching, we want real-time gateway status
      signal: AbortSignal.timeout(2000) // 2-second timeout so page doesn't hang if offline
    });
    
    if (res.ok) {
      initialData = await res.json();
    }
  } catch (err) {
    console.warn("Could not reach API gateway on 3001:", err);
  }

  return <DashboardClient initialData={initialData} />;
}
