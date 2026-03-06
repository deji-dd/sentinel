import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  EmbedBuilder,
  RoleSelectMenuBuilder,
  type ButtonInteraction,
  type ChannelSelectMenuInteraction,
  type RoleSelectMenuInteraction,
  type StringSelectMenuInteraction,
} from "discord.js";
import { TABLE_NAMES } from "@sentinel/shared";
import { supabase } from "../../../../lib/supabase.js";

type AssistConfig = {
  guild_id: string;
  assist_channel_id: string | null;
  ping_role_id: string | null;
  script_generation_role_ids: string[];
  is_active: boolean;
};

async function getAssistConfig(guildId: string): Promise<AssistConfig> {
  const { data } = await supabase
    .from(TABLE_NAMES.ASSIST_CONFIG)
    .select("*")
    .eq("guild_id", guildId)
    .maybeSingle();

  return {
    guild_id: guildId,
    assist_channel_id: data?.assist_channel_id ?? null,
    ping_role_id: data?.ping_role_id ?? null,
    script_generation_role_ids: data?.script_generation_role_ids ?? [],
    is_active: data?.is_active ?? true,
  };
}

async function upsertAssistConfig(
  guildId: string,
  values: Partial<Omit<AssistConfig, "guild_id">>,
): Promise<void> {
  await supabase.from(TABLE_NAMES.ASSIST_CONFIG).upsert(
    {
      guild_id: guildId,
      ...values,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "guild_id" },
  );
}

export async function handleShowAssistSettings(
  interaction:
    | ButtonInteraction
    | StringSelectMenuInteraction
    | ChannelSelectMenuInteraction
    | RoleSelectMenuInteraction,
  isAlreadyDeferred: boolean = false,
): Promise<void> {
  try {
    if (!isAlreadyDeferred) {
      await interaction.deferUpdate();
    }

    const guildId = interaction.guildId;
    if (!guildId) {
      return;
    }

    const { data: guildConfig } = await supabase
      .from(TABLE_NAMES.GUILD_CONFIG)
      .select("enabled_modules")
      .eq("guild_id", guildId)
      .maybeSingle();

    const enabledModules: string[] = guildConfig?.enabled_modules || [];
    if (!enabledModules.includes("assist")) {
      await interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setColor(0xf59e0b)
            .setTitle("Assist Module Disabled")
            .setDescription(
              "This guild has not enabled the assist module yet. Use personal admin module management to enable it first.",
            ),
        ],
        components: [],
      });
      return;
    }

    const config = await getAssistConfig(guildId);

    const embed = new EmbedBuilder()
      .setColor(0x2563eb)
      .setTitle("Assist Settings")
      .setDescription(
        "Configure where combat assist alerts from the proxied script pipeline are posted.",
      )
      .addFields(
        {
          name: "Output Channel",
          value: config.assist_channel_id
            ? `<#${config.assist_channel_id}>`
            : "Not configured",
          inline: false,
        },
        {
          name: "Ping Role",
          value: config.ping_role_id ? `<@&${config.ping_role_id}>` : "None",
          inline: false,
        },
        {
          name: "Script Generation Roles",
          value:
            config.script_generation_role_ids.length > 0
              ? config.script_generation_role_ids
                  .map((id) => `<@&${id}>`)
                  .join(", ")
              : "None (Admins only)",
          inline: false,
        },
        {
          name: "Module Active",
          value: config.is_active ? "Yes" : "No",
          inline: false,
        },
      );

    const setChannelBtn = new ButtonBuilder()
      .setCustomId("assist_set_channel")
      .setLabel("Set Output Channel")
      .setStyle(ButtonStyle.Primary);

    const setRoleBtn = new ButtonBuilder()
      .setCustomId("assist_set_ping_role")
      .setLabel("Set Ping Role")
      .setStyle(ButtonStyle.Primary);

    const setScriptRolesBtn = new ButtonBuilder()
      .setCustomId("assist_set_script_roles")
      .setLabel("Set Script Roles")
      .setStyle(ButtonStyle.Primary);

    const backBtn = new ButtonBuilder()
      .setCustomId("config_back_to_menu")
      .setLabel("Back")
      .setStyle(ButtonStyle.Secondary);

    const row1 = new ActionRowBuilder<ButtonBuilder>().addComponents(
      setChannelBtn,
      setRoleBtn,
      setScriptRolesBtn,
    );

    const row2 = new ActionRowBuilder<ButtonBuilder>().addComponents(backBtn);

    await interaction.editReply({
      embeds: [embed],
      components: [row1, row2],
    });
  } catch (error) {
    console.error("Error showing assist settings:", error);
  }
}

