import { type Request } from "express";
import { type Client } from "discord.js";
import { MagicLinkService } from "../services/magic-link-service.js";

type ServerContext = {
  discordClient: Client;
  magicLinkService: MagicLinkService;
};

export function getServerContext(req: Request): ServerContext {
  const { discordClient, magicLinkService } = req.app
    .locals as Partial<ServerContext>;

  if (!discordClient || !magicLinkService) {
    throw new Error("Server context dependencies are not initialized");
  }

  return { discordClient, magicLinkService };
}
