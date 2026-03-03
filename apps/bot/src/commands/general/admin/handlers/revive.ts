import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  EmbedBuilder,
  MessageFlags,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  type ButtonInteraction,
  type ChannelSelectMenuInteraction,
  type Client,
  type ModalSubmitInteraction,
  type StringSelectMenuInteraction,
} from "discord.js";
import { TABLE_NAMES } from "@sentinel/shared";
import { supabase } from "../../../../lib/supabase.js";
import { getGuildApiKeys } from "../../../../lib/guild-api-keys.js";
import { tornApi } from "../../../../services/torn-client.js";

const REVIVE_REQUEST_TTL_SECONDS = 300;
const REVIVE_MAINTENANCE_INTERVAL_MS = 60000;

let reviveMaintenanceTimer: NodeJS.Timeout | null = null;
let reviveMaintenanceRunning = false;

type ReviveConfig = {
  guild_id: string;
  request_channel_id: string | null;
  requests_output_channel_id: string | null;
  min_hospital_seconds_left: number;
  request_message_id: string | null;
};

type ReviveRequest = {
  id: number;
  guild_id: string;
  requester_discord_id: string;
  request_channel_id: string | null;
  request_message_id: string | null;
  requester_torn_id: number | null;
  requester_torn_name: string | null;
  revivable: boolean | null;
  status_description: string | null;
  status_details: string | null;
  status_state: string | null;
  hospital_until: number | null;
  hospital_seconds_left: number | null;
  faction_id: number | null;
  last_action_status: string | null;
  last_action_relative: string | null;
  last_action_timestamp: number | null;
  state: "active" | "completed" | "cancelled" | "expired";
  expires_at: string;
};

function secondsToHuman(seconds: number): string {
  if (seconds <= 0) return "0m";

  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  if (hours > 0 && minutes > 0) {
    return `${hours}h ${minutes}m`;
  }
  if (hours > 0) {
    return `${hours}h`;
  }
  return `${minutes}m`;
}

function getStateMeta(state: ReviveRequest["state"]): {
  color: number;
  titlePrefix: string;
} {
  if (state === "completed") {
    return { color: 0x22c55e, titlePrefix: "Revive Completed" };
  }
  if (state === "cancelled") {
    return { color: 0x64748b, titlePrefix: "Revive Cancelled" };
  }
  if (state === "expired") {
    return { color: 0xef4444, titlePrefix: "Revive Expired" };
  }

  return { color: 0xf59e0b, titlePrefix: "Revive Request" };
}

function buildRequestPanelEmbed(config: ReviveConfig): EmbedBuilder {
  const minHosp = secondsToHuman(config.min_hospital_seconds_left);

  return new EmbedBuilder()
    .setColor(0x8b5cf6)
    .setTitle("Revive Requests")
    .setDescription("Press **Revive Me** to post a revive request.")
    .addFields(
      {
        name: "Minimum Hospital Time Left",
        value: minHosp,
        inline: true,
      },
      {
        name: "Requests Channel",
        value: config.requests_output_channel_id
          ? `<#${config.requests_output_channel_id}>`
          : "Not configured",
        inline: true,
      },
    )
    .setFooter({
      text: "Only one active request per user. Requests auto-expire after 5 minutes.",
    });
}

function buildRequestPanelRow(): ActionRowBuilder<ButtonBuilder> {
  const requestBtn = new ButtonBuilder()
    .setCustomId("revive_request_me")
    .setLabel("Revive Me")
    .setStyle(ButtonStyle.Danger);

  return new ActionRowBuilder<ButtonBuilder>().addComponents(requestBtn);
}

