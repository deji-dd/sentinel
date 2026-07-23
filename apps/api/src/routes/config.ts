import { FastifyInstance } from "fastify";
import { UserConfig, Logger, tornApi, TornError, encryptApiKey, ConfigStatusResponse, ConfigureApiKeyResponse } from "@sentinel/shared";
import { z } from "zod";

const logger = new Logger("api_config");

export const apiKeySchema = z.object({
  apiKey: z
    .string()
    .length(16, "API Key must be exactly 16 characters.")
    .regex(/^[a-zA-Z0-9]+$/, "API Key must be alphanumeric."),
});

export async function configRoutes(fastify: FastifyInstance) {
  fastify.post("/", async (request, reply) => {
    try {
      const parsed = apiKeySchema.safeParse(request.body);

      if (!parsed.success) {
        return reply.status(400).send({
          error: "Invalid input",
          details: parsed.error.flatten().fieldErrors,
        });
      }

      const { apiKey } = parsed.data;

      try {
        const keyInfo = await tornApi.get("/key/info", { apiKey });

        if (!keyInfo.info.access || keyInfo.info.access.level !== 4) {
          return reply.status(403).send({
            error: "A 'Full Access' API Key is required.",
          });
        }
      } catch (err) {
        if (err instanceof TornError) {
          return reply.status(400).send({
            error: err.message,
          });
        }
        logger.error("Torn API verification failed:", err);
        return reply.status(500).send({
          error: "Failed to verify API key with Torn.",
        });
      }

      const encryptionKey = process.env.ENCRYPTION_KEY;
      if (!encryptionKey) {
        throw new Error("Missing ENCRYPTION_KEY in environment variables.");
      }

      const encryptedKey = encryptApiKey(apiKey, encryptionKey);

      UserConfig.insertOne({
        id: "global",
        api_key: encryptedKey,
        updated_at: Date.now(),
      });

      logger.info("API Key configured successfully.");

      const response: ConfigureApiKeyResponse = { success: true };
      return reply.send(response);
    } catch (err) {
      logger.error("Error setting config:", err);
      return reply.status(500).send({ error: "Internal server error" });
    }
  });

  fastify.get("/", async (request, reply) => {
    try {
      const config = UserConfig.findOne("global");
      if (!config) {
        const response: ConfigStatusResponse = { configured: false };
        return reply.send(response);
      }
      const response: ConfigStatusResponse = { configured: true, updated_at: config.updated_at };
      return reply.send(response);
    } catch (err) {
      logger.error("Error getting config:", err);
      return reply.status(500).send({ error: "Internal server error" });
    }
  });
}
