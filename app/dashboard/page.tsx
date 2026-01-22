import { requireAuth } from "@/lib/auth-helpers";
import { createClient } from "@/lib/supabase-server";
import { redirect } from "next/navigation";

async function handleLogout() {
  "use server";
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/");
}

export default async function DashboardPage() {
  const { user } = await requireAuth();

  return (
    <div className="min-h-screen bg-black">
      <nav className="border-b border-white/10 bg-zinc-950/50 backdrop-blur">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center justify-between">
            <h1 className="text-2xl font-bold text-white">
              Sentinel Dashboard
            </h1>
            <form action={handleLogout}>
              <button
                type="submit"
                className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors"
              >
                Logout
              </button>
            </form>
          </div>
        </div>
      </nav>

      <main className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-12">
        <div className="bg-zinc-950/70 border border-white/10 rounded-lg p-8">
          <h2 className="text-xl font-semibold text-white mb-4">
            Welcome Back
          </h2>
          <p className="text-zinc-400 mb-4">
            Email: <span className="text-white font-mono">{user.email}</span>
          </p>
          <p className="text-zinc-400 mb-4">
            User ID:{" "}
            <span className="text-white font-mono text-sm">{user.id}</span>
          </p>
          <p className="text-zinc-500 text-sm">
            This is a protected route. Only authenticated users can see this
            page.
          </p>
        </div>
      </main>
    </div>
  );
}
