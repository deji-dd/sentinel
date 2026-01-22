import { requireAuth } from "@/lib/auth-helpers";

export default async function DashboardPage() {
  const { user } = await requireAuth();

  return (
    <div className="space-y-6">
      <div className="bg-zinc-950/70 border border-white/10 rounded-lg p-8">
        <h2 className="text-xl font-semibold text-white mb-4">Welcome Back</h2>
        <p className="text-zinc-400 mb-4">
          Email: <span className="text-white font-mono">{user.email}</span>
        </p>
        <p className="text-zinc-400 mb-4">
          User ID:{" "}
          <span className="text-white font-mono text-sm">{user.id}</span>
        </p>
        <p className="text-zinc-500 text-sm">
          This is a protected route. Only authenticated users can see this page.
        </p>
      </div>
    </div>
  );
}
