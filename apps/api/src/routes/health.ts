import { FastifyInstance } from "fastify";
import { HealthResponse } from "@sentinel/shared";

export default async function healthRoutes(fastify: FastifyInstance) {
  fastify.get("/health", async (request, reply): Promise<HealthResponse> => {
    return { status: "healthy", timestamp: Date.now() };
  });
}

