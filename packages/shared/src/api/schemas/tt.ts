/**
 * Territory / User Maps API Schemas
 */
import { UserMapDocument } from "../../database/index.js";

export interface SaveMapPayload {
  userId: string;
  name: string;
  labels: unknown[];
  assignments: Record<string, string>;
  mapId?: string;
}

export type UserMapsResponse = UserMapDocument[];

export interface TerritoryRacketInfo {
  name: string;
  reward: string;
  level: number;
  faction: number;
  created_at: number;
  changed_at: number;
}

export interface TerritoryMetadataItem {
  sector: number;
  size: number;
  slots: number;
  respect: number;
  racket?: TerritoryRacketInfo;
}

export interface TerritoryMetadataResponse {
  territories: Record<string, TerritoryMetadataItem>;
  prices: {
    items: Record<string, number>;
    points: number;
  };
  itemNames: Record<string, string>;
}