function buildReviveRequestEmbed(
  request: ReviveRequest,
  actorDiscordId?: string,
): EmbedBuilder {
  const stateMeta = getStateMeta(request.state);
  const profileLink = request.requester_torn_id
    ? `https://www.torn.com/profiles.php?XID=${request.requester_torn_id}`
    : null;

  const timeLeft = request.hospital_seconds_left
    ? secondsToHuman(request.hospital_seconds_left)
    : "Unknown";

  const base = new EmbedBuilder()
    .setColor(stateMeta.color)
    .setTitle(
      `${stateMeta.titlePrefix}${request.requester_torn_name ? ` · ${request.requester_torn_name}` : ""}${request.requester_torn_id ? ` [${request.requester_torn_id}]` : ""}`,
    )
    .addFields(
      {
        name: "Requested By",
        value: `<@${request.requester_discord_id}>`,
        inline: true,
      },
      {
        name: "Hospital Time Left",
        value: timeLeft,
        inline: true,
      },
      {
        name: "Revivable",
        value: request.revivable ? "Yes" : "No",
        inline: true,
      },
      {
        name: "Status",
        value: request.status_description || request.status_state || "Unknown",
        inline: true,
      },
      {
        name: "Last Action",
        value:
          request.last_action_relative ||
          request.last_action_status ||
          "Unknown",
        inline: true,
      },
      {
        name: "Faction",
        value: request.faction_id ? String(request.faction_id) : "None",
        inline: true,
      },
    )
    .setTimestamp();

  if (profileLink) {
    base.setDescription(`[Open Torn Profile](${profileLink})`);
  }

  if (request.state === "active") {
    const expiresUnix = Math.floor(
      new Date(request.expires_at).getTime() / 1000,
    );
    base.addFields({
      name: "Expires",
      value: `<t:${expiresUnix}:R>`,
      inline: false,
    });
  }

  if (request.status_details) {
    base.addFields({
      name: "Status Details",
      value: request.status_details,
      inline: false,
    });
  }

  if (actorDiscordId && request.state !== "active") {
    const label =
      request.state === "completed"
        ? "Completed By"
        : request.state === "cancelled"
          ? "Cancelled By"
          : "Expired";

    base.addFields({
      name: label,
      value:
        request.state === "expired"
          ? "Auto-expired after 5 minutes"
          : `<@${actorDiscordId}>`,
      inline: false,
    });
  }

  return base;
}

function buildActiveRequestRow(
  requestId: number,
): ActionRowBuilder<ButtonBuilder> {
  const revivedBtn = new ButtonBuilder()
    .setCustomId(`revive_mark_revived|${requestId}`)
    .setLabel("Mark as Revived")
    .setStyle(ButtonStyle.Success);

  return new ActionRowBuilder<ButtonBuilder>().addComponents(revivedBtn);
}

function buildResolvedRequestRow(
  requestId: number,
  state: ReviveRequest["state"],
): ActionRowBuilder<ButtonBuilder> {
  const label =
    state === "completed"
      ? "Revived"
      : state === "cancelled"
        ? "Cancelled"
        : "Expired";

  const revivedBtn = new ButtonBuilder()
    .setCustomId(`revive_mark_revived|${requestId}`)
    .setLabel(label)
    .setStyle(ButtonStyle.Secondary)
    .setDisabled(true);

  return new ActionRowBuilder<ButtonBuilder>().addComponents(revivedBtn);
}

async function getReviveConfig(guildId: string): Promise<ReviveConfig> {
  const { data } = await supabase
    .from(TABLE_NAMES.REVIVE_CONFIG)
    .select("*")
    .eq("guild_id", guildId)
    .maybeSingle();

  return {
    guild_id: guildId,
    request_channel_id: data?.request_channel_id ?? null,
    requests_output_channel_id: data?.requests_output_channel_id ?? null,
    min_hospital_seconds_left: data?.min_hospital_seconds_left ?? 0,
    request_message_id: data?.request_message_id ?? null,
  };
}

async function upsertReviveConfig(
  guildId: string,
  values: Partial<Omit<ReviveConfig, "guild_id">>,
): Promise<void> {
  await supabase.from(TABLE_NAMES.REVIVE_CONFIG).upsert(
    {
      guild_id: guildId,
      ...values,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "guild_id" },
  );
}

