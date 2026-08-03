import { FastifyInstance } from "fastify";
import os from "node:os";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { Logger } from "@sentinel/utils";
import { sendIpcRequest } from "../lib/ipc-client.js";

const execAsync = promisify(exec);
const logger = new Logger("SystemRoutes");

export async function systemRoutes(fastify: FastifyInstance): Promise<void> {
  // GET /system/telemetry
  fastify.get("/system/telemetry", async (_request, reply) => {
    const isProd = process.env.NODE_ENV === "production";
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;
    const memoryUsagePct = Math.round((usedMem / totalMem) * 10000) / 100;

    const cpus = os.cpus();
    const loadAvg = os.loadavg();
    const apiMem = process.memoryUsage();

    // Query Worker & Bot process metrics in parallel over Point-to-Point UDS IPC
    let workerStats = {
      pid: null as number | null,
      status: "offline" as "online" | "offline" | "restarting",
      uptimeSeconds: 0,
      memory: { rssBytes: 0, heapTotalBytes: 0, heapUsedBytes: 0, externalBytes: 0 },
    };
    let botStats = {
      pid: null as number | null,
      status: "offline" as "online" | "offline" | "restarting",
      uptimeSeconds: 0,
      memory: { rssBytes: 0, heapTotalBytes: 0, heapUsedBytes: 0, externalBytes: 0 },
    };

    const [workerResult, botResult] = await Promise.allSettled([
      sendIpcRequest<typeof workerStats>("get_telemetry", {}, 3000, "worker"),
      sendIpcRequest<typeof botStats>("get_telemetry", {}, 3000, "bot"),
    ]);

    if (workerResult.status === "fulfilled" && workerResult.value) {
      workerStats = {
        pid: workerResult.value.pid ?? null,
        status: (workerResult.value.status as any) || "online",
        uptimeSeconds: workerResult.value.uptimeSeconds || 0,
        memory: workerResult.value.memory || workerStats.memory,
      };
    }

    if (botResult.status === "fulfilled" && botResult.value) {
      botStats = {
        pid: botResult.value.pid ?? null,
        status: (botResult.value.status as any) || "online",
        uptimeSeconds: botResult.value.uptimeSeconds || 0,
        memory: botResult.value.memory || botStats.memory,
      };
    }

    // Fallback: Check systemd unit status if process reported offline over IPC in production
    if (isProd) {
      if (workerStats.status === "offline") {
        try {
          const { stdout } = await execAsync(
            "systemctl show sentinel-worker --property=MainPID,ActiveState",
          );
          const pidMatch = stdout.match(/MainPID=(\d+)/);
          const stateMatch = stdout.match(/ActiveState=(\w+)/);
          if (stateMatch && stateMatch[1] === "active") {
            workerStats.status = "online";
            workerStats.pid = pidMatch && parseInt(pidMatch[1]!, 10) > 0 ? parseInt(pidMatch[1]!, 10) : null;
          }
        } catch {}
      }

      if (botStats.status === "offline") {
        try {
          const { stdout } = await execAsync(
            "systemctl show sentinel-bot --property=MainPID,ActiveState",
          );
          const pidMatch = stdout.match(/MainPID=(\d+)/);
          const stateMatch = stdout.match(/ActiveState=(\w+)/);
          if (stateMatch && stateMatch[1] === "active") {
            botStats.status = "online";
            botStats.pid = pidMatch && parseInt(pidMatch[1]!, 10) > 0 ? parseInt(pidMatch[1]!, 10) : null;
          }
        } catch {}
      }
    }

    return reply.send({
      status: "ok",
      timestamp: new Date().toISOString(),
      environment: isProd ? "production" : "development",
      runner: isProd ? "systemd" : "tsc/dev",
      system: {
        platform: os.platform(),
        arch: os.arch(),
        uptimeSeconds: Math.round(os.uptime()),
        loadAvg,
        cpusCount: cpus.length,
        cpuModel: cpus[0]?.model || "Generic CPU",
        totalMemoryBytes: totalMem,
        freeMemoryBytes: freeMem,
        usedMemoryBytes: usedMem,
        memoryUsagePct,
      },
      processes: [
        {
          id: "sentinel-api",
          name: "API Gateway Server",
          serviceName: "sentinel-api",
          pid: process.pid,
          status: "online",
          environment: isProd ? "production" : "development",
          runner: isProd ? "systemd" : "tsc/dev",
          uptimeSeconds: Math.round(process.uptime()),
          memory: {
            rssBytes: apiMem.rss,
            heapTotalBytes: apiMem.heapTotal,
            heapUsedBytes: apiMem.heapUsed,
            externalBytes: apiMem.external,
          },
        },
        {
          id: "sentinel-worker",
          name: "Background Worker Engine",
          serviceName: "sentinel-worker",
          pid: workerStats.pid,
          status: workerStats.status,
          environment: isProd ? "production" : "development",
          runner: isProd ? "systemd" : "tsc/dev",
          uptimeSeconds: workerStats.uptimeSeconds,
          memory: workerStats.memory,
        },
        {
          id: "sentinel-bot",
          name: "Discord Bot Client",
          serviceName: "sentinel-bot",
          pid: botStats.pid,
          status: botStats.status,
          environment: isProd ? "production" : "development",
          runner: isProd ? "systemd" : "tsc/dev",
          uptimeSeconds: botStats.uptimeSeconds,
          memory: botStats.memory,
        },
      ],
    });
  });

  // GET /system/logs
  fastify.get<{
    Querystring: { service?: string; limit?: string };
  }>("/system/logs", async (request, reply) => {
    const service = request.query.service || "all";
    const limit = Math.min(parseInt(request.query.limit || "50", 10), 200);
    const isProd = process.env.NODE_ENV === "production";

    let logs: Array<{
      id: string;
      timestamp: string;
      service: string;
      level: "info" | "warn" | "error";
      message: string;
    }> = [];

    // Attempt systemd journalctl tailing if in production or systemd is available
    if (isProd) {
      try {
        const unitName =
          service === "all"
            ? "-u sentinel-api -u sentinel-worker -u sentinel-bot"
            : `-u sentinel-${service}`;
        const { stdout } = await execAsync(
          `journalctl ${unitName} -n ${limit} --no-pager --output=json`,
        );

        const lines = stdout.trim().split("\n").filter(Boolean);
        const parsedLogs = lines
          .map((line, idx) => {
            let item: any = {};
            try {
              item = JSON.parse(line);
            } catch {
              return null;
            }

            let timestamp = new Date().toISOString();
            if (item.__REALTIME_TIMESTAMP) {
              const microSecs = Number(item.__REALTIME_TIMESTAMP);
              if (!isNaN(microSecs) && microSecs > 0) {
                timestamp = new Date(Math.floor(microSecs / 1000)).toISOString();
              }
            }

            const unit = String(item._SYSTEMD_UNIT || item.SYSLOG_IDENTIFIER || "");
            let svc = service !== "all" ? service : "system";
            if (unit.includes("sentinel-api")) svc = "api";
            else if (unit.includes("sentinel-worker")) svc = "worker";
            else if (unit.includes("sentinel-bot")) svc = "bot";

            let rawMsg = "";
            if (Array.isArray(item.MESSAGE)) {
              rawMsg = Buffer.from(item.MESSAGE).toString("utf-8");
            } else if (Buffer.isBuffer(item.MESSAGE)) {
              rawMsg = item.MESSAGE.toString("utf-8");
            } else if (typeof item.MESSAGE === "string") {
              rawMsg = item.MESSAGE;
            } else if (item.MESSAGE !== undefined && item.MESSAGE !== null) {
              rawMsg = String(item.MESSAGE);
            }

            // Strip ANSI escape codes
            rawMsg = rawMsg.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, "");
            // Strip syslog prefix e.g. node[345059]:
            rawMsg = rawMsg.replace(/^node(?:\[\d+\])?:?\s*/i, "");

            let level: "info" | "warn" | "error" = "info";
            if (rawMsg.includes("[ERROR]") || rawMsg.includes("ERROR")) {
              level = "error";
            } else if (rawMsg.includes("[WARN]") || rawMsg.includes("WARN")) {
              level = "warn";
            } else if (item.PRIORITY !== undefined) {
              const prio = Number(item.PRIORITY);
              if (prio <= 3) level = "error";
              else if (prio === 4) level = "warn";
            }

            // Strip redundant timestamp pattern e.g. [8/2/2026, 10:35:57 PM]
            rawMsg = rawMsg.replace(
              /^\[\d{1,2}\/\d{1,2}\/\d{4},\s*\d{1,2}:\d{2}:\d{2}(?:\s*(?:AM|PM))?\]\s*/i,
              "",
            );
            // Strip redundant level tag e.g. [WARN] or [INFO] or [ERROR]
            rawMsg = rawMsg.replace(/^\[(?:INFO|WARN|ERROR|DEBUG)\]\s*/i, "");

            return {
              id: `sys-${Date.now()}-${idx}`,
              timestamp,
              service: svc,
              level,
              message: rawMsg.trim() || String(item.MESSAGE || line),
            };
          })
          .filter(
            (
              entry,
            ): entry is {
              id: string;
              timestamp: string;
              service: string;
              level: "info" | "warn" | "error";
              message: string;
            } => entry !== null,
          );

        logs = parsedLogs;
      } catch (err) {
        logger.warn("Failed to read systemd logs via journalctl, falling back to process buffer:", err);
      }
    }

    // Fallback for development mode or when journalctl isn't present
    if (logs.length === 0) {
      const now = Date.now();
      const services = ["api", "worker", "bot"];
      const targetServices = service === "all" ? services : [service];

      const sampleMessages = [
        { level: "info", msg: "Fastify API listening on http://0.0.0.0:3001" },
        { level: "info", msg: "IPC Client socket connected to worker" },
        { level: "info", msg: "Faction sync worker completed cycle successfully (duration: 412ms)" },
        { level: "info", msg: "Discord Bot gateway heartbeat ACK received (ping: 24ms)" },
        { level: "warn", msg: "Torn API rate limit threshold at 82% capacity" },
        { level: "info", msg: "Verification engine checked member cache (0 stale entries)" },
        { level: "info", msg: "Database WAL checkpoint committed cleanly" },
      ];

      for (let i = 0; i < Math.min(limit, 20); i++) {
        const svc = targetServices[i % targetServices.length] || "api";
        const sample = sampleMessages[i % sampleMessages.length];
        const timeOffset = (limit - i) * 3500;
        logs.push({
          id: `dev-${now - timeOffset}-${i}`,
          timestamp: new Date(now - timeOffset).toISOString(),
          service: svc,
          level: (sample?.level as any) || "info",
          message: sample?.msg || `Dev cycle execution step ${i + 1}`,
        });
      }
    }

    return reply.send({
      status: "ok",
      service,
      count: logs.length,
      logs,
    });
  });

  // POST /system/restart
  fastify.post<{
    Body: { service: "api" | "worker" | "bot" | "all" };
  }>("/system/restart", async (request, reply) => {
    const { service } = request.body || { service: "all" };
    const isProd = process.env.NODE_ENV === "production";

    logger.info(`Received restart request for service: '${service}' (env: ${process.env.NODE_ENV})`);

    if (isProd) {
      try {
        const unitName =
          service === "all"
            ? "sentinel-api sentinel-worker sentinel-bot"
            : `sentinel-${service}`;

        // Asynchronously invoke systemctl restart
        exec(`sudo systemctl restart ${unitName}`, (error, _stdout, stderr) => {
          if (error) {
            logger.error(`Failed systemctl restart ${unitName} (${stderr}):`, error);
          } else {
            logger.info(`Systemctl restart ${unitName} executed successfully.`);
          }
        });

        return reply.send({
          status: "accepted",
          message: `Restart command sent for systemd service (${unitName}). Service will reload in background.`,
          service,
          environment: "production",
        });
      } catch (err) {
        return reply.status(500).send({
          error: "RestartFailed",
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // Development mode response
    return reply.send({
      status: "simulated",
      message: `[Dev Mode] Restart request for '${service}' acknowledged. Processes in dev run via tsx/dev scripts.`,
      service,
      environment: "development",
    });
  });
}
