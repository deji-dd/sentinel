import { Agent, setGlobalDispatcher } from "undici";
import CacheableLookup from "cacheable-lookup";

export function initializeNetworkPipelining(): void {
  console.log("[Network] Initializing network pipelining & DNS cache...");

  const dnsCache = new CacheableLookup({
    maxTtl: 300, // Cache DNS records for at most 5 minutes
  });

  const globalAgent = new Agent({
    pipelining: 1,                 // Enable socket reuse without head-of-line blocking pipelining
    connections: 100,             // Max active connections per origin
    keepAliveTimeout: 10 * 60 * 1000, // Keep connections open for 10 minutes of inactivity
    connect: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      lookup: dnsCache.lookup as any,
    },
  });

  setGlobalDispatcher(globalAgent);
  console.log("[Network] Network pipelining & DNS cache successfully initialized.");
}