export async function handleAssistSetChannel(
  interaction: ButtonInteraction,
): Promise<void> {
  try {
    await interaction.deferUpdate();

    const embed = new EmbedBuilder()
      .setColor(0x2563eb)
      .setTitle("Select Assist Output Channel")
      .setDescription(
        "Choose the channel where assist event embeds will be posted.",
      );

    const channelSelect =
      new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(
        new ChannelSelectMenuBuilder()
          .setCustomId("assist_channel_select")
          .setPlaceholder("Select a text channel")
          .addChannelTypes(ChannelType.GuildText),
      );

    const backRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId("assist_settings_show")
        .setLabel("Back")
        .setStyle(ButtonStyle.Secondary),
    );

    await interaction.editReply({
      embeds: [embed],
      components: [channelSelect, backRow],
    });
  } catch (error) {
    console.error("Error in assist set channel:", error);
  }
}

export async function handleAssistSetPingRole(
  interaction: ButtonInteraction,
): Promise<void> {
  try {
    await interaction.deferUpdate();

    const embed = new EmbedBuilder()
      .setColor(0x2563eb)
      .setTitle("Select Assist Ping Role")
      .setDescription(
        "Choose an optional role to ping for each assist alert. Leave empty to clear.",
      );

    const roleSelect =
      new ActionRowBuilder<RoleSelectMenuBuilder>().addComponents(
        new RoleSelectMenuBuilder()
          .setCustomId("assist_ping_role_select")
          .setPlaceholder("Select optional ping role")
          .setMinValues(0)
          .setMaxValues(1),
      );

    const backRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId("assist_settings_show")
        .setLabel("Back")
        .setStyle(ButtonStyle.Secondary),
    );

    await interaction.editReply({
      embeds: [embed],
      components: [roleSelect, backRow],
    });
  } catch (error) {
    console.error("Error in assist set ping role:", error);
  }
}

export async function handleAssistChannelSelect(
  interaction: ChannelSelectMenuInteraction,
): Promise<void> {
  try {
    await interaction.deferUpdate();

    const guildId = interaction.guildId;
    const channelId = interaction.values[0];
    if (!guildId || !channelId) {
      return;
    }

    await upsertAssistConfig(guildId, {
      assist_channel_id: channelId,
      is_active: true,
    });

    await handleShowAssistSettings(interaction, true);
  } catch (error) {
    console.error("Error in assist channel select:", error);
  }
}

export async function handleAssistPingRoleSelect(
  interaction: RoleSelectMenuInteraction,
): Promise<void> {
  try {
    await interaction.deferUpdate();

    const guildId = interaction.guildId;
    if (!guildId) {
      return;
    }

    const roleId = interaction.values[0] ?? null;

    await upsertAssistConfig(guildId, {
      ping_role_id: roleId,
      is_active: true,
    });

    await handleShowAssistSettings(interaction, true);
  } catch (error) {
    console.error("Error in assist ping role select:", error);
  }
}

export async function handleAssistSetScriptRoles(
  interaction: ButtonInteraction,
): Promise<void> {
  try {
    await interaction.deferUpdate();

    const embed = new EmbedBuilder()
      .setColor(0x2563eb)
      .setTitle("Select Script Generation Roles")
      .setDescription(
        "Choose roles that can generate assist script installation URLs. Leave empty for admins only.",
      );

    const roleSelect =
      new ActionRowBuilder<RoleSelectMenuBuilder>().addComponents(
        new RoleSelectMenuBuilder()
          .setCustomId("assist_script_roles_select")
          .setPlaceholder("Select roles (optional)")
          .setMinValues(0)
          .setMaxValues(10),
      );

    const backRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId("assist_settings_show")
        .setLabel("Back")
        .setStyle(ButtonStyle.Secondary),
    );

    await interaction.editReply({
      embeds: [embed],
      components: [roleSelect, backRow],
    });
  } catch (error) {
    console.error("Error in assist set script roles:", error);
  }
}

export async function handleAssistScriptRolesSelect(
  interaction: RoleSelectMenuInteraction,
): Promise<void> {
  try {
    await interaction.deferUpdate();

    const guildId = interaction.guildId;
    if (!guildId) {
      return;
    }

    const roleIds = interaction.values;

    await upsertAssistConfig(guildId, {
      script_generation_role_ids: roleIds,
      is_active: true,
    });

    await handleShowAssistSettings(interaction, true);
  } catch (error) {
    console.error("Error in assist script roles select:", error);
  }
}
