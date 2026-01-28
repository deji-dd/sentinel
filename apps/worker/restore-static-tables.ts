#!/usr/bin/env tsx
import { createClient } from "@supabase/supabase-js";

// Cloud database credentials
const cloudUrl = process.env.SUPABASE_URL!;
const cloudKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

// Local database credentials
const localUrl = process.env.SUPABASE_URL_LOCAL || "http://127.0.0.1:54321";
const localKey = process.env.SUPABASE_SERVICE_ROLE_KEY_LOCAL!;

const cloudDb = createClient(cloudUrl, cloudKey);
const localDb = createClient(localUrl, localKey);

async function restoreStaticTables() {
  console.log("Restoring static tables from cloud to local...\n");

  // Fetch destinations from cloud
  const { data: destinations } = await cloudDb
    .from("sentinel_torn_destinations")
    .select("*");

  if (destinations && destinations.length > 0) {
    console.log(`Restoring ${destinations.length} destinations...`);
    const { error: destError } = await localDb
      .from("sentinel_torn_destinations")
      .insert(destinations);

    if (destError) {
      console.error("Error inserting destinations:", destError);
    } else {
      console.log("✓ Destinations restored");
    }
  }

  // Fetch travel times from cloud
  const { data: travelTimes } = await cloudDb
    .from("sentinel_destination_travel_times")
    .select("*");

  if (travelTimes && travelTimes.length > 0) {
    console.log(`Restoring ${travelTimes.length} travel times...`);
    const { error: timesError } = await localDb
      .from("sentinel_destination_travel_times")
      .insert(travelTimes);

    if (timesError) {
      console.error("Error inserting travel times:", timesError);
    } else {
      console.log("✓ Travel times restored");
    }
  }

  console.log("\nDone!");
}

restoreStaticTables().catch(console.error);
