import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL_LOCAL || "http://127.0.0.1:54321";
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY_LOCAL!;

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function checkWorkers() {
  console.log("=== Checking workers ===\n");

  // Check all workers
  const { data: workers } = await supabase
    .from("sentinel_workers")
    .select("*")
    .order("name");

  console.log("All workers:");
  workers?.forEach((w) => console.log(`  ${w.name} (id: ${w.id})`));

  // Get worker ID
  const worker = workers?.find(
    (w) => w.name === "travel_recommendations_worker",
  );
  if (!worker) {
    console.log("\n❌ Worker 'travel_recommendations_worker' not found!");
    return;
  }

  console.log(`\n✓ Found worker: ${worker.name} (id: ${worker.id})`);

  // Check schedule
  const { data: schedule } = await supabase
    .from("sentinel_worker_schedules")
    .select("*")
    .eq("worker_id", worker.id)
    .single();

  console.log("\nSchedule:");
  console.log(schedule);

  // Check logs
  const { data: logs } = await supabase
    .from("sentinel_worker_logs")
    .select("*")
    .eq("worker_id", worker.id)
    .order("created_at", { ascending: false })
    .limit(5);

  console.log("\nRecent logs (with raw data):");
  logs?.forEach((log) => {
    console.log(JSON.stringify(log, null, 2));
  });
}

checkWorkers().catch(console.error);
