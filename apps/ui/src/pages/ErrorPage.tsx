import { useSearchParams } from "react-router-dom";

export default function ErrorPage() {
  const [searchParams] = useSearchParams();
  const message = searchParams.get("msg") || "The requested sector could not be accessed or does not exist.";
  const code = searchParams.get("code") || "404";

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-background text-foreground p-6 text-center bg-[radial-gradient(ellipse_at_top,var(--tw-gradient-stops))] from-primary/5 via-background to-background">
      <div className="max-w-md w-full space-y-10 animate-in fade-in slide-in-from-bottom-4 duration-700">
        <div className="space-y-4">
          <h1 className="text-8xl font-black tracking-tighter text-foreground drop-shadow-2xl opacity-10 font-orbitron absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 -z-10 pointer-events-none">{code}</h1>
          <h2 className="text-4xl font-black text-foreground tracking-tighter uppercase italic">Access Denied</h2>
          <p className="text-muted-foreground/30 font-mono tracking-widest leading-relaxed max-w-sm mx-auto">
            {message}
          </p>
        </div>
      </div>

      <div className="fixed bottom-8 text-muted-foreground/30 text-[10px] font-mono uppercase tracking-[0.3em]">
        Sentinel OS // ERR_{code === "404" ? "ROUTE_NOT_FOUND" : "AUTH_FAILURE"} // TRACE_ID_{Math.random().toString(36).substring(7).toUpperCase()}
      </div>
    </div>
  );
}
