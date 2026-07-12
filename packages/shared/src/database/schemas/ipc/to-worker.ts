import { VerificationRequest } from "../bot/verification.js";

export type toWorkerPacket =
  | { action: "verify"; data: VerificationRequest }
  | { action: "verify_bulk"; data: VerificationRequest[] };
