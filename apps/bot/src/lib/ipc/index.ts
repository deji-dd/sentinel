import { Client } from "discord.js";
import {
  Logger,
  IpcServer,
  toBotPacket,
  IpcClient,
  toWorkerPacket,
} from "@sentinel/shared";
import { handleTerritoryEvent } from "./tt-event-handler.js";
import { constants } from "@sentinel/shared";
import { handleVerificationEvent } from "./verification-event-handler.js";

const logger = new Logger("bot_ipc");

export const workerIpcClient = new IpcClient(constants.worker_ipc_path);

export function dispatchToWorker(packet: toWorkerPacket) {
  workerIpcClient.send(packet);
}

export function setupIpcServer(client: Client): void {
  const socketPath = constants.bot_ipc_path;
  const ipcServer = new IpcServer(socketPath, async (packet: toBotPacket) => {
    const { action } = packet;

    logger.info("received: ", packet.action);

    const tt_actions = [
      "peace_treaty",
      "assault_succeed",
      "assault_fail",
      "assault_start",
      "tt_drop",
      "tt_claim",
      "racket_spawn",
      "racket_despawn",
      "racket_level_up",
      "racket_level_down",
    ];

    try {
      if (tt_actions.includes(action)) {
        await handleTerritoryEvent(client, packet, logger);
        return;
      }

      if (action === "verification_fail" || action === "verification_success") {
        await handleVerificationEvent(client, packet, logger);
        return;
      }

      logger.warn(`Unknown IPC action received: ${action}`);
    } catch (err) {
      logger.error(`Failed to handle '${action}':`, err);
    }
  });

  ipcServer.start();
}
