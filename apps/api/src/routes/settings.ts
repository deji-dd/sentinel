import { FastifyInstance } from "fastify";
import { UserConfig, Logger, constants, IpcClient } from "@sentinel/shared";
import { z } from "zod";

const logger = new Logger("api_settings");

// Instantiate IPC Client to talk to the Worker process
const workerIpcClient = new IpcClient(constants.worker_ipc_path);

const settingsSchema = z.object({
  log_manager_enabled: z.boolean().optional(),
  log_manager_cadence: z.number().min(5).max(3600).optional(),
  crimes_module_enabled: z.boolean().optional(),
  gym_module_enabled: z.boolean().optional(),
  stocks_module_enabled: z.boolean().optional(),
  travel_module_enabled: z.boolean().optional(),
  wealth_module_enabled: z.boolean().optional(),
  travel_capacity: z.number().min(1).max(200).optional(),
  travel_method: z.string().optional(),
});

export async function settingsRoutes(fastify: FastifyInstance) {
  fastify.get("/", async (request, reply) => {
    try {
      const config = UserConfig.findOne("global");
      if (!config) return reply.send({});
      return reply.send({
        log_manager_enabled: config.log_manager_enabled ?? false,
        log_manager_cadence: config.log_manager_cadence ?? 60,
        crimes_module_enabled: config.crimes_module_enabled ?? false,
        gym_module_enabled: config.gym_module_enabled ?? false,
        stocks_module_enabled: config.stocks_module_enabled ?? false,
        travel_module_enabled: config.travel_module_enabled ?? false,
        wealth_module_enabled: config.wealth_module_enabled ?? false,
        travel_capacity: config.travel_capacity ?? 15,
        travel_method: config.travel_method ?? "1.0",
      });
    } catch (err) {
      logger.error("Error fetching settings:", err);
      return reply.status(500).send({ error: "Internal server error" });
    }
  });

  fastify.post("/", async (request, reply) => {
    try {
      const parsed = settingsSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: "Invalid input",
          details: parsed.error.flatten().fieldErrors,
        });
      }
      
      let config = UserConfig.findOne("global");
      if (!config) {
        return reply.status(404).send({ error: "System uninitialized. Please setup API key first." });
      }

      config = { ...config, ...parsed.data, updated_at: Date.now() };
      UserConfig.update(config);

      // Notify the worker to update its internal schedules
      try {
        await workerIpcClient.send({ action: "settings_updated", data: {} });
      } catch (e) {
        logger.warn("Worker IPC not connected, worker might not be running.");
      }

      return reply.send({ success: true });
    } catch (err) {
      logger.error("Error updating settings:", err);
      return reply.status(500).send({ error: "Internal server error" });
    }
  });
}