async function safeFetchTextChannel(client: Client, channelId: string) {
  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel || !channel.isTextBased() || channel.isDMBased()) {
    return null;
  }
  return channel;
}

async function ensureReviveRequestPanel(
  client: Client,
  guildId: string,
): Promise<{ ok: boolean; reason?: string }> {
  const config = await getReviveConfig(guildId);

  if (!config.request_channel_id) {
    return { ok: false, reason: "request channel not configured" };
  }

  const channel = await safeFetchTextChannel(client, config.request_channel_id);
  if (!channel) {
    return { ok: false, reason: "request channel unavailable" };
  }

  const embed = buildRequestPanelEmbed(config);
  const row = buildRequestPanelRow();

  if (config.request_message_id) {
    const existingMessage = await channel.messages
      .fetch(config.request_message_id)
      .catch(() => null);

    if (existingMessage) {
      await existingMessage.edit({ embeds: [embed], components: [row] });
      return { ok: true };
    }
  }

  const newMessage = await channel.send({ embeds: [embed], components: [row] });
  await upsertReviveConfig(guildId, { request_message_id: newMessage.id });
  return { ok: true };
}

async function syncReviveRequestMessage(
  client: Client,
  request: ReviveRequest,
  actorDiscordId?: string,
): Promise<void> {
  if (!request.request_channel_id || !request.request_message_id) {
    return;
  }

  const channel = await safeFetchTextChannel(
    client,
    request.request_channel_id,
  );
  if (!channel) {
    return;
  }

  const message = await channel.messages
    .fetch(request.request_message_id)
    .catch(() => null);
  if (!message) {
    return;
  }

  const embed = buildReviveRequestEmbed(request, actorDiscordId);
  const row =
    request.state === "active"
      ? buildActiveRequestRow(request.id)
      : buildResolvedRequestRow(request.id, request.state);

  await message.edit({ embeds: [embed], components: [row] });
}

async function expireRequestsForGuild(
  guildId: string,
  client: Client,
): Promise<void> {
  const nowIso = new Date().toISOString();

  const { data: expiredRows } = await supabase
    .from(TABLE_NAMES.REVIVE_REQUESTS)
    .select("*")
    .eq("guild_id", guildId)
    .eq("state", "active")
    .lte("expires_at", nowIso);

  if (!expiredRows || expiredRows.length === 0) {
    return;
  }

  for (const row of expiredRows) {
    await supabase
      .from(TABLE_NAMES.REVIVE_REQUESTS)
      .update({ state: "expired", updated_at: new Date().toISOString() })
      .eq("id", row.id)
      .eq("state", "active");

    await syncReviveRequestMessage(
      client,
      { ...row, state: "expired" },
      undefined,
    );
  }
}

