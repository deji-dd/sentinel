import { createClient } from "@/lib/supabase-server";
import { redirect } from "next/navigation";

/**
 * Helper function to ensure user is authenticated in Server Components
 * Redirects to login if not authenticated
 */
export async function requireAuth() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  return { supabase, user };
}

/**
 * Helper function to get user if authenticated, returns null otherwise
 */
export async function getAuthUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return user;
}

/**
 * Example: Use in a Server Component
 *
 * import { requireAuth } from '@/lib/auth-helpers';
 *
 * export default async function ProtectedPage() {
 *   const { user } = await requireAuth();
 *
 *   return <div>Welcome, {user.email}!</div>;
 * }
 */
