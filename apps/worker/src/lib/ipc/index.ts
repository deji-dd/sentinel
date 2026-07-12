import {
  IpcClient,
  IpcServer,
  Logger,
  toBotPacket,
  constants,
  toWorkerPacket,
} from "@sentinel/shared";
import { runVerificationJob } from "../../job-runners/verification_engine.js";

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
        // if (packet.action === "FORCE_RUN_WORKER" && packet.payload?.workerName) {
        //   const schedule = WorkerSchedules.findOne(packet.payload.workerName);
        //   if (schedule) {
        //     schedule.force_run = true;
        //     WorkerSchedules.insertOne(schedule);
        //     logger.info(`Force running worker: ${packet.payload.workerName}`);
        //   }
        // }
        if (packet.action === "verify") {
          await runVerificationJob(packet.data);
        } else if (packet.action === "verify_bulk") {
          for (const job of packet.data) {
            await runVerificationJob(job);
            // Small delay to prevent instantly freezing the event loop while Queue builds
            await new Promise((r) => setTimeout(r, 100));
          }
        }
      } catch (error) {
        logger.error(`Failed to handle '${action}':`, error);
      }
    },
  );

  ipcServer.start();
}
