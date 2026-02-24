import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkSchema() {
  // Check if the table has any rows with api_key_hash
  const { data, error } = await supabase
    .from("sentinel_system_api_keys")
    .select("id, api_key_hash, user_id, key_type, created_at")
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(5);

  if (error) {
    console.error("Query error:", error);
  } else {
    console.log(`\nFound ${data?.length || 0} active keys in cloud database:`);
    console.log(JSON.stringify(data, null, 2));

    // Check for null api_key_hash values
    const nullHashes = data?.filter((row) => !row.api_key_hash) || [];
    if (nullHashes.length > 0) {
      console.log(
        `\n⚠️  WARNING: ${nullHashes.length} keys have NULL api_key_hash!`,
      );
      console.log(
        "The unique index won't work until these are populated or deleted.",
      );
    }
  }
}

checkSchema().catch(console.error);
