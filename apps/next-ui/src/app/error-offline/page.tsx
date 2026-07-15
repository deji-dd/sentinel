import { Metadata } from "next";

export const metadata: Metadata = {
  title: "System Offline | Sentinel",
};

export default function ErrorOfflinePage() {
  return (
    <div className="h-dvh w-screen overflow-hidden bg-black text-white flex items-center justify-center p-4 selection:bg-white/20 selection:text-white">
      <main className="w-full max-w-lg mx-auto flex flex-col items-center text-center space-y-12">
        <div className="flex flex-col items-center space-y-3">
          <h1 className="text-xs font-medium uppercase tracking-[0.4em] text-neutral-400">
            Sentinel System
          </h1>
          <p className="text-[10px] text-neutral-600 font-mono tracking-widest">
            CONNECTION_REFUSED
          </p>
        </div>

        <div className="border border-neutral-900 w-full p-8 space-y-6">
          <div className="flex items-center justify-center gap-3">
            <span className="inline-block w-2 h-2 bg-red-500 animate-pulse" />
            <span className="text-[10px] font-mono uppercase tracking-[0.2em] text-neutral-500">
              API_GATEWAY_UNREACHABLE
            </span>
          </div>

          <p className="text-sm font-mono text-neutral-400 leading-relaxed">
            The Sentinel API Gateway is not responding. This usually means the
            backend services on your cloud instance are offline or restarting.
          </p>

          <div className="border-t border-neutral-900 pt-6 space-y-2">
            <p className="text-[10px] font-mono uppercase tracking-[0.2em] text-neutral-600">
              RECOMMENDED_ACTIONS
            </p>
            <ul className="text-xs font-mono text-neutral-500 space-y-1 text-left pl-4">
              <li>• Verify API process is running on GCP</li>
              <li>• Check Cloudflare Tunnel status</li>
              <li>• Review PM2 process logs</li>
            </ul>
          </div>

          {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- Full reload intentional to re-trigger proxy.ts */}
          <a
            href="/"
            className="inline-block w-full border border-neutral-800 py-3 text-[10px] font-mono uppercase tracking-[0.2em] text-neutral-400 hover:text-white hover:border-neutral-600 transition-colors text-center"
          >
            RETRY_CONNECTION
          </a>
        </div>

        <p className="text-[10px] font-mono text-neutral-700 tracking-widest">
          SYS_ERR_502
        </p>
      </main>
    </div>
  );
}
