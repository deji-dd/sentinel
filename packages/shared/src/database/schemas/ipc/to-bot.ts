import {
  VerificationFailureResponse,
  VerificationSuccessResponse,
} from "../bot/verification.js";
import {
  TerritoryStateDocument,
  WarLedgerDocument,
} from "../torn/territory.js";

export type toBotPacket =
  | {
      action:
        | "peace_treaty"
        | "assault_succeed"
        | "assault_fail"
        | "assault_start";
      data: WarLedgerDocument;
    }
  | {
      action:
        | "tt_drop"
        | "tt_claim"
        | "racket_spawn"
        | "racket_despawn"
        | "racket_level_up"
        | "racket_level_down";
      data: TerritoryStateDocument;
    }
  | {
      action: "verification_success";
      data: VerificationSuccessResponse;
    }
  | { action: "verification_fail"; data: VerificationFailureResponse };
