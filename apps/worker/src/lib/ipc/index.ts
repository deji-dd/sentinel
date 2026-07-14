import {
  IpcClient,
  IpcServer,
  Logger,
  toBotPacket,
  constants,
  toWorkerPacket,
  WorkerSchedules,
  GuildApiKeys,
  decryptApiKey,
  ApiKeyRotator,
} from "@sentinel/shared";
import { runVerificationJob } from "../../job-runners/verification_engine.js";
import { workerEvents } from "../event-bus.js";

const logger = new Logger("worker_ipc");

// Send messages to bot
export const botIpcClient = new IpcClient(constants.bot_ipc_path);

export function dispatchToBot(packet: toBotPacket) {
  botIpcClient.send(packet);
}

// Receive messages
export function setupIpcServer() {
  const socketPath = constants.worker_ipc_path;
  const ipcServer = new IpcServer(
    socketPath,
    async (packet: toWorkerPacket) => {
      const { action } = packet;

      logger.info("Worker received IPC message: " + packet.action);
      try {
        if (packet.action === "force_run_worker") {
          const schedule = WorkerSchedules.findOne(packet.data.worker_name);
          if (schedule) {
            schedule.force_run = true;
            WorkerSchedules.insertOne(schedule);
            logger.info(`Force running worker: ${packet.data.worker_name}`);
          }
        } else if (packet.action === "reinit_ledger") {
          workerEvents.emit("reinit_ledger", packet.data.ledger);
        } else if (packet.action === "settings_updated") {
          workerEvents.emit("settings_updated");
        } else if (packet.action === "verify") {
          await runVerificationJob(packet.data);
        } else if (packet.action === "verify_bulk") {
          // Group jobs by guild_id
          const guildJobs = new Map<string, typeof packet.data>();
          for (const job of packet.data) {
            if (!guildJobs.has(job.guild_id)) guildJobs.set(job.guild_id, []);
            guildJobs.get(job.guild_id)!.push(job);
          }

          for (const [guildId, jobs] of guildJobs.entries()) {
            const apiKeys = GuildApiKeys.find({ guild_id: guildId }).map((k) =>
              decryptApiKey(k.api_key_encrypted, process.env.ENCRYPTION_KEY!),
            );
            if (apiKeys.length === 0) continue;

            const rotator = new ApiKeyRotator(apiKeys);
            await rotator.processSequential(
              jobs,
              async (job, key) => {
                await runVerificationJob(job, key);
              },
              5000,
            ); // 1s delay between verifications per guild
          }
        }
      } catch (error) {
        logger.error(`Failed to handle '${action}':`, error);
      }
    },
  );

  ipcServer.start();
}
