import { Agent, setGlobalDispatcher } from "undici";
import CacheableLookup from "cacheable-lookup";
import { Logger } from "@sentinel/utils";

const logger = new Logger("Network");

/**
 * Initializes global undici agent dispatcher with DNS caching and HTTP socket keep-alive
 * to minimize latency on frequent Torn API requests.
 */
export function initializeNetworkOptimization(): void {
  logger.info("Initializing network socket reuse & DNS cache...");

  const dnsCache = new CacheableLookup({
    maxTtl: 300, // Cache DNS records for at most 5 minutes
  });

  const globalAgent = new Agent({
    pipelining: 1, // Enable socket reuse without head-of-line blocking
    connections: 25, // Max active connections per origin
    keepAliveTimeout: 60 * 1000, // 1 minute keep-alive
    connect: {
      lookup: dnsCache.lookup as any,
    },
  });

  setGlobalDispatcher(globalAgent);
  logger.info("Network optimization & DNS cache initialized.");
}