export async function handleShowReviveSettings(
  interaction:
    | ButtonInteraction
    | StringSelectMenuInteraction
    | ChannelSelectMenuInteraction,
  isAlreadyDeferred: boolean = false,
): Promise<void> {
  try {
    if (!isAlreadyDeferred) {
      await interaction.deferUpdate();
    }

    const guildId = interaction.guildId;
    if (!guildId) return;

    const config = await getReviveConfig(guildId);

    if (config.request_channel_id) {
      await ensureReviveRequestPanel(interaction.client, guildId);
    }

    const latestConfig = await getReviveConfig(guildId);

    const embed = new EmbedBuilder()
      .setColor(0x8b5cf6)
      .setTitle("Revive Settings")
      .addFields(
        {
          name: "Request Panel Channel",
          value: latestConfig.request_channel_id
            ? `<#${latestConfig.request_channel_id}>`
            : "Not configured",
          inline: false,
        },
        {
          name: "Requests Output Channel",
          value: latestConfig.requests_output_channel_id
            ? `<#${latestConfig.requests_output_channel_id}>`
            : "Not configured",
          inline: false,
        },
        {
          name: "Minimum Hospital Time Left",
          value: secondsToHuman(latestConfig.min_hospital_seconds_left),
          inline: false,
        },
        {
          name: "Panel Message",
          value: latestConfig.request_message_id
            ? `Configured (${latestConfig.request_message_id})`
            : "Not posted yet",
          inline: false,
        },
      );

    const setRequestChannelBtn = new ButtonBuilder()
      .setCustomId("revive_set_request_channel")
      .setLabel("Set Request Panel Channel")
      .setStyle(ButtonStyle.Primary);

    const setOutputChannelBtn = new ButtonBuilder()
      .setCustomId("revive_set_output_channel")
      .setLabel("Set Requests Output Channel")
      .setStyle(ButtonStyle.Primary);

    const setMinHospBtn = new ButtonBuilder()
      .setCustomId("revive_set_min_hosp")
      .setLabel("Set Min Hospital Time")
      .setStyle(ButtonStyle.Primary);

    const refreshPanelBtn = new ButtonBuilder()
      .setCustomId("revive_refresh_panel")
      .setLabel("Refresh Request Panel")
      .setStyle(ButtonStyle.Secondary);

    const backBtn = new ButtonBuilder()
      .setCustomId("config_back_to_menu")
      .setLabel("Back")
      .setStyle(ButtonStyle.Secondary);

    const row1 = new ActionRowBuilder<ButtonBuilder>().addComponents(
      setRequestChannelBtn,
      setOutputChannelBtn,
    );
    const row2 = new ActionRowBuilder<ButtonBuilder>().addComponents(
      setMinHospBtn,
      refreshPanelBtn,
      backBtn,
    );

    await interaction.editReply({ embeds: [embed], components: [row1, row2] });
  } catch (error) {
    console.error("Error showing revive settings:", error);
  }
}

export async function handleReviveSetRequestChannel(
  interaction: ButtonInteraction,
): Promise<void> {
  try {
    await interaction.deferUpdate();

    const embed = new EmbedBuilder()
      .setColor(0x8b5cf6)
      .setTitle("Select Request Panel Channel")
      .setDescription(
        "Pick the channel where the persistent revive request panel should live.",
      );

    const channelSelect =
      new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(
        new ChannelSelectMenuBuilder()
          .setCustomId("revive_request_channel_select")
          .setPlaceholder("Select a text channel")
          .addChannelTypes(ChannelType.GuildText),
      );

    const backBtn = new ButtonBuilder()
      .setCustomId("revive_settings_show")
      .setLabel("Back")
      .setStyle(ButtonStyle.Secondary);

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(backBtn);

    await interaction.editReply({
      embeds: [embed],
      components: [channelSelect, row],
    });
  } catch (error) {
    console.error("Error in revive request channel button:", error);
  }
}

export async function handleReviveSetOutputChannel(
  interaction: ButtonInteraction,
): Promise<void> {
  try {
    await interaction.deferUpdate();

    const embed = new EmbedBuilder()
      .setColor(0x8b5cf6)
      .setTitle("Select Requests Output Channel")
      .setDescription(
        "Pick the channel where active revive request embeds will be posted.",
      );

    const channelSelect =
      new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(
        new ChannelSelectMenuBuilder()
          .setCustomId("revive_output_channel_select")
          .setPlaceholder("Select a text channel")
          .addChannelTypes(ChannelType.GuildText),
      );

    const backBtn = new ButtonBuilder()
      .setCustomId("revive_settings_show")
      .setLabel("Back")
      .setStyle(ButtonStyle.Secondary);

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(backBtn);

    await interaction.editReply({
      embeds: [embed],
      components: [channelSelect, row],
    });
  } catch (error) {
    console.error("Error in revive output channel button:", error);
  }
}

