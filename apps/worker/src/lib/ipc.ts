import { IpcClient, IpcServer, Logger } from "@sentinel/shared";

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
  // Handlers for incoming worker commands can go here
});

export function startWorkerIpcServer() {
  workerIpcServer.start();
}
