import { IpcClient, IpcServer, Logger, WorkerSchedules } from "@sentinel/shared";

const logger = new Logger("Worker_IPC");

// Client to send messages to the Bot
export const botIpcClient = new IpcClient("/tmp/sentinel-bot.sock");

// Standardized function to replace PM2 process.send
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function dispatchToBot(action: string, payload: any): void {
  botIpcClient.send({ action, payload });
}

// Server to receive messages from Bot/API (for future use)
export const workerIpcServer = new IpcServer("/tmp/sentinel-worker.sock", (packet) => {
  logger.info("Worker received IPC message: " + JSON.stringify(packet));
  
  if (packet.action === "FORCE_RUN_WORKER" && packet.payload?.workerName) {
    const schedule = WorkerSchedules.findOne(packet.payload.workerName);
    if (schedule) {
      schedule.force_run = true;
      WorkerSchedules.insertOne(schedule);
      logger.info(`Force running worker: ${packet.payload.workerName}`);
    }
  } else if (packet.action === "RECALCULATE_MAC" && packet.payload?.transactionId) {
    logger.info(`Acknowledged RECALCULATE_MAC for transaction ${packet.payload.transactionId}. (Logic to be implemented)`);
  }
});

export function startWorkerIpcServer() {
  workerIpcServer.start();
}