export async function handleReviveRequestChannelSelect(
  interaction: ChannelSelectMenuInteraction,
): Promise<void> {
  try {
    await interaction.deferUpdate();

    const guildId = interaction.guildId;
    const channelId = interaction.values[0];
    if (!guildId || !channelId) return;

    await upsertReviveConfig(guildId, {
      request_channel_id: channelId,
      request_message_id: null,
    });

    await ensureReviveRequestPanel(interaction.client, guildId);

    await handleShowReviveSettings(interaction, true);
  } catch (error) {
    console.error("Error in revive request channel select:", error);
  }
}

export async function handleReviveOutputChannelSelect(
  interaction: ChannelSelectMenuInteraction,
): Promise<void> {
  try {
    await interaction.deferUpdate();

    const guildId = interaction.guildId;
    const channelId = interaction.values[0];
    if (!guildId || !channelId) return;

    await upsertReviveConfig(guildId, {
      requests_output_channel_id: channelId,
    });

    await handleShowReviveSettings(interaction, true);
  } catch (error) {
    console.error("Error in revive output channel select:", error);
  }
}

export async function handleReviveSetMinHospButton(
  interaction: ButtonInteraction,
): Promise<void> {
  const modal = new ModalBuilder()
    .setCustomId("revive_min_hosp_modal")
    .setTitle("Revive Minimum Hospital Time");

  const input = new TextInputBuilder()
    .setCustomId("min_hospital_minutes")
    .setLabel("Minimum hospital time left (minutes)")
    .setPlaceholder("0")
    .setRequired(true)
    .setMaxLength(4)
    .setStyle(TextInputStyle.Short);

  const row = new ActionRowBuilder<TextInputBuilder>().addComponents(input);
  modal.addComponents(row);

  await interaction.showModal(modal);
}

export async function handleReviveSetMinHospModal(
  interaction: ModalSubmitInteraction,
): Promise<void> {
  try {
    await interaction.deferUpdate();

    const guildId = interaction.guildId;
    if (!guildId) return;

    const value = interaction.fields
      .getTextInputValue("min_hospital_minutes")
      .trim();
    const minutes = Number.parseInt(value, 10);

    if (Number.isNaN(minutes) || minutes < 0 || minutes > 10080) {
      await interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setColor(0xef4444)
            .setTitle("Invalid Value")
            .setDescription(
              "Please provide a value between 0 and 10080 minutes.",
            ),
        ],
        components: [],
      });
      return;
    }

    await upsertReviveConfig(guildId, {
      min_hospital_seconds_left: minutes * 60,
    });

    await ensureReviveRequestPanel(interaction.client, guildId);

    await handleShowReviveSettings(
      interaction as unknown as ButtonInteraction,
      true,
    );
  } catch (error) {
    console.error("Error in revive min hosp modal:", error);
  }
}

export async function handleReviveRefreshPanel(
  interaction: ButtonInteraction,
): Promise<void> {
  try {
    await interaction.deferUpdate();

    const guildId = interaction.guildId;
    if (!guildId) return;

    const result = await ensureReviveRequestPanel(interaction.client, guildId);

    if (!result.ok) {
      await interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setColor(0xef4444)
            .setTitle("Unable to refresh panel")
            .setDescription(result.reason || "Unknown error"),
        ],
        components: [],
      });
      return;
    }

    await handleShowReviveSettings(interaction, true);
  } catch (error) {
    console.error("Error refreshing revive panel:", error);
  }
}

async function getActiveRequestByUser(
  guildId: string,
  discordId: string,
): Promise<ReviveRequest | null> {
  const { data } = await supabase
    .from(TABLE_NAMES.REVIVE_REQUESTS)
    .select("*")
    .eq("guild_id", guildId)
    .eq("requester_discord_id", discordId)
    .eq("state", "active")
    .maybeSingle();

  return (data as ReviveRequest | null) ?? null;
}

