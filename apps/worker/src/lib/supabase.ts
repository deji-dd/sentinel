import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!supabaseUrl || !supabaseServiceKey) {
  throw new Error(
    "NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY environment variables are required",
  );
}

export const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

export interface UserKey {
  id: string;
  user_id: string;
  api_key: string; // encrypted
  created_at: string;
}

export interface UserData {
  user_id: string;
  name: string | null;
  player_id: number | null;
  updated_at?: string;
}

export async function getUserKeys(): Promise<UserKey[]> {
  const { data, error } = await supabase
    .from("user_keys")
    .select("*")
    .returns<UserKey[]>();

  if (error) {
    throw new Error(`Failed to fetch user keys: ${error.message}`);
  }

  return data || [];
}

export async function upsertUserData(data: UserData[]): Promise<void> {
  const { error } = await supabase.from("user_data").upsert(data, {
    onConflict: "user_id",
  });

  if (error) {
    throw new Error(`Failed to upsert user data: ${error.message}`);
  }
}
