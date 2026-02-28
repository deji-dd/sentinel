import { supabase } from "../lib/supabase.js";
import { decryptApiKey, hashApiKey } from "@sentinel/shared";

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY;
const API_KEY_HASH_PEPPER = process.env.API_KEY_HASH_PEPPER;

if (!ENCRYPTION_KEY || !API_KEY_HASH_PEPPER) {
  throw new Error("ENCRYPTION_KEY and API_KEY_HASH_PEPPER are required");
}

// Type-safe after validation
const encryptionKey = ENCRYPTION_KEY as string;
const apiKeyHashPepper = API_KEY_HASH_PEPPER as string;

interface SystemKeyRow {
  id: string;
  api_key_encrypted: string;
  created_at: string;
}

async function run(): Promise<void> {
  const { data, error } = await supabase
    .from("sentinel_system_api_keys")
    .select("id, api_key_encrypted, created_at")
    .is("deleted_at", null);

  if (error) {
    throw error;
  }

  const rows = (data || []) as SystemKeyRow[];
  if (!rows.length) {
    console.log("No active system keys found.");
    return;
  }

  const byHash = new Map<string, SystemKeyRow[]>();
  for (const row of rows) {
    const decrypted = decryptApiKey(row.api_key_encrypted, encryptionKey);
    const hash = hashApiKey(decrypted, apiKeyHashPepper);
    if (!byHash.has(hash)) {
      byHash.set(hash, []);
    }
    byHash.get(hash)?.push(row);
  }

  let removed = 0;
  let updated = 0;

  for (const [hash, entries] of byHash.entries()) {
    const sorted = entries
      .slice()
      .sort((a, b) => a.created_at.localeCompare(b.created_at));

    const keep = sorted[0];
    const duplicates = sorted.slice(1);

    const { error: updateError } = await supabase
      .from("sentinel_system_api_keys")
      .update({ api_key_hash: hash })
      .eq("id", keep.id);

    if (updateError) {
      throw updateError;
    }

    updated += 1;

    if (duplicates.length > 0) {
      const duplicateIds = duplicates.map((entry) => entry.id);
      const { error: deleteError } = await supabase
        .from("sentinel_system_api_keys")
        .update({ deleted_at: new Date().toISOString() })
        .in("id", duplicateIds);

      if (deleteError) {
        throw deleteError;
      }

      removed += duplicateIds.length;
    }
  }

  console.log(`Updated ${updated} key hash entries.`);
  console.log(`Soft-deleted ${removed} duplicate entries.`);
}

run().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[DedupeSystemKeys] ${message}`);
  process.exit(1);
});
