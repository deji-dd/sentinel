import { randomUUID } from "node:crypto";
import { type Request, type Response } from "express";
import { TABLE_NAMES } from "@sentinel/shared";
import { getKysely } from "@sentinel/shared/db/sqlite.js";
import { db } from "../../../lib/db-client.js";
import { type MapRoutesDeps } from "./map-types.js";

export function registerMapCrudRoutes({
  app,
  magicLinkService,
}: Pick<MapRoutesDeps, "app" | "magicLinkService">): void {
  app.post("/api/map/create", async (req: Request, res: Response) => {
    try {
      const sessionToken = req.headers.authorization?.split(" ")[1];
      const { name } = req.body;

      if (!sessionToken)
        return res.status(401).json({ error: "Missing session token" });
      if (!name) return res.status(400).json({ error: "Missing map name" });

      const session = await magicLinkService.validateSession(
        sessionToken,
        "map",
      );
      if (!session)
        return res.status(401).json({ error: "Invalid or expired session" });

      const mapId = randomUUID();
      await db
        .insertInto(TABLE_NAMES.MAPS)
        .values({
          id: mapId,
          guild_id: session.guild_id,
          name,
          created_by: session.discord_id,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .execute();

      return res.json({ success: true, mapId });
    } catch (error) {
      console.error("[HTTP] Error creating map:", error);
      return res.status(500).json({ error: "Server error" });
    }
  });

  app.post("/api/map/:id/restore", async (req: Request, res: Response) => {
    try {
      const sessionToken = req.headers.authorization?.split(" ")[1];
      const { id } = req.params;
      const { historyId } = req.body;

      if (!sessionToken)
        return res.status(401).json({ error: "Missing session token" });
      if (!historyId)
        return res.status(400).json({ error: "Missing history ID" });

      const session = await magicLinkService.validateSession(
        sessionToken,
        "map",
      );
      if (!session)
        return res.status(401).json({ error: "Invalid or expired session" });

      const map = await db
        .selectFrom(TABLE_NAMES.MAPS)
        .select(["guild_id", "created_by", "is_public"])
        .where("id", "=", id)
        .executeTakeFirst();

      if (!map) {
        return res.status(404).json({ error: "Map not found" });
      }

      const isGenericMapOwner =
        session.scope === "map" && session.target_path === "/territories";
      const isSpecificMapOwner =
        session.scope === "map" && session.target_path.includes(`mapId=${id}`);

      if (
        session.scope === "map" &&
        !isGenericMapOwner &&
        !isSpecificMapOwner
      ) {
        return res.status(403).json({ error: "Forbidden: Session mismatch" });
      }

      const isOwner = map.created_by === session.discord_id;
      const isPublicInGuild =
        map.is_public === 1 && map.guild_id === session.guild_id;

      if (!isOwner && !isPublicInGuild) {
        return res.status(403).json({
          error: "Forbidden: You do not have permission to restore this map",
        });
      }

      const historyEntry = await db
        .selectFrom(TABLE_NAMES.MAP_HISTORY)
        .selectAll()
        .where("id", "=", historyId)
        .where("map_id", "=", id)
        .executeTakeFirst();

      if (!historyEntry) {
        return res.status(404).json({ error: "History entry not found" });
      }

      const labels = JSON.parse(historyEntry.snapshot_json);
      const sqlDb = getKysely();

      await sqlDb.transaction().execute(async (trx) => {
        await trx
          .deleteFrom(TABLE_NAMES.MAP_TERRITORIES)
          .where("map_id", "=", id)
          .execute();

        await trx
          .deleteFrom(TABLE_NAMES.MAP_LABELS)
          .where("map_id", "=", id)
          .execute();

        await trx
          .insertInto(TABLE_NAMES.MAP_LABELS)
          .values(
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            labels.map((l: any) => ({
              id: l.id,
              map_id: id,
              label_text: l.text,
              color_hex: l.color,
              is_enabled: l.enabled ? 1 : 0,
            })),
          )
          .execute();

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const territoryValues: any[] = [];
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        labels.forEach((l: any) => {
          if (l.territories && l.territories.length > 0) {
            l.territories.forEach((tid: string) => {
              territoryValues.push({
                map_id: id,
                territory_id: tid,
                label_id: l.id,
              });
            });
          }
        });

        if (territoryValues.length > 0) {
          const chunks = [];
          for (let i = 0; i < territoryValues.length; i += 500) {
            chunks.push(territoryValues.slice(i, i + 500));
          }
          for (const chunk of chunks) {
            await trx
              .insertInto(TABLE_NAMES.MAP_TERRITORIES)
              .values(chunk)
              .execute();
          }
        }

        await trx
          .updateTable(TABLE_NAMES.MAPS)
          .set({ updated_at: new Date().toISOString() })
          .where("id", "=", id)
          .execute();
      });

      return res.json({ success: true });
    } catch (error) {
      console.error("[HTTP] Error restoring map history:", error);
      return res.status(500).json({ error: "Server error" });
    }
  });

  app.patch("/api/map/:id", async (req: Request, res: Response) => {
    try {
      const sessionToken = req.headers.authorization?.split(" ")[1];
      const { id } = req.params;
      const { name, isPublic } = req.body;

      if (!sessionToken)
        return res.status(401).json({ error: "Missing session token" });

      const session = await magicLinkService.validateSession(
        sessionToken,
        "map",
      );
      if (!session)
        return res.status(401).json({ error: "Invalid or expired session" });

      const map = await db
        .selectFrom(TABLE_NAMES.MAPS)
        .select(["guild_id", "created_by"])
        .where("id", "=", id)
        .executeTakeFirst();

      if (!map) {
        return res.status(404).json({ error: "Map not found" });
      }

      if (map.created_by !== session.discord_id) {
        return res.status(403).json({
          error: "Forbidden: You do not have permission to modify map metadata",
        });
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const updateData: any = {
        updated_at: new Date().toISOString(),
      };
      if (name !== undefined) updateData.name = name;
      if (isPublic !== undefined) updateData.is_public = isPublic ? 1 : 0;

      await db
        .updateTable(TABLE_NAMES.MAPS)
        .set(updateData)
        .where("id", "=", id)
        .execute();

      return res.json({ success: true });
    } catch (error) {
      console.error("[HTTP] Error updating map:", error);
      return res.status(500).json({ error: "Server error" });
    }
  });

  app.delete("/api/map/:id", async (req: Request, res: Response) => {
    try {
      const sessionToken = req.headers.authorization?.split(" ")[1];
      const { id } = req.params;

      if (!sessionToken)
        return res.status(401).json({ error: "Missing session token" });

      const session = await magicLinkService.validateSession(
        sessionToken,
        "map",
      );
      if (!session)
        return res.status(401).json({ error: "Invalid or expired session" });

      const map = await db
        .selectFrom(TABLE_NAMES.MAPS)
        .select("guild_id")
        .where("id", "=", id)
        .executeTakeFirst();

      if (!map || map.guild_id !== session.guild_id) {
        return res.status(403).json({ error: "Forbidden or map not found" });
      }

      const sqlDb = getKysely();
      await sqlDb.transaction().execute(async (trx) => {
        await trx
          .deleteFrom(TABLE_NAMES.MAP_TERRITORIES)
          .where("map_id", "=", id)
          .execute();
        await trx
          .deleteFrom(TABLE_NAMES.MAP_LABELS)
          .where("map_id", "=", id)
          .execute();
        await trx.deleteFrom(TABLE_NAMES.MAPS).where("id", "=", id).execute();
      });

      return res.json({ success: true });
    } catch (error) {
      console.error("[HTTP] Error deleting map:", error);
      return res.status(500).json({ error: "Server error" });
    }
  });
}
