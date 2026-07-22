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
import {
  runVerificationJob,
  VerificationCache,
} from "../../job-runners/verification_engine.js";
import { workerEvents } from "../event-bus.js";

const logger = new Logger("worker_ipc");

// Send messages to bot
export const botIpcClient = new IpcClient(constants.bot_ipc_path);

export function dispatchToBot(packet: toBotPacket) {
  botIpcClient.send(packet);
}

// Receive messages
export async function setupIpcServer() {
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
        } else if (packet.action === "wealth_init") {
          workerEvents.emit("wealth_init");
        } else if (packet.action === "verify") {
          const result = await runVerificationJob(packet.data);
          if (result) {
            if ("error" in result) {
              dispatchToBot({ action: "verification_fail", data: result });
            } else {
              dispatchToBot({ action: "verification_success", data: result });
            }
          }
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

            const cache: VerificationCache = {
              factionLeaders: new Map(),
              factionMembers: new Map(),
            };

            let successCount = 0;
            let failCount = 0;
            const successDetails: string[] = [];
            const failDetails: string[] = [];

            const rotator = new ApiKeyRotator(apiKeys);
            await rotator.processSequential(
              jobs,
              async (job, key) => {
                const res = await runVerificationJob(job, key, cache);
                if (res) {
                  if ("error" in res) {
                    failCount++;
                    failDetails.push(
                      `User ${job.discord_id}: ${res.error.message}`,
                    );
                  } else {
                    successCount++;
                    let roleStr = "No changes";
                    if (
                      res.roles_to_add?.length ||
                      res.roles_to_remove?.length
                    ) {
                      const added = res.roles_to_add?.length
                        ? `+${res.roles_to_add.length}`
                        : "";
                      const removed = res.roles_to_remove?.length
                        ? `-${res.roles_to_remove.length}`
                        : "";
                      roleStr = [added, removed].filter(Boolean).join(", ");
                    }
                    successDetails.push(`User ${job.discord_id}: ${roleStr}`);
                  }
                }
              },
              5000,
            ); // 5s delay between verifications per guild

            const summaryLines = [
              `Verification Bulk Run Summary for Guild ${guildId}`,
              `Total Processed: ${jobs.length}`,
              `Successes: ${successCount}`,
              `Failures: ${failCount}`,
              ``,
              `--- FAILURES ---`,
              failDetails.length > 0 ? failDetails.join("\n") : "None",
              ``,
              `--- SUCCESSES ---`,
              successDetails.length > 0 ? successDetails.join("\n") : "None",
            ];

            dispatchToBot({
              action: "verification_bulk_complete",
              data: {
                guild_id: guildId,
                channel_id: jobs[0].channel_id,
                success_count: successCount,
                fail_count: failCount,
                summary_text: summaryLines.join("\n"),
              },
            });
          }
        }
      } catch (error) {
        logger.error(`Failed to handle '${action}':`, error);
      }
    },
  );

  ipcServer.start();
}
