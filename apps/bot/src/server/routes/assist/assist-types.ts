import { type Express, type Request, type RequestHandler } from "express";
import {
  ActionRowBuilder,
  ButtonBuilder,
  type Client,
  type EmbedBuilder,
} from "discord.js";
import { type DatabaseIPRateLimiter } from "../../../lib/assist-ip-rate-limiter.js";
import { type AssistPayload, type TrackedAssist } from "./assist-support.js";

export type AssistRouteDeps = {
  app: Express;
  assistRateLimiter: RequestHandler;
  ipRateLimiter: DatabaseIPRateLimiter;
  discordClient: Client;
  port: number;
  allowedProxyMethods: Set<string>;
  maxPayloadBytes: number;
  slowDeliveryWarnMs: number;
  isValidUuid: (value: string) => boolean;
  getClientIp: (req: Request) => string;
  getAssistPayloadSizeBytes: (req: Request) => number;
  resolveStatusFieldValue: (payload: AssistPayload) => string | null;
  buildInitialAssistEmbed: (
    targetTornId: number | undefined,
    requesterDiscordId: string,
    fightStatus: string,
    initialAttackerValue: string,
    initialEnemyHpValue: string,
  ) => EmbedBuilder;
  upsertEmbedField: (
    embed: EmbedBuilder,
    name: string,
    value: string,
    inline: boolean,
  ) => void;
  getActiveTrackedAssist: (uuid: string) => TrackedAssist | null;
  scheduleAssistExpiry: (uuid: string) => void;
  buildAssistButton: (
    targetTornId: number | undefined,
  ) => ActionRowBuilder<ButtonBuilder> | null;
  incrementAssistStrikeByUuid: (uuid: string, reason: string) => Promise<void>;
  enrichAssistEmbed: (
    embed: EmbedBuilder,
    targetTornId: number,
    apiKey: string,
  ) => Promise<void>;
  setTrackedAssist: (uuid: string, tracked: TrackedAssist) => void;
  clearTrackedAssist: (uuid: string) => void;
};
