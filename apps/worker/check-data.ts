import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("Missing env vars");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function checkData() {
  console.log("=== Checking database state ===\n");

  // Check users
  const { data: users } = await supabase
    .from("sentinel_users")
    .select("user_id, api_key")
    .limit(5);
  console.log(`Users with data: ${users?.length || 0}`);
  users?.forEach((u) =>
    console.log(`  ${u.user_id}: ${u.api_key ? "has key" : "NO KEY"}`),
  );

  // Check travel data
  const { data: travelData } = await supabase
    .from("sentinel_travel_data")
    .select(
      "user_id, capacity, travel_time_left, has_airstrip, has_wlt_benefit",
    )
    .limit(5);
  console.log(`\nTravel data: ${travelData?.length || 0}`);
  travelData?.forEach((t) =>
    console.log(
      `  ${t.user_id}: capacity=${t.capacity}, travel_time_left=${t.travel_time_left}, airstrip=${t.has_airstrip}, wlt=${t.has_wlt_benefit}`,
    ),
  );

  // Check user bars
  const { data: bars } = await supabase
    .from("sentinel_user_bars")
    .select("user_id, energy_flat_time_to_full, nerve_flat_time_to_full")
    .limit(5);
  console.log(`\nUser bars: ${bars?.length || 0}`);
  bars?.forEach((b) =>
    console.log(
      `  ${b.user_id}: energy_flat_ttf=${b.energy_flat_time_to_full}s, nerve_flat_ttf=${b.nerve_flat_time_to_full}s`,
    ),
  );

  // Check cooldowns
  const { data: cooldowns } = await supabase
    .from("sentinel_user_cooldowns")
    .select("user_id, drug, medical, booster")
    .limit(5);
  console.log(`\nUser cooldowns: ${cooldowns?.length || 0}`);
  cooldowns?.forEach((c) =>
    console.log(
      `  ${c.user_id}: drug=${c.drug}s, medical=${c.medical}s, booster=${c.booster}s`,
    ),
  );

  // Check destinations
  const { data: dests } = await supabase
    .from("sentinel_torn_destinations")
    .select("id, name, country_code");
  console.log(`\nDestinations: ${dests?.length || 0}`);
  dests?.forEach((d) =>
    console.log(`  ${d.id}: ${d.name} (${d.country_code})`),
  );

  // Check travel times
  const { data: times } = await supabase
    .from("sentinel_destination_travel_times")
    .select("destination_id, standard, airstrip, wlt");
  console.log(`\nTravel times: ${times?.length || 0}`);
  times
    ?.slice(0, 3)
    .forEach((t) =>
      console.log(
        `  dest_id=${t.destination_id}: standard=${t.standard}m, airstrip=${t.airstrip}m, wlt=${t.wlt}m`,
      ),
    );

  // Check stock cache
  const { data: stock } = await supabase
    .from("sentinel_travel_stock_cache")
    .select("destination_id, item_id, quantity, cost, last_updated")
    .limit(10);
  console.log(`\nStock cache rows: ${stock?.length || 0}`);
  stock?.forEach((s) =>
    console.log(
      `  dest=${s.destination_id}, item=${s.item_id}, qty=${s.quantity}, cost=${s.cost}, updated=${new Date(s.last_updated).toISOString().slice(11, 19)}`,
    ),
  );

  // Check torn items
  const { data: items } = await supabase
    .from("sentinel_torn_items")
    .select("item_id, name")
    .limit(5);
  console.log(`\nTorn items: ${items?.length || 0}`);
  items?.forEach((i) => console.log(`  ${i.item_id}: ${i.name}`));

  // Check recommendations (existing)
  const { data: recs } = await supabase
    .from("sentinel_travel_recommendations")
    .select("user_id, destination_id, best_item_id, profit_per_minute")
    .limit(5);
  console.log(`\nExisting recommendations: ${recs?.length || 0}`);
  recs?.forEach((r) =>
    console.log(
      `  user=${r.user_id}, dest=${r.destination_id}, item=${r.best_item_id}, profit/min=${r.profit_per_minute}`,
    ),
  );

  // Check worker registration
  const { data: worker } = await supabase
    .from("sentinel_workers")
    .select("id, name")
    .eq("name", "travel_recommendations_worker");
  console.log(
    `\nTravel recommendations worker: ${worker?.[0]?.id || "NOT REGISTERED"}`,
  );

  if (worker?.[0]?.id) {
    const { data: schedule } = await supabase
      .from("sentinel_worker_schedules")
      .select("worker_id, enabled, cadence_seconds, next_run_at, force_run")
      .eq("worker_id", worker[0].id);
    console.log(
      `  enabled=${schedule?.[0]?.enabled}, cadence=${schedule?.[0]?.cadence_seconds}s, force_run=${schedule?.[0]?.force_run}`,
    );
  }
}

checkData().catch(console.error);
