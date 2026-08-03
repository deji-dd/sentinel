// external app

import { FastifyInstance } from "fastify";
import { db } from "@sentinel/database";
import { Logger } from "@sentinel/utils";

const logger = new Logger("PondRoutes");

interface SensorDataBody {
  device_id: string;
  temperature_c: number;
  ph: number;
  turbidity_ntu: number;
  pond_level_pct: number;
  pump_in_active: boolean;
  pump_drain_active: boolean;
}

interface ControlStateBody {
  manual_mode: boolean;
  pump_in: boolean;
  pump_drain: boolean;
  simulate_breach: boolean;
}

export async function pondRoutes(fastify: FastifyInstance): Promise<void> {
  // 1. INGESTION: ESP32 pushes sensor data here
  fastify.post("/pond/data", async (request, reply) => {
    const body = request.body as SensorDataBody;

    try {
      const reading = await db.sensorReading.create({
        data: {
          deviceId: body.device_id,
          temperatureC: body.temperature_c,
          ph: body.ph,
          turbidityNtu: body.turbidity_ntu,
          pondLevelPct: body.pond_level_pct,
          pumpInActive: body.pump_in_active,
          pumpDrainActive: body.pump_drain_active,
        },
      });
      return reply.code(201).send({ success: true, id: reading.id });
    } catch (error) {
      logger.error("Failed to save sensor reading:", error);
      return reply.code(500).send({
        error: "InternalServerError",
        message: "Failed to save reading",
      });
    }
  });

  // 2. HISTORY: Frontend fetches historical graph data
  fastify.get<{ Params: { deviceId: string } }>(
    "/pond/data/:deviceId",
    async (request, reply) => {
      const { deviceId } = request.params;

      try {
        const readings = await db.sensorReading.findMany({
          where: { deviceId: deviceId },
          orderBy: { createdAt: "desc" },
          take: 100,
        });

        return reply.send(readings.reverse());
      } catch (error) {
        logger.error("Failed to fetch history:", error);
        return reply.code(500).send({
          error: "InternalServerError",
          message: "Failed to fetch history",
        });
      }
    },
  );

  // 3. ESP32 POLLING: ESP32 checks this to see if it should activate pumps/breach
  fastify.get<{ Params: { deviceId: string } }>(
    "/pond/control/:deviceId",
    async (request, reply) => {
      const { deviceId } = request.params;

      try {
        const controlState = await db.deviceControl.upsert({
          where: { deviceId: deviceId },
          update: {},
          create: { deviceId: deviceId },
        });

        return reply.send({
          manual_mode: controlState.manualMode,
          pump_in: controlState.pumpIn,
          pump_drain: controlState.pumpDrain,
          simulate_breach: controlState.simulateBreach,
        });
      } catch (error) {
        logger.error("Failed to fetch control state:", error);
        return reply.code(500).send({
          error: "InternalServerError",
          message: "Failed to fetch control state",
        });
      }
    },
  );

  // 4. FRONTEND CONTROL: UI sends commands here to update the state
  fastify.post<{ Params: { deviceId: string } }>(
    "/pond/control/:deviceId",
    async (request, reply) => {
      const { deviceId } = request.params;
      const body = request.body as ControlStateBody;

      try {
        const updatedState = await db.deviceControl.upsert({
          where: { deviceId: deviceId },
          update: {
            manualMode: body.manual_mode,
            pumpIn: body.pump_in,
            pumpDrain: body.pump_drain,
            simulateBreach: body.simulate_breach,
          },
          create: {
            deviceId: deviceId,
            manualMode: body.manual_mode,
            pumpIn: body.pump_in,
            pumpDrain: body.pump_drain,
            simulateBreach: body.simulate_breach,
          },
        });

        return reply.send({ success: true, state: updatedState });
      } catch (error) {
        logger.error("Failed to update control state:", error);
        return reply.code(500).send({
          error: "InternalServerError",
          message: "Failed to update control state",
        });
      }
    },
  );
}
