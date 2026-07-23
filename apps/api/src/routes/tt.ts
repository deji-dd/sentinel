import { FastifyInstance } from "fastify";
import {
  UserMaps,
  TerritoryBlueprints,
  TerritoryStates,
  TornItems,
  Logger,
  SaveMapPayload,
  TerritoryMetadataResponse,
  UserMapsResponse,
} from "@sentinel/shared";
import crypto from "crypto";
import { z } from "zod";

const logger = new Logger("api_tt");

const saveMapSchema = z.object({
  userId: z.string(),
  name: z.string(),
  labels: z.array(z.any()),
  assignments: z.record(z.string(), z.string()),
  mapId: z.string().optional(),
});

export async function ttRoutes(fastify: FastifyInstance) {
  // Add an internal secret check hook just for TT routes
  fastify.addHook("preHandler", async (request, reply) => {
    const secret = request.headers["x-sentinel-secret"];
    const expectedSecret = process.env.SENTINEL_INTERNAL_SECRET;

    if (!expectedSecret || secret !== expectedSecret) {
      return reply.status(403).send({ error: "Unauthorized internal request" });
    }
  });

  fastify.get("/maps", async (request, reply) => {
    try {
      const { userId } = request.query as { userId: string };
      if (!userId) {
        return reply.status(400).send({ error: "userId is required" });
      }

      const maps = UserMaps.find({ user_id: userId });
      return reply.send(maps);
    } catch (err) {
      logger.error("Error fetching user maps:", err);
      return reply.status(500).send({ error: "Internal server error" });
    }
  });

  fastify.post("/maps", async (request, reply) => {
    try {
      const parsed = saveMapSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: "Invalid input",
          details: parsed.error.flatten().fieldErrors,
        });
      }

      const data = parsed.data;

      if (data.mapId) {
        const existing = UserMaps.findOne(data.mapId);
        if (existing && existing.user_id === data.userId) {
          UserMaps.update({
            ...existing,
            name: data.name,
            labels: data.labels,
            assignments: data.assignments,
            updated_at: Date.now(),
          });
        }
      } else {
        const newId = crypto.randomUUID();
        UserMaps.insertOne({
          id: newId,
          user_id: data.userId,
          name: data.name,
          labels: data.labels,
          assignments: data.assignments,
          created_at: Date.now(),
          updated_at: Date.now(),
        });
      }

      return reply.send({ success: true });
    } catch (err) {
      logger.error("Error saving map:", err);
      return reply.status(500).send({ error: "Internal server error" });
    }
  });

  fastify.get("/metadata", async (request, reply) => {
    try {
      const blueprints = TerritoryBlueprints.find({});
      const states = TerritoryStates.find({});

      const metadata: Record<string, any> = {};

      for (const bp of blueprints) {
        metadata[bp.id] = {
          sector: bp.data.sector,
          size: bp.data.size,
          slots: bp.data.slots,
          respect: bp.data.respect || 0,
        };
      }

      for (const state of states) {
        if (metadata[state.id]) {
          metadata[state.id].racket = state.racket;
        }
      }

      const dbItems = TornItems.find({});
      const itemPrices: Record<string, number> = {};
      const itemNames: Record<string, string> = {};

      for (const item of dbItems) {
        itemPrices[item.id] = item.data.value.market_price || 0;
        itemNames[item.id] = item.data.name;
      }

      return reply.send({
        territories: metadata,
        prices: {
          items: itemPrices,
          points: 0, // points can be fetched if needed, 0 for now
        },
        itemNames,
      });
    } catch (err) {
      logger.error("Error generating metadata:", err);
      return reply.status(500).send({ error: "Internal server error" });
    }
  });
}
