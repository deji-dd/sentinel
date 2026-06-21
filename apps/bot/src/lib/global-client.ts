import { type Client } from "discord.js";

let clientInstance: Client | null = null;

export function setGlobalClient(client: Client) {
  clientInstance = client;
}

export function getGlobalClient(): Client | null {
  return clientInstance;
}