async function sendTempEphemeralError(
  interaction: ButtonInteraction,
  title: string,
  description: string,
): Promise<void> {
  await interaction.reply({
    embeds: [
      new EmbedBuilder()
        .setColor(0xef4444)
        .setTitle(title)
        .setDescription(description),
    ],
    flags: MessageFlags.Ephemeral,
  });

  setTimeout(() => {
    void interaction.deleteReply().catch(() => {
      // Ignore cleanup errors
    });
  }, 8000);
}

export async function handleReviveRequestMe(
  interaction: ButtonInteraction,
): Promise<void> {
  try {
    const guildId = interaction.guildId;
    if (!guildId) {
      await sendTempEphemeralError(
        interaction,
        "Request Failed",
        "This action can only be used in a server.",
      );
      return;
    }

    await expireRequestsForGuild(guildId, interaction.client);

    const activeRequest = await getActiveRequestByUser(
      guildId,
      interaction.user.id,
    );
    if (activeRequest) {
      await sendTempEphemeralError(
        interaction,
        "Active Request Found",
        "You already have an active revive request.",
      );
      return;
    }

    const config = await getReviveConfig(guildId);
    if (!config.requests_output_channel_id) {
      await sendTempEphemeralError(
        interaction,
        "Requests Channel Not Configured",
        "An admin needs to set the revive requests output channel in /config first.",
      );
      return;
    }

    const outputChannel = await safeFetchTextChannel(
      interaction.client,
      config.requests_output_channel_id,
    );

    if (!outputChannel) {
      await sendTempEphemeralError(
        interaction,
        "Requests Channel Unavailable",
        "I could not access the configured revive requests channel.",
      );
      return;
    }

    const { data: verifiedUser } = await supabase
      .from(TABLE_NAMES.VERIFIED_USERS)
      .select("torn_id, torn_name")
      .eq("discord_id", interaction.user.id)
      .maybeSingle();

    if (!verifiedUser?.torn_id) {
      await sendTempEphemeralError(
        interaction,
        "Not Verified",
        "You need to run /verify first before requesting a revive.",
      );
      return;
    }

    const apiKeys = await getGuildApiKeys(guildId);
    const apiKey = apiKeys[0];

    if (!apiKey) {
      await sendTempEphemeralError(
        interaction,
        "API Key Missing",
        "This guild has no active Torn API key configured for revive checks.",
      );
      return;
    }

    const profileResponse = await tornApi.get("/user/{id}/profile", {
      apiKey,
      pathParams: { id: String(verifiedUser.torn_id) },
    });

    const profile = profileResponse.profile;
    const statusUntil = profile?.status?.until || null;
    const nowUnix = Math.floor(Date.now() / 1000);
    const hospitalSecondsLeft = statusUntil
      ? Math.max(0, statusUntil - nowUnix)
      : 0;

    if (profile?.status?.state !== "Hospital") {
      await sendTempEphemeralError(
        interaction,
        "Not Hospitalized",
        "You must be in hospital to create a revive request.",
      );
      return;
    }

    if (!profile?.revivable) {
      await sendTempEphemeralError(
        interaction,
        "Not Revivable",
        "Your profile is currently not revivable.",
      );
      return;
    }

    if (hospitalSecondsLeft < (config.min_hospital_seconds_left || 0)) {
      await sendTempEphemeralError(
        interaction,
        "Hospital Time Too Low",
        `You need at least ${secondsToHuman(config.min_hospital_seconds_left)} hospital time left to request a revive.`,
      );
      return;
    }

    const expiresAt = new Date(
      Date.now() + REVIVE_REQUEST_TTL_SECONDS * 1000,
    ).toISOString();

    const { data: inserted, error: insertError } = await supabase
      .from(TABLE_NAMES.REVIVE_REQUESTS)
      .insert({
        guild_id: guildId,
        requester_discord_id: interaction.user.id,
        request_channel_id: config.requests_output_channel_id,
        requester_torn_id: profile.id,
        requester_torn_name: profile.name,
        revivable: profile.revivable,
        status_description: profile.status?.description || null,
        status_details: profile.status?.details || null,
        status_state: profile.status?.state || null,
        hospital_until: profile.status?.until || null,
        hospital_seconds_left: hospitalSecondsLeft,
        faction_id: profile.faction_id || null,
        last_action_status: profile.last_action?.status || null,
        last_action_relative: profile.last_action?.relative || null,
        last_action_timestamp: profile.last_action?.timestamp || null,
        state: "active",
        expires_at: expiresAt,
      })
      .select("*")
      .single();

    if (insertError || !inserted) {
      await sendTempEphemeralError(
        interaction,
        "Request Failed",
        "I couldn't create your revive request. Please try again.",
      );
      return;
    }

    const request = inserted as ReviveRequest;

    const postedMessage = await outputChannel
      .send({
        embeds: [buildReviveRequestEmbed(request)],
        components: [buildActiveRequestRow(request.id)],
      })
      .catch(async () => {
        await supabase
          .from(TABLE_NAMES.REVIVE_REQUESTS)
          .delete()
          .eq("id", request.id);
        return null;
      });

    if (!postedMessage) {
      await sendTempEphemeralError(
        interaction,
        "Request Failed",
        "I couldn't post your request to the revive channel.",
      );
      return;
    }

    await supabase
      .from(TABLE_NAMES.REVIVE_REQUESTS)
      .update({
        request_message_id: postedMessage.id,
        updated_at: new Date().toISOString(),
      })
      .eq("id", request.id);

    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(0x22c55e)
          .setTitle("Revive Request Posted")
          .setDescription(
            `Your revive request was posted in <#${config.requests_output_channel_id}>.`,
          ),
      ],
      components: [
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder()
            .setCustomId(`revive_cancel_request|${request.id}`)
            .setLabel("Cancel Request")
            .setStyle(ButtonStyle.Secondary),
        ),
      ],
      flags: MessageFlags.Ephemeral,
    });
  } catch (error) {
    console.error("Error handling revive request button:", error);
    if (!interaction.replied && !interaction.deferred) {
      await sendTempEphemeralError(
        interaction,
        "Request Failed",
        "Something went wrong while creating your revive request.",
      );
    }
  }
}

