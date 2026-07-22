import { Agent, setGlobalDispatcher } from "undici";
import CacheableLookup from "cacheable-lookup";
import { Logger } from "@sentinel/shared";

const logger = new Logger("Network");

export function initializeNetworkPipelining(): void {
  logger.warn("Initializing network pipelining & DNS cache...");

  const dnsCache = new CacheableLookup({
    maxTtl: 300, // Cache DNS records for at most 5 minutes
  });

  const globalAgent = new Agent({
    pipelining: 1, // Enable socket reuse without head-of-line blocking pipelining
    connections: 100, // Max active connections per origin
    keepAliveTimeout: 10 * 60 * 1000, // Keep connections open for 10 minutes of inactivity
    connect: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      lookup: dnsCache.lookup as any,
    },
  });

  setGlobalDispatcher(globalAgent);
  logger.info("Network pipelining & DNS cache successfully initialized.");
}
