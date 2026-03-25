import { randomUUID, randomBytes } from "node:crypto";
import { type Request, type Response } from "express";
import { TABLE_NAMES } from "@sentinel/shared";
import { getKysely } from "@sentinel/shared/db/sqlite.js";
import { db } from "../../../lib/db-client.js";
import { type MapRoutesDeps } from "./map-types.js";

export function registerMapDuplicateRoutes({
  app,
  mapRateLimiter,
  magicLinkService,
}: Pick<MapRoutesDeps, "app" | "mapRateLimiter" | "magicLinkService">): void {
  app.post("/api/map/:id/duplicate", async (req: Request, res: Response) => {
    try {
      const sessionToken = req.headers.authorization?.split(" ")[1];
      const { id } = req.params;
      const { name } = req.body;

      if (!sessionToken)
        return res.status(401).json({ error: "Missing session token" });
      if (!name) return res.status(400).json({ error: "Missing new name" });

      const session = await magicLinkService.validateSession(
        sessionToken,
        "map",
      );
      if (!session)
        return res.status(401).json({ error: "Invalid or expired session" });

      const oldMap = await db
        .selectFrom(TABLE_NAMES.MAPS)
        .selectAll()
        .where("id", "=", id)
        .executeTakeFirst();

      if (!oldMap) {
        return res.status(404).json({ error: "Map not found" });
      }

      const isOwner = oldMap.created_by === session.discord_id;
      const isPublicInGuild =
        oldMap.is_public === 1 && oldMap.guild_id === session.guild_id;

      if (!isOwner && !isPublicInGuild) {
        return res.status(403).json({
          error: "Forbidden: You do not have permission to duplicate this map",
        });
      }

      const newMapId = randomUUID();
      const sqlDb = getKysely();

      await sqlDb.transaction().execute(async (trx) => {
        await trx
          .insertInto(TABLE_NAMES.MAPS)
          .values({
            id: newMapId,
            guild_id: session.guild_id,
            name,
            created_by: session.discord_id,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .execute();

        const oldLabels = await trx
          .selectFrom(TABLE_NAMES.MAP_LABELS)
          .selectAll()
          .where("map_id", "=", id)
          .execute();

        const labelIdMap: Record<string, string> = {};
        if (oldLabels.length > 0) {
          const newLabels = oldLabels.map((ol) => {
            const newId = `label-${randomBytes(8).toString("hex")}`;
            labelIdMap[ol.id] = newId;
            return {
              id: newId,
              map_id: newMapId,
              label_text: ol.label_text,
              color_hex: ol.color_hex,
              is_enabled: ol.is_enabled,
              created_at: new Date().toISOString(),
            };
          });
          await trx
            .insertInto(TABLE_NAMES.MAP_LABELS)
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            .values(newLabels as any)
            .execute();
        }

        const oldTerritories = await trx
          .selectFrom(TABLE_NAMES.MAP_TERRITORIES)
          .selectAll()
          .where("map_id", "=", id)
          .execute();

        if (oldTerritories.length > 0) {
          const newTerritories = oldTerritories.map((ot) => ({
            map_id: newMapId,
            territory_id: ot.territory_id,
            label_id: labelIdMap[ot.label_id] || ot.label_id,
          }));

          for (let i = 0; i < newTerritories.length; i += 500) {
            await trx
              .insertInto(TABLE_NAMES.MAP_TERRITORIES)
              .values(newTerritories.slice(i, i + 500))
              .execute();
          }
        }
      });

      return res.json({ success: true, mapId: newMapId });
    } catch (error) {
      console.error("[HTTP] Error duplicating map:", error);
      return res.status(500).json({ error: "Server error" });
    }
  });

  app.post(
    "/api/map/duplicate",
    mapRateLimiter,
    async (req: Request, res: Response) => {
      try {
        const token = req.query.token as string;
        const { name } = req.body;

        if (!token) return res.status(401).json({ error: "Missing token" });
        if (!name) return res.status(400).json({ error: "Missing new name" });

        const sqlDb = getKysely();
        const session = await sqlDb
          .selectFrom(TABLE_NAMES.MAP_SESSIONS)
          .selectAll()
          .where("token", "=", token)
          .where("expires_at", ">", new Date().toISOString())
          .executeTakeFirst();

        if (!session) return res.status(401).json({ error: "Invalid session" });

        const oldMapId = session.map_id;
        const newMapId = randomUUID();

        const oldMap = await sqlDb
          .selectFrom(TABLE_NAMES.MAPS)
          .selectAll()
          .where("id", "=", oldMapId)
          .executeTakeFirst();

        if (!oldMap) return res.status(404).json({ error: "Map not found" });

        await sqlDb.transaction().execute(async (trx) => {
          await trx
            .insertInto(TABLE_NAMES.MAPS)
            .values({
              id: newMapId,
              guild_id: oldMap.guild_id,
              name: name,
              created_by: oldMap.created_by,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            })
            .execute();

          const oldLabels = await trx
            .selectFrom(TABLE_NAMES.MAP_LABELS)
            .selectAll()
            .where("map_id", "=", oldMapId)
            .execute();

          const labelIdMap: Record<string, string> = {};
          if (oldLabels.length > 0) {
            const newLabels = oldLabels.map((ol) => {
              const newId = `label-${randomBytes(8).toString("hex")}`;
              labelIdMap[ol.id] = newId;
              return {
                id: newId,
                map_id: newMapId,
                label_text: ol.label_text,
                color_hex: ol.color_hex,
                is_enabled: ol.is_enabled,
                created_at: new Date().toISOString(),
              };
            });
            await trx
              .insertInto(TABLE_NAMES.MAP_LABELS)
              .values(newLabels)
              .execute();
          }

          const oldTerritories = await trx
            .selectFrom(TABLE_NAMES.MAP_TERRITORIES)
            .selectAll()
            .where("map_id", "=", oldMapId)
            .execute();

          if (oldTerritories.length > 0) {
            const newTerritories = oldTerritories.map((ot) => ({
              map_id: newMapId,
              territory_id: ot.territory_id,
              label_id: labelIdMap[ot.label_id] || ot.label_id,
            }));

            for (let i = 0; i < newTerritories.length; i += 500) {
              await trx
                .insertInto(TABLE_NAMES.MAP_TERRITORIES)
                .values(newTerritories.slice(i, i + 500))
                .execute();
            }
          }
        });

        return res.json({ ok: true });
      } catch (error) {
        console.error("[HTTP] Error duplicating map:", error);
        return res.status(500).json({ error: "Server error" });
      }
    },
  );
}
