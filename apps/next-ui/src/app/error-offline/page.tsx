import { Metadata } from "next";
import { ThemeToggle } from "@/components/theme-toggle";

export const metadata: Metadata = {
  title: "System Offline | Sentinel",
};

export default function ErrorOfflinePage() {
  return (
    <div className="h-dvh w-screen overflow-hidden bg-background text-foreground flex items-center justify-center p-4 selection:bg-foreground/20 selection:text-foreground">
      <div className="absolute top-4 right-4 md:top-8 md:right-8 z-50">
        <ThemeToggle />
      </div>
      
      <main className="w-full max-w-lg mx-auto flex flex-col items-center text-center space-y-12">
        <div className="flex flex-col items-center space-y-3">
          <h1 className="text-xs font-medium uppercase tracking-[0.4em] text-muted-foreground">
            Sentinel System
          </h1>
          <p className="text-[10px] text-muted-foreground font-mono tracking-widest">
            CONNECTION_REFUSED
          </p>
        </div>

        <div className="border border-border w-full p-8 space-y-6 bg-card/50 backdrop-blur-sm shadow-sm rounded-sm">
          <div className="flex items-center justify-center gap-3">
            <span className="inline-block w-2 h-2 bg-red-500 animate-pulse rounded-full" />
            <span className="text-[10px] font-mono uppercase tracking-[0.2em] text-muted-foreground">
              API_GATEWAY_UNREACHABLE
            </span>
          </div>

          <p className="text-sm font-mono text-muted-foreground leading-relaxed">
            The Sentinel API Gateway is not responding. This usually means the
            backend services on your cloud instance are offline or restarting.
          </p>

          <div className="border-t border-border pt-6 space-y-2">
            <p className="text-[10px] font-mono uppercase tracking-[0.2em] text-muted-foreground">
              RECOMMENDED_ACTIONS
            </p>
            <ul className="text-xs font-mono text-muted-foreground space-y-1 text-left pl-4">
              <li>• Verify API process is running on GCP</li>
              <li>• Check Cloudflare Tunnel status</li>
              <li>• Review PM2 process logs</li>
            </ul>
          </div>

          {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- Full reload intentional to re-trigger proxy.ts */}
          <a
            href="/"
            className="inline-block w-full border border-border py-3 text-[10px] font-mono uppercase tracking-[0.2em] text-muted-foreground hover:text-foreground hover:border-foreground/50 transition-colors text-center rounded-sm hover:bg-accent"
          >
            RETRY_CONNECTION
          </a>
        </div>

        <p className="text-[10px] font-mono text-muted-foreground/60 tracking-widest">
          SYS_ERR_502
        </p>
      </main>
    </div>
  );
}