export async function handleReviveCancelRequest(
  interaction: ButtonInteraction,
): Promise<void> {
  try {
    await interaction.deferUpdate();

    const requestId = Number.parseInt(
      interaction.customId.split("|")[1] || "",
      10,
    );
    if (!requestId) {
      await interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setColor(0xef4444)
            .setTitle("Invalid Request")
            .setDescription("Could not identify this revive request."),
        ],
        components: [],
      });
      return;
    }

    const { data: requestRow } = await supabase
      .from(TABLE_NAMES.REVIVE_REQUESTS)
      .select("*")
      .eq("id", requestId)
      .maybeSingle();

    const request = requestRow as ReviveRequest | null;

    if (!request || request.state !== "active") {
      await interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setColor(0x64748b)
            .setTitle("Already Resolved")
            .setDescription("This revive request is no longer active."),
        ],
        components: [],
      });
      return;
    }

    if (request.requester_discord_id !== interaction.user.id) {
      await interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setColor(0xef4444)
            .setTitle("Not Allowed")
            .setDescription(
              "Only the requester can cancel this revive request.",
            ),
        ],
        components: [],
      });
      return;
    }

    await supabase
      .from(TABLE_NAMES.REVIVE_REQUESTS)
      .update({
        state: "cancelled",
        cancelled_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", requestId)
      .eq("state", "active");

    const updatedRequest: ReviveRequest = { ...request, state: "cancelled" };
    await syncReviveRequestMessage(
      interaction.client,
      updatedRequest,
      interaction.user.id,
    );

    await interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setColor(0x64748b)
          .setTitle("Request Cancelled")
          .setDescription("Your revive request has been cancelled."),
      ],
      components: [],
    });
  } catch (error) {
    console.error("Error cancelling revive request:", error);
  }
}

