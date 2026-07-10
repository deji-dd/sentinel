import { Logger } from "@sentinel/shared";
import {
  VerificationJobs,
  type VerificationJobDocument,
} from "@sentinel/shared";
import {
  calculateVerificationTargetState,
  type VerificationCache,
} from "./verification_engine.js";
import { dispatchToBot } from "../lib/ipc.js";

const logger = new Logger("verification_runner");

// Since you are on a GCP free tier, we limit concurrent jobs to protect your RAM
let activeJobCount = 0;
const MAX_CONCURRENT_JOBS = 5;

export function startVerificationJobRunner(pollMs = 2000): void {
  logger.info(`Starting Verification Job Runner. Polling every ${pollMs}ms.`);

  const defaultCache: VerificationCache = {
    factionLeaders: new Map(),
    factionMembers: new Map(),
  };

  setInterval(async () => {
    if (activeJobCount >= MAX_CONCURRENT_JOBS) return;

    const availableSlots = MAX_CONCURRENT_JOBS - activeJobCount;

    // Fixed: Explicit type annotation for the document
    const pendingJobs = VerificationJobs.find(
      (j: VerificationJobDocument) => j.status === "pending",
    ).slice(0, availableSlots);

    if (pendingJobs.length === 0) return;

    for (const job of pendingJobs) {
      activeJobCount++;

      // Lock the job instantly so the next loop doesn't pick it up
      job.status = "processing";
      VerificationJobs.insertOne(job);

      // Fire and forget: Do not await here so the loop can keep pulling other jobs
      processJob(job, defaultCache).finally(() => {
        activeJobCount--;
      });
    }
  }, pollMs);
}

// Fixed: Replaced 'any' with the strict Document interface
async function processJob(
  job: VerificationJobDocument,
  cache: VerificationCache,
): Promise<void> {
  try {
    const result = await calculateVerificationTargetState(
      job.guild_id,
      job.discord_id,
      cache,
    );

    job.status = result.status === "error" ? "failed" : "completed";
    if (result.errorMessage) job.error_message = result.errorMessage;
    VerificationJobs.insertOne(job);

    if (
      result.status === "success" || result.status === "not_linked"
    ) {
      dispatchToBot("VERIFICATION_READY", result);
    }
  } catch (error) {
    logger.error(
      `Catastrophic failure processing job for ${job.discord_id}`,
      error,
    );
    job.status = "failed";
    job.error_message =
      error instanceof Error ? error.message : "Unknown error";
    VerificationJobs.insertOne(job);
  }
}
