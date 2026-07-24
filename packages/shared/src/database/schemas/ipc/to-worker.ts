import { VerificationRequest } from "../bot/verification.js";

export type toWorkerPacket =
  | { action: "verify"; data: VerificationRequest }
  | { action: "verify_bulk"; data: VerificationRequest[] }
  | { action: "force_run_worker"; data: { worker_name: string } }
  | { action: "settings_updated" }
  | { action: "reinit_ledger"; data: { ledger: "gym" | "items" | "crimes" | "war" } }
  | { action: "wealth_init" }
  | { action: "wealth_heal" }
  | { action: "resync_logs"; data: { from: number; to: number } };
