import { type Request, type Response } from "express";
import {
  TABLE_NAMES,
  getNextApiKey,
  parseRewardString,
} from "@sentinel/shared";
import { getKysely } from "@sentinel/shared/db/sqlite.js";
import { db } from "../../../lib/db-client.js";
import { getGuildApiKeys } from "../../../lib/guild-api-keys.js";
import { fetchPointPrice, fetchMarketPrices } from "../../../lib/torn-api.js";
import { type MapRoutesDeps } from "./map-types.js";

export function registerMapReadRoutes({
  app,
  client,
  magicLinkService,
}: Pick<MapRoutesDeps, "app" | "client" | "magicLinkService">): void {
  app.get("/api/map", async (req: Request, res: Response) => {
    const start = Date.now();
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
        return res
          .status(403)
          .json({ error: "Forbidden: You do not have access to this map" });
      }

      const map = await sqlDb
        .selectFrom(TABLE_NAMES.MAPS)
        .selectAll()
        .where("id", "=", mapId)
        .executeTakeFirst();

      if (!map) {
        return res.status(404).json({ error: "Configuration not found" });
      }

      const isOwner = map.created_by === session.discord_id;
      const isPublicInGuild =
        map.is_public === 1 && map.guild_id === session.guild_id;

      if (!isOwner && !isPublicInGuild) {
        return res
          .status(403)
          .json({ error: "Forbidden: You do not have access to this map" });
      }

      const labels = await sqlDb
        .selectFrom(TABLE_NAMES.MAP_LABELS)
        .selectAll()
        .where("map_id", "=", mapId)
        .execute();

      const assignmentsRows = await sqlDb
        .selectFrom(TABLE_NAMES.MAP_TERRITORIES)
        .select(["territory_id", "label_id"])
        .where("map_id", "=", mapId)
        .execute();

      const labelTerritories: Record<string, string[]> = {};
      const assignments: Record<string, string> = {};

      assignmentsRows.forEach((row) => {
        if (!labelTerritories[row.label_id])
          labelTerritories[row.label_id] = [];
        labelTerritories[row.label_id].push(row.territory_id);
        assignments[row.territory_id] = row.label_id;
      });

      const blueprints = await sqlDb
        .selectFrom(TABLE_NAMES.TERRITORY_BLUEPRINT)
        .leftJoin(
          TABLE_NAMES.TERRITORY_STATE,
          `${TABLE_NAMES.TERRITORY_STATE}.territory_id`,
          `${TABLE_NAMES.TERRITORY_BLUEPRINT}.id`,
        )
        .select([
          `${TABLE_NAMES.TERRITORY_BLUEPRINT}.id`,
          `${TABLE_NAMES.TERRITORY_BLUEPRINT}.sector`,
          `${TABLE_NAMES.TERRITORY_BLUEPRINT}.respect`,
          `${TABLE_NAMES.TERRITORY_BLUEPRINT}.size`,
          `${TABLE_NAMES.TERRITORY_BLUEPRINT}.slots`,
          `${TABLE_NAMES.TERRITORY_STATE}.racket_name`,
          `${TABLE_NAMES.TERRITORY_STATE}.racket_reward`,
          `${TABLE_NAMES.TERRITORY_STATE}.racket_level`,
        ])
        .execute();

      const territoryMetadata: Record<
        string,
        {
          sector: number;
          respect: number;
          size: number;
          slots: number;
          racket: { name: string; reward: string; level: number } | null;
        }
      > = {};

      const itemNames = new Set<string>();
      let hasPoints = false;

      blueprints.forEach((bp) => {
        if (bp.id) {
          territoryMetadata[bp.id] = {
            sector: bp.sector as number,
            respect: bp.respect as number,
            size: bp.size as number,
            slots: bp.slots as number,
            racket: bp.racket_name
              ? {
                  name: bp.racket_name as string,
                  reward: bp.racket_reward as string,
                  level: bp.racket_level as number,
                }
              : null,
          };

          if (bp.racket_reward) {
            const parsed = parseRewardString(bp.racket_reward);
            if (parsed) {
              if (parsed.type === "items" && parsed.itemName) {
                itemNames.add(parsed.itemName);
              } else if (parsed.type === "points") {
                hasPoints = true;
              }
            }
          }
        }
      });

      console.log(
        `[HTTP] /api/map - Metadata assembled for ${blueprints.length} territories. ${itemNames.size} items to check price.`,
      );

      const guildApiKeys = await getGuildApiKeys(map.guild_id);
      const prices: { items: Record<string, number>; points: number } = {
        items: {},
        points: 0,
      };

      if (guildApiKeys.length > 0) {
        const apiKey = getNextApiKey(map.guild_id, guildApiKeys);

        if (itemNames.size > 0) {
          const itemRecords = await sqlDb
            .selectFrom(TABLE_NAMES.TORN_ITEMS)
            .select(["item_id", "name", "value"])
            .where("name", "in", Array.from(itemNames))
            .execute();

          const itemIdMap: Record<number, string> = {};
          const missingPriceIds: number[] = [];

          itemRecords.forEach((r) => {
            const name = r.name as string;
            const id = r.item_id as number;
            itemIdMap[id] = name;

            if (r.value !== null && r.value !== undefined) {
              prices.items[name] = r.value as number;
            } else {
              missingPriceIds.push(id);
            }
          });

          if (missingPriceIds.length > 0) {
            console.log(
              `[HTTP] /api/map - Fetching ${missingPriceIds.length} missing market prices...`,
            );
            const marketPrices = await fetchMarketPrices(
              apiKey,
              missingPriceIds,
            );
            Object.entries(marketPrices).forEach(([id, price]) => {
              const name = itemIdMap[Number(id)];
              if (name) prices.items[name] = price;
            });
          }
        }

        if (hasPoints) {
          const pointStart = Date.now();
          prices.points = await fetchPointPrice(apiKey);
          if (Date.now() - pointStart > 5000) {
            console.log(
              `[HTTP] /api/map - Point price fetch took ${Date.now() - pointStart}ms`,
            );
          }
        }
      }

      console.log(`[HTTP] /api/map success - ${Date.now() - start}ms`);
      return res.json({
        map,
        labels: labels.map((l) => ({
          id: l.id as string,
          text: l.label_text,
          color: l.color_hex,
          enabled: (l.is_enabled ?? 1) === 1,
          territories: labelTerritories[l.id as string] || [],
          respect: 0,
          sectors: 0,
          rackets: 0,
        })),
        assignments,
        territoryMetadata,
        prices,
      });
    } catch (error) {
      console.error("[HTTP] Error fetching configuration:", error);
      return res.status(500).json({ error: "Server error" });
    }
  });

  app.get("/api/map/list", async (req: Request, res: Response) => {
    try {
      const sessionToken = req.headers.authorization?.split(" ")[1];
      if (!sessionToken)
        return res.status(401).json({ error: "Missing session token" });

      const session = await magicLinkService.validateSession(
        sessionToken,
        "map",
      );
      if (!session)
        return res.status(401).json({ error: "Invalid or expired session" });

      const guildId = session.guild_id;

      const maps = await db
        .selectFrom(TABLE_NAMES.MAPS)
        .selectAll()
        .where("guild_id", "=", guildId)
        .where((eb) =>
          eb.or([
            eb("created_by", "=", session.discord_id),
            eb("is_public", "=", 1),
          ]),
        )
        .orderBy("updated_at", "desc")
        .execute();

      const mapsWithStats = await Promise.all(
        maps.map(async (m) => {
          const labelCount = await db
            .selectFrom(TABLE_NAMES.MAP_LABELS)
            .select(db.fn.count("id").as("count"))
            .where("map_id", "=", m.id)
            .executeTakeFirst();

          const ttCount = await db
            .selectFrom(TABLE_NAMES.MAP_TERRITORIES)
            .select(db.fn.count("territory_id").as("count"))
            .where("map_id", "=", m.id)
            .executeTakeFirst();

          return {
            ...m,
            labelCount: Number(labelCount?.count || 0),
            ttCount: Number(ttCount?.count || 0),
          };
        }),
      );

      return res.json(mapsWithStats);
    } catch (error) {
      console.error("[HTTP] Error listing maps:", error);
      return res.status(500).json({ error: "Server error" });
    }
  });

  app.get("/api/map/channels", async (req: Request, res: Response) => {
    try {
      const sessionToken = req.headers.authorization?.split(" ")[1];
      if (!sessionToken)
        return res.status(401).json({ error: "Missing session token" });

      const session = await magicLinkService.validateSession(
        sessionToken,
        "map",
      );
      if (!session || !session.guild_id)
        return res.status(401).json({ error: "Invalid or expired session" });

      const guildId = session.guild_id;
      const guild = await client.guilds.fetch(guildId);
      const channels = await guild.channels.fetch();

      const textChannels = Array.from(channels.values())
        .filter((c) => c && c.isTextBased())
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .map((c: any) => ({ id: c.id, name: c.name }));

      return res.json(textChannels);
    } catch (error) {
      console.error("[HTTP] Error fetching channels for map:", error);
      return res.status(500).json({ error: "Server error" });
    }
  });

  app.get("/api/map/:id/history", async (req: Request, res: Response) => {
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
          error: "Forbidden: You do not have access to this map's history",
        });
      }

      const history = await db
        .selectFrom(TABLE_NAMES.MAP_HISTORY)
        .selectAll()
        .where("map_id", "=", id)
        .orderBy("created_at", "desc")
        .limit(20)
        .execute();

      return res.json({ success: true, history });
    } catch (error) {
      console.error("[HTTP] Error fetching map history:", error);
      return res.status(500).json({ error: "Server error" });
    }
  });
}
