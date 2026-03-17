import { ShieldAlert } from "lucide-react";

export default function ErrorPage() {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-background text-foreground p-6 text-center bg-[radial-gradient(ellipse_at_top,var(--tw-gradient-stops))] from-primary/5 via-background to-background">
      <div className="max-w-md w-full space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
        <div className="flex justify-center">
          <div className="w-24 h-24 bg-destructive/10 border border-destructive/20 rounded-3xl flex items-center justify-center shadow-2xl shadow-destructive/10">
            <ShieldAlert className="w-12 h-12 text-destructive" />
          </div>
        </div>

        <div className="space-y-2">
          <h1 className="text-6xl font-black tracking-tighter text-foreground drop-shadow-sm">404</h1>
          <h2 className="text-2xl font-bold text-foreground tracking-tight">Access Denied</h2>

        </div>
      </div>

      <div className="fixed bottom-8 text-muted-foreground/30 text-[10px] font-mono uppercase tracking-[0.3em]">
        Sentinel OS // ERR_ROUTE_NOT_FOUND // TRACE_ID_{Math.random().toString(36).substring(7).toUpperCase()}
      </div>
    </div>
  );
}
