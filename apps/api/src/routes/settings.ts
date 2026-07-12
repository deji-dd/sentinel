// import { FastifyPluginAsync } from "fastify";
// import { SystemState } from "@sentinel/shared";

// export const settingsRoutes: FastifyPluginAsync = async (fastify) => {
//   fastify.get("/preferences", async (request, reply) => {
//     try {
//       const doc = SystemState.get("alert_preferences");
//       if (doc) {
//         return reply.send({ preferences: doc.preferences || {} });
//       } else {
//         // Return default preferences
//         return reply.send({
//           preferences: {
//             energy_full: false,
//             nerve_full: false,
//             bazaar_sales: false,
//             territory_changes: false,
//           },
//         });
//       }
//     } catch (error: any) {
//       fastify.log.error(error);
//       return reply.status(500).send({ error: "Failed to fetch preferences" });
//     }
//   });

//   fastify.post("/preferences", async (request, reply) => {
//     try {
//       const body = request.body as Record<string, boolean>;
//       if (!body) {
//         return reply.status(400).send({ error: "Missing body" });
//       }

//       SystemState.upsert({
//         id: "alert_preferences",
//         last_updated: Math.floor(Date.now() / 1000),
//         preferences: body,
//       });

//       return reply.send({ success: true });
//     } catch (error: any) {
//       fastify.log.error(error);
//       return reply.status(500).send({ error: "Failed to update preferences" });
//     }
//   });

//   fastify.post("/push", async (request, reply) => {
//     try {
//       const body = request.body;
//       if (!body) {
//         return reply.status(400).send({ error: "Missing subscription object" });
//       }

//       SystemState.upsert({
//         id: "push_subscription",
//         last_updated: Math.floor(Date.now() / 1000),
//         subscription: body,
//       });

//       return reply.send({ success: true });
//     } catch (error: any) {
//       fastify.log.error(error);
//       return reply.status(500).send({ error: "Failed to save push subscription" });
//     }
//   });

//   fastify.delete("/push", async (request, reply) => {
//     try {
//       SystemState.upsert({
//         id: "push_subscription",
//         last_updated: Math.floor(Date.now() / 1000),
//         subscription: null,
//       });

//       return reply.send({ success: true });
//     } catch (error: any) {
//       fastify.log.error(error);
//       return reply.status(500).send({ error: "Failed to remove push subscription" });
//     }
//   });
// };
