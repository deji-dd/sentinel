import * as net from "net";
import { Logger } from "@sentinel/shared";

const logger = new Logger("api_ipc");

/**
 * Sends a command payload to the background worker via Unix Domain Socket.
 * @param command The string command or JSON payload to send
 * @returns A promise resolving with the worker's string response
 */
export async function sendToWorker(command: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const socketPath = "/tmp/sentinel-worker.sock";
    const client = net.createConnection({ path: socketPath }, () => {
      logger.debug(`Connected to worker UDS at ${socketPath}. Sending command...`);
      client.write(command);
    });

    client.on("data", (data) => {
      const response = data.toString().trim();
      logger.debug(`Received response from worker: ${response}`);
      client.end();
      resolve(response);
    });

    client.on("error", (err) => {
      logger.error(`IPC Client error: ${err.message}`);
      reject(err);
    });

    // Optionally add a timeout
    client.setTimeout(10000, () => {
      client.destroy();
      reject(new Error("IPC connection to worker timed out"));
    });
  });
}
