// import {
//   claimWorker,
//   completeWorker,
//   failWorker,
//   fetchDueWorkerSchedules,
//   insertWorkerLog,
// } from "@sentinel/shared";
// import { Logger } from "../../lib/logger.js";
// import { sendIpcRequest } from "../../lib/ipc-client.js";

// const POLL_INTERVAL_MS = 5000;
// const logger = new Logger("bot_cron_dispatch");

// let inFlight = false;
// let started = false;

// // Pre-allocated operational variables for V8 GC optimization
// // eslint-disable-next-line @typescript-eslint/no-explicit-any
// let dueSchedules: any[];
// let claimed: boolean;
// let startedAt: string;
// let errorMessage: string;

// function parseMetadata(
//   metadata: string | null | undefined,
// ): Record<string, unknown> | null {
//   if (!metadata) {
//     return null;
//   }

//   try {
//     const parsed = JSON.parse(metadata);
//     if (parsed && typeof parsed === "object") {
//       return parsed as Record<string, unknown>;
//     }
//   } catch {
//     return null;
//   }

//   return null;
// }

// async function dispatchJob(schedule: {
//   worker_id: string;
//   worker_name: string;
//   cadence_seconds: number;
//   attempts: number;
//   metadata?: string | null;
// }): Promise<void> {
//   const response = await sendIpcRequest("execute-job", {
//     workerName: schedule.worker_name,
//     metadata: parseMetadata(schedule.metadata),
//   });

//   if (!response.success) {
//     throw new Error(
//       `Bot job execution failed for ${schedule.worker_name}: ${response.error || "Unknown IPC error"}${response.details ? ` - ${response.details}` : ""}`,
//     );
//   }

//   await completeWorker(schedule.worker_id, schedule.cadence_seconds);
//   await insertWorkerLog({
//     worker_id: schedule.worker_id,
//     status: "success",
//     run_started_at: new Date().toISOString(),
//     run_finished_at: new Date().toISOString(),
//   });

//   logger.success(`Successfully executed job ${schedule.worker_name}`);

//   if (schedule.attempts > 0) {
//     logger.warn(
//       `Recovered ${schedule.worker_name} after ${schedule.attempts} attempt(s)`,
//     );
//   }
// }

// async function pollAndDispatch(): Promise<void> {
//   if (inFlight) {
//     return;
//   }

//   inFlight = true;
//   try {
//     dueSchedules = await fetchDueWorkerSchedules({
//       workerNamePrefix: "bot:",
//       limit: 100,
//     });

//     for (const schedule of dueSchedules) {
//       claimed = await claimWorker(schedule.worker_id);
//       if (!claimed) {
//         continue;
//       }

//       startedAt = new Date().toISOString();
//       try {
//         await dispatchJob(schedule);
//       } catch (error) {
//         errorMessage = error instanceof Error ? error.message : String(error);
//         await failWorker(schedule.worker_id, schedule.attempts, errorMessage);
//         await insertWorkerLog({
//           worker_id: schedule.worker_id,
//           status: "error",
//           error_message: errorMessage,
//           run_started_at: startedAt,
//           run_finished_at: new Date().toISOString(),
//         });
//         logger.error(`Failed to dispatch job ${schedule.worker_name}`, error);
//       }
//     }
//   } finally {
//     inFlight = false;
//   }
// }

// export function startBotCronDispatcherWorker(): void {
//   if (started) {
//     return;
//   }

//   started = true;
//   void pollAndDispatch();
//   setInterval(() => {
//     void pollAndDispatch();
//   }, POLL_INTERVAL_MS);
// }