export async function handleReviveMarkRevived(
  interaction: ButtonInteraction,
): Promise<void> {
  try {
    await interaction.deferUpdate();

    const requestId = Number.parseInt(
      interaction.customId.split("|")[1] || "",
      10,
    );
    if (!requestId) {
      await interaction.followUp({
        embeds: [
          new EmbedBuilder()
            .setColor(0xef4444)
            .setTitle("Invalid Request")
            .setDescription("Could not identify this revive request."),
        ],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const { data: requestRow } = await supabase
      .from(TABLE_NAMES.REVIVE_REQUESTS)
      .select("*")
      .eq("id", requestId)
      .maybeSingle();

    const request = requestRow as ReviveRequest | null;

    if (!request || request.state !== "active") {
      await interaction.followUp({
        embeds: [
          new EmbedBuilder()
            .setColor(0x64748b)
            .setTitle("Already Resolved")
            .setDescription("This revive request is no longer active."),
        ],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await supabase
      .from(TABLE_NAMES.REVIVE_REQUESTS)
      .update({
        state: "completed",
        completed_by_discord_id: interaction.user.id,
        completed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", requestId)
      .eq("state", "active");

    const updatedRequest: ReviveRequest = { ...request, state: "completed" };
    await syncReviveRequestMessage(
      interaction.client,
      updatedRequest,
      interaction.user.id,
    );

    await interaction.followUp({
      embeds: [
        new EmbedBuilder()
          .setColor(0x22c55e)
          .setTitle("Marked as Revived")
          .setDescription("This revive request has been marked as completed."),
      ],
      flags: MessageFlags.Ephemeral,
    });
  } catch (error) {
    console.error("Error marking revive request as completed:", error);
  }
}

async function expireRequestsGlobal(client: Client): Promise<void> {
  const nowIso = new Date().toISOString();

  const { data: expiredRows } = await supabase
    .from(TABLE_NAMES.REVIVE_REQUESTS)
    .select("*")
    .eq("state", "active")
    .lte("expires_at", nowIso);

  if (!expiredRows || expiredRows.length === 0) {
    return;
  }

  for (const row of expiredRows) {
    await supabase
      .from(TABLE_NAMES.REVIVE_REQUESTS)
      .update({
        state: "expired",
        updated_at: new Date().toISOString(),
      })
      .eq("id", row.id)
      .eq("state", "active");

    const expiredRequest = {
      ...(row as ReviveRequest),
      state: "expired" as const,
    };
    await syncReviveRequestMessage(client, expiredRequest);
  }
}

async function ensureAllRequestPanels(client: Client): Promise<void> {
  const { data: configs } = await supabase
    .from(TABLE_NAMES.REVIVE_CONFIG)
    .select("guild_id, request_channel_id")
    .not("request_channel_id", "is", null);

  if (!configs || configs.length === 0) {
    return;
  }

  for (const config of configs) {
    await ensureReviveRequestPanel(client, config.guild_id);
  }
}

async function runReviveMaintenance(client: Client): Promise<void> {
  if (reviveMaintenanceRunning) {
    return;
  }

  reviveMaintenanceRunning = true;

  try {
    await expireRequestsGlobal(client);
    await ensureAllRequestPanels(client);
  } catch (error) {
    console.error("Revive maintenance error:", error);
  } finally {
    reviveMaintenanceRunning = false;
  }
}

export function startReviveMaintenance(client: Client): void {
  if (reviveMaintenanceTimer) {
    return;
  }

  reviveMaintenanceTimer = setInterval(() => {
    void runReviveMaintenance(client);
  }, REVIVE_MAINTENANCE_INTERVAL_MS);

  void runReviveMaintenance(client);
  console.log("[Revive] Maintenance scheduler started");
}
