import { FastifyInstance } from "fastify";
import os from "os";
import {
  SystemState,
  SystemStateDocument,
  UserConfig,
  StatusResponse,
  StatusSyncPayload,
  StatusSettingsPayload,
  StatusStreamUpdate,
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

function generateSettingsPayload(): StatusSettingsPayload {
  const config = UserConfig.findOne("global");
  return {
    log_manager_cadence: config?.log_manager_cadence ?? 60,
    travel_capacity: config?.travel_capacity ?? 15,
    travel_method: config?.travel_method ?? "1.0",
  };
}

async function generateStatusPayload(fastify: FastifyInstance): Promise<StatusResponse> {
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

  return {
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
}

function generateSyncPayload() {
  try {
    const backfillProgress = SystemState.findOne(
      "log_manager_backfill_progress",
    ) as
      | Extract<SystemStateDocument, { id: "log_manager_backfill_progress" }>
      | undefined;

    return {
      backfill: backfillProgress
        ? {
            status: backfillProgress.status,
            logs_parsed: backfillProgress.logs_parsed ?? 0,
            oldest_timestamp_reached:
              backfillProgress.oldest_timestamp_reached ?? null,
          }
        : null,
    };
  } catch (err) {
    return null;
  }
}

export default async function statusRoutes(fastify: FastifyInstance) {
  fastify.get("/api/status", async (request, reply) => {
    return generateStatusPayload(fastify);
  });

  fastify.get("/api/status/sync", async (request, reply) => {
    const syncData = generateSyncPayload();
    if (!syncData) {
      return reply.status(404).send({ error: "Sync state not found" });
    }
    return reply.send(syncData);
  });

  fastify.get("/api/status/stream", { websocket: true }, (connection, req) => {
    let isAlive = true;

    const sendUpdate = async () => {
      if (!isAlive) return;
      try {
        const status = await generateStatusPayload(fastify);
        const sync = generateSyncPayload();
        const settings = generateSettingsPayload();

        connection.send(
          JSON.stringify({
            type: "update",
            status,
            sync,
            settings,
          }),
        );
      } catch (err) {
        fastify.log.error(err, "Failed to send WS update");
      }
    };

    // Send initial state immediately
    sendUpdate();

    // Poll every 1.5 seconds
    const interval = setInterval(sendUpdate, 1500);

    connection.on("close", () => {
      isAlive = false;
      clearInterval(interval);
    });

    connection.on("error", () => {
      isAlive = false;
      clearInterval(interval);
    });
  });
}
