/**
 * Strongly-typed IPC message schemas for inter-process communication between
 * Worker V2, Bot, and API applications.
 */

export type IpcWarAction =
  | "assault_start"
  | "assault_succeed"
  | "assault_fail"
  | "peace_treaty";

export type IpcTerritoryAction =
  | "tt_claim"
  | "tt_drop"
  | "racket_spawn"
  | "racket_despawn"
  | "racket_level_up"
  | "racket_level_down";

export type IpcBotAction = IpcWarAction | IpcTerritoryAction;

export type IpcWarPayload = {
  id: string;
  tt: string;
  assaultingFaction: number;
  defendingFaction: number;
  victorFaction: number | null;
  startTime: Date | number;
  endTime: Date | number | null;
};

export type IpcTerritoryPayload = {
  id: string;
  factionId: number | null;
  racket: unknown | null;
  isWarring: boolean;
};

export type IpcBotMessage =
  | { action: IpcWarAction; data: IpcWarPayload }
  | { action: IpcTerritoryAction; data: IpcTerritoryPayload }
  | { action: string; data: unknown };
