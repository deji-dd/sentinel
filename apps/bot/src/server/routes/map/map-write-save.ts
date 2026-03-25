import { randomUUID } from "node:crypto";
import { type Request, type Response } from "express";
import { TABLE_NAMES } from "@sentinel/shared";
import { getKysely } from "@sentinel/shared/db/sqlite.js";
import { type MapRoutesDeps } from "./map-types.js";

type LabelPayload = {
  id: string;
  text: string;
  color: string;
  enabled: boolean;
  territories?: string[];
};

export function registerMapSaveRoute({
  app,
  mapRateLimiter,
  discordClient,
  magicLinkService,
}: Pick<
  MapRoutesDeps,
  "app" | "mapRateLimiter" | "discordClient" | "magicLinkService"
>): void {
  app.post("/api/map", mapRateLimiter, async (req: Request, res: Response) => {
    try {
      const sessionToken = req.headers.authorization?.split(" ")[1];
      const mapIdParam = req.query.mapId as string;

      if (!sessionToken)
        return res.status(401).json({ error: "Missing session token" });

      const session = await magicLinkService.validateSession(
        sessionToken,
        "map",
      );
      if (!session)
        return res.status(401).json({ error: "Invalid or expired session" });

      const sqlDb = getKysely();
      const mapId =
        mapIdParam ||
        (session.scope === "map"
          ? session.target_path.split("mapId=")[1]
          : null);
      if (!mapId) return res.status(400).json({ error: "Missing map ID" });

      const isGenericMapOwner =
        session.scope === "map" && session.target_path === "/territories";
      const isSpecificMapOwner =
        session.scope === "map" &&
        session.target_path.includes(`mapId=${mapId}`);

      if (
        session.scope === "map" &&
        !isGenericMapOwner &&
        !isSpecificMapOwner
      ) {
        return res.status(403).json({ error: "Forbidden" });
      }

      const existingMap = await sqlDb
        .selectFrom(TABLE_NAMES.MAPS)
        .select(["created_by", "guild_id", "is_public"])
        .where("id", "=", mapId)
        .executeTakeFirst();

      if (!existingMap) {
        return res.status(404).json({ error: "Map not found" });
      }

      const isOwner = existingMap.created_by === session.discord_id;
      const isPublicInGuild =
        existingMap.is_public === 1 &&
        existingMap.guild_id === session.guild_id;

      if (!isOwner && !isPublicInGuild) {
        return res.status(403).json({
          error: "Forbidden: You do not have permission to edit this map",
        });
      }

      const { labels } = req.body as { labels?: LabelPayload[] };

      if (!Array.isArray(labels) || labels.length === 0) {
        console.warn(
          `[HTTP] /api/map - Rejecting save: labels is missing or empty for map ${mapId}`,
        );
        return res.status(400).json({
          error: "Invalid configuration: labels must be a non-empty array",
        });
      }

      await sqlDb.transaction().execute(async (trx) => {
        await trx
          .deleteFrom(TABLE_NAMES.MAP_TERRITORIES)
          .where("map_id", "=", mapId)
          .execute();

        await trx
          .deleteFrom(TABLE_NAMES.MAP_LABELS)
          .where("map_id", "=", mapId)
          .execute();

        await trx
          .insertInto(TABLE_NAMES.MAP_LABELS)
          .values(
            labels.map((l) => ({
              id: l.id,
              map_id: mapId,
              label_text: l.text,
              color_hex: l.color,
              is_enabled: l.enabled ? 1 : 0,
            })),
          )
          .execute();

        const territoryValues: {
          map_id: string;
          territory_id: string;
          label_id: string;
        }[] = [];

        labels.forEach((l) => {
          if (l.territories && l.territories.length > 0) {
            l.territories.forEach((tid) => {
              territoryValues.push({
                map_id: mapId as string,
                territory_id: tid,
                label_id: l.id,
              });
            });
          }
        });

        if (territoryValues.length > 0) {
          const chunks = [];
          const chunkSize = 500;
          for (let i = 0; i < territoryValues.length; i += chunkSize) {
            chunks.push(territoryValues.slice(i, i + chunkSize));
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
          .where("id", "=", mapId)
          .execute();

        const latestHistory = await trx
          .selectFrom(TABLE_NAMES.MAP_HISTORY)
          .selectAll()
          .where("map_id", "=", mapId)
          .orderBy("created_at", "desc")
          .executeTakeFirst();

        const fiveMinutesAgo = new Date(
          Date.now() - 5 * 60 * 1000,
        ).toISOString();
        if (
          !latestHistory ||
          (latestHistory.created_at &&
            latestHistory.created_at < fiveMinutesAgo)
        ) {
          let creatorName = "Unknown";
          try {
            const user = await discordClient.users.fetch(session.discord_id);
            creatorName = user.displayName || user.username;
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
          } catch (e) {
            console.warn(
              `[HTTP] Failed to fetch user name for snapshot: ${session.discord_id}`,
            );
          }

          await trx
            .insertInto(TABLE_NAMES.MAP_HISTORY)
            .values({
              id: randomUUID(),
              map_id: mapId,
              snapshot_json: JSON.stringify(labels),
              created_by: session.discord_id,
              created_by_name: creatorName,
              created_at: new Date().toISOString(),
            })
            .execute();
        }

        const HISTORY_RETENTION_DAYS = 30;
        const HISTORY_MAX_ROWS_PER_MAP = 250;
        const cutoffIso = new Date(
          Date.now() - HISTORY_RETENTION_DAYS * 24 * 60 * 60 * 1000,
        ).toISOString();

        await trx
          .deleteFrom(TABLE_NAMES.MAP_HISTORY)
          .where("map_id", "=", mapId)
          .where("created_at", "<", cutoffIso)
          .execute();

        const remainingHistory = await trx
          .selectFrom(TABLE_NAMES.MAP_HISTORY)
          .select(["id"])
          .where("map_id", "=", mapId)
          .orderBy("created_at", "desc")
          .execute();

        const historyIdsToDelete = remainingHistory
          .slice(HISTORY_MAX_ROWS_PER_MAP)
          .map((row) => row.id)
          .filter(
            (id): id is string => typeof id === "string" && id.length > 0,
          );

        if (historyIdsToDelete.length > 0) {
          await trx
            .deleteFrom(TABLE_NAMES.MAP_HISTORY)
            .where("id", "in", historyIdsToDelete)
            .execute();
        }
      });

      return res.json({ success: true });
    } catch (error) {
      console.error("[HTTP] Error saving map:", error);
      return res.status(500).json({ error: "Server error" });
    }
  });
}
