import { type Express, type RequestHandler } from "express";
import { type Client } from "discord.js";
import { MagicLinkService } from "../../../services/magic-link-service.js";

export type MapRoutesDeps = {
  app: Express;
  mapRateLimiter: RequestHandler;
  client: Client;
  discordClient: Client;
  magicLinkService: MagicLinkService;
};
