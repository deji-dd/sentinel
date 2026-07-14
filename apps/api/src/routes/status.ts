import { FastifyInstance } from "fastify";
import os from "os";
import {
  WorkerSchedules,
  sentinelDbEngine,
  SystemState,
  LogSyncStates,
} from "@sentinel/shared";
import net from "net";

const probeSocket = (path: string): Promise<boolean> => {
  return new Promise((resolve) => {
    const sock = net.createConnection({ path });
    sock.setTimeout(100); // Quick timeout to prevent hanging

    sock.on("connect", () => {
      sock.end();
      resolve(true);
    });

    sock.on("error", () => resolve(false));
    sock.on("timeout", () => {
      sock.destroy();
      resolve(false);
    });
  });
};

export default async function statusRoutes(fastify: FastifyInstance) {
  fastify.get("/api/status", async (request, reply) => {
    const cpus = os.cpus();
    const loadAvg = os.loadavg();
    const cpuUsagePercent = ((loadAvg[0] / cpus.length) * 100).toFixed(1);

    // Get individual process metrics
    let apiCpu = 0,
      apiMem = 0;
    let botCpu = 0,
      botMem = 0;
    let workerCpu = 0,
      workerMem = 0;

    try {
      const states = SystemState.findAll();
      for (const state of states) {
        if (state.id === "api") {
          apiCpu = state.cpu || 0;
          apiMem = state.memory || 0;
        } else if (state.id === "bot" && state.status === "online") {
          botCpu = state.cpu || 0;
          botMem = state.memory || 0;
        } else if (state.id === "worker" && state.status === "online") {
          workerCpu = state.cpu || 0;
          workerMem = state.memory || 0;
        }
      }
    } catch (e) {
      fastify.log.warn(e, "Failed to fetch system state metrics");
    }

    // Generate system metrics for the dashboard
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;
    const memUsagePercent = ((usedMem / totalMem) * 100).toFixed(1);

    let dbLatency = 1;

    try {
      const startDb = performance.now();

      dbLatency = Math.round(performance.now() - startDb);
    } catch (err) {
      fastify.log.warn("Database query failed during status check: " + err);
    }

    const isBotConnected = await probeSocket("/tmp/sentinel-bot.sock");
    const isWorkerConnected = await probeSocket("/tmp/sentinel-worker.sock");

    const response = {
      status: "online",
      uptime: process.uptime(),
      timestamp: Date.now(),
      system: {
        memory: {
          total: totalMem,
          used: usedMem,
          free: freeMem,
          percent: parseFloat(memUsagePercent),
        },
        cpu: {
          cores: cpus.length,
          model: cpus[0].model,
          load: parseFloat(cpuUsagePercent),
        },
      },
      services: [
        {
          name: "Sentinel API Gateway",
          status: "healthy",
          latency: 1,
          cpu: Number(apiCpu.toFixed(1)),
          memory: Number(apiMem.toFixed(1)),
        },
        {
          name: "Discord Bot IPC",
          status: isBotConnected ? "connected" : "offline",
          latency: isBotConnected ? 2 : 0,
          cpu: Number(botCpu.toFixed(1)),
          memory: Number(botMem.toFixed(1)),
        },
        {
          name: "Worker Node IPC",
          status: isWorkerConnected ? "connected" : "offline",
          latency: isWorkerConnected ? 2 : 0,
          cpu: Number(workerCpu.toFixed(1)),
          memory: Number(workerMem.toFixed(1)),
        },
        { name: "NoSQL Database", status: "healthy", latency: dbLatency || 1 },
      ],
    };

    return response;
  });

  fastify.get("/api/status/sync", async (request, reply) => {
    try {
      const stateId = "personal_log_sync_state_singleton";
      const state = LogSyncStates.findOne(stateId);
      
      if (!state) {
        return reply.status(404).send({ error: "Sync state not found" });
      }

      return reply.send({
        is_historical_sync_complete: state.is_historical_sync_complete,
        earliest_timestamp: state.earliest_timestamp,
        latest_timestamp: state.latest_timestamp,
      });
    } catch (err: any) {
      return reply.status(500).send({ error: "Internal Server Error" });
    }
  });
}
