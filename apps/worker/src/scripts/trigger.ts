#!/usr/bin/env tsx

/**
 * CLI utility to trigger a worker immediately via UDS.
 * Usage: pnpm worker:trigger <worker_name>
 * Examples:
 * pnpm worker:trigger sync_items
 * pnpm worker:trigger system_maintenance
 */

import { constants, IpcClient, toWorkerPacket } from "@sentinel/shared";

const workerName = process.argv[2];

if (!workerName) {
  console.error("Usage: pnpm worker:trigger <worker_name>");
  console.error("Examples:");
  console.error("  pnpm worker:trigger sync_items");
  console.error("  pnpm worker:trigger system_maintenance");
  process.exit(1);
}

function triggerWorker() {
  console.log(`Triggering ${workerName}...`);

  // Connect to the worker's UDS socket
  const workerIpcClient = new IpcClient(constants.worker_ipc_path);

  workerIpcClient.send({
    action: "force_run_worker",
    data: { worker_name: workerName },
  } as toWorkerPacket);

  console.log(`[${workerName}] trigger command sent via UDS.`);

  // Allow a tiny delay for the socket to flush before exiting
  setTimeout(() => process.exit(0), 100);
}

triggerWorker();
