import { type Request, type Response } from "express";
import { EmbedBuilder } from "discord.js";
import { TABLE_NAMES } from "@sentinel/shared";
import { db } from "../../../lib/db-client.js";
import { type MapRoutesDeps } from "./map-types.js";

export function registerMapPublishRoutes({
  app,
  client,
  magicLinkService,
}: Pick<MapRoutesDeps, "app" | "client" | "magicLinkService">): void {
  app.post("/api/map/:id/publish", async (req: Request, res: Response) => {
    try {
      const sessionToken = req.headers.authorization?.split(" ")[1];
      const { id } = req.params;
      const { channelId } = req.body;

      if (!sessionToken)
        return res.status(401).json({ error: "Missing session token" });
      if (!channelId)
        return res.status(400).json({ error: "Missing channel ID" });

      const session = await magicLinkService.validateSession(
        sessionToken,
        "map",
      );
      if (!session)
        return res.status(401).json({ error: "Invalid or expired session" });

      const map = await db
        .selectFrom(TABLE_NAMES.MAPS)
        .selectAll()
        .where("id", "=", id)
        .executeTakeFirst();

      if (!map || map.guild_id !== session.guild_id) {
        return res.status(403).json({ error: "Forbidden or map not found" });
      }

      const guild = await client.guilds.fetch(session.guild_id);
      const channel = await guild.channels.fetch(channelId);

      if (!channel || !channel.isTextBased()) {
        return res.status(400).json({ error: "Invalid text channel" });
      }

      const labels = await db
        .selectFrom(TABLE_NAMES.MAP_LABELS)
        .selectAll()
        .where("map_id", "=", id)
        .execute();

      const assignments = await db
        .selectFrom(TABLE_NAMES.MAP_TERRITORIES)
        .select(["territory_id", "label_id"])
        .where("map_id", "=", id)
        .execute();

      const tids = assignments.map((a) => a.territory_id);

      const blueprints =
        tids.length > 0
          ? await db
              .selectFrom(TABLE_NAMES.TERRITORY_BLUEPRINT)
              .selectAll()
              .where("id", "in", tids)
              .execute()
          : [];

      const states =
        tids.length > 0
          ? await db
              .selectFrom(TABLE_NAMES.TERRITORY_STATE)
              .selectAll()
              .where("territory_id", "in", tids)
              .execute()
          : [];

      const embeds: EmbedBuilder[] = [];

      embeds.push(
        new EmbedBuilder()
          .setColor(0x3b82f6)
          .setTitle(map.name)
          .setDescription(
            `This configuration was published by <@${session.discord_id}> via Dashboard.`,
          )
          .setTimestamp(),
      );

      for (const label of labels) {
        const labelAssignments = assignments.filter(
          (a) => a.label_id === label.id,
        );
        if (labelAssignments.length === 0) continue;

        const lines = labelAssignments.map((a) => {
          const st = states.find((s) => s.territory_id === a.territory_id);
          let info = `• [**${a.territory_id}**](https://www.torn.com/city.php#territory=${a.territory_id})`;
          if (st?.racket_name)
            info += ` | ${st.racket_name} (L${st.racket_level})`;
          return info;
        });

        const totalRespect = labelAssignments.reduce((acc, a) => {
          const bp = blueprints.find((b) => b.id === a.territory_id);
          return acc + (bp?.respect || 0);
        }, 0);

        const sectors: Record<number, number> = {
          1: 0,
          2: 0,
          3: 0,
          4: 0,
          5: 0,
          6: 0,
          7: 0,
        };
        labelAssignments.forEach((a) => {
          const bp = blueprints.find((b) => b.id === a.territory_id);
          if (bp?.sector) sectors[bp.sector]++;
        });

        const sectorDistribution = [1, 2, 3, 4, 5, 6, 7]
          .map((s) => `**S${s}**: ${sectors[s]}`)
          .join(" | ");

        const value = lines.join("\n").substring(0, 2000);

        const labelEmbed = new EmbedBuilder()
          .setColor(parseInt(label.color_hex.replace("#", ""), 16) || 0x3b82f6)
          .setTitle(label.label_text)
          .setDescription(value)
          .addFields(
            { name: "Sectors", value: sectorDistribution, inline: false },
            {
              name: "Summary",
              value: `Territories: **${labelAssignments.length}**\nDaily Respect: **${totalRespect.toLocaleString()}**`,
              inline: true,
            },
          );

        embeds.push(labelEmbed);
      }

      if (embeds.length === 1) {
        embeds[0].setDescription(
          "This configuration has no territory assignments yet.",
        );
      }

      for (let i = 0; i < embeds.length; i += 10) {
        const chunk = embeds.slice(i, i + 10);
        await channel.send({ embeds: chunk });
      }

      return res.json({ success: true });
    } catch (error) {
      console.error("[HTTP] Error publishing map:", error);
      return res.status(500).json({ error: "Server error" });
    }
  });
}
