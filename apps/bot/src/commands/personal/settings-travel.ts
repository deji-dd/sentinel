import {
  ActionRowBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  EmbedBuilder,
  MessageFlags,
  StringSelectMenuBuilder,
  type StringSelectMenuInteraction,
  type ModalSubmitInteraction,
} from "discord.js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getAuthorizedUser } from "../../lib/auth.js";
import { TABLE_NAMES } from "@sentinel/shared";

export async function handleTravelSettings(
  interaction: StringSelectMenuInteraction,
  supabase: SupabaseClient,
) {
  const discordId = interaction.user.id;
  const userId = await getAuthorizedUser(supabase, discordId);

  if (!userId) {
    await interaction.update({
      content:
        "❌ Your account is no longer linked. Please run `/setup` again.",
      embeds: [],
      components: [],
    });
    return;
  }

  // Fetch or create settings
  let { data: settings } = await supabase
    .from(TABLE_NAMES.TRAVEL_SETTINGS)
    .select("*")
    .eq("user_id", userId)
    .single();

  // Create default settings if none exist
  if (!settings) {
    const { data: newSettings, error } = await supabase
      .from(TABLE_NAMES.TRAVEL_SETTINGS)
      .insert({
        user_id: userId,
        alert_cooldown_minutes: 60,
        blacklisted_items: [],
        blacklisted_categories: [],
      })
      .select()
      .single();

    if (error) {
      console.error("Error creating default settings:", error);
      await interaction.update({
        content: "❌ Failed to load settings. Please try again.",
        embeds: [],
        components: [],
      });
      return;
    }

    settings = newSettings;
  }

  // Fetch all categories for display
  const { data: allCategories } = await supabase
    .from(TABLE_NAMES.TORN_CATEGORIES)
    .select("id, name")
    .order("name");

  const categoryMap = new Map<number, string>();
  allCategories?.forEach((cat) => categoryMap.set(cat.id, cat.name));

  // Convert blacklisted category IDs to names for display
  const blacklistedCategoryNames = (settings.blacklisted_categories as number[])
    .map((id: number) => categoryMap.get(id))
    .filter((name): name is string => Boolean(name));

  // Fetch item names for blacklisted items
  const { data: items } = await supabase
    .from(TABLE_NAMES.TORN_ITEMS)
    .select("id, name")
    .in("id", settings.blacklisted_items as number[]);

  const itemMap = new Map<number, string>();
  items?.forEach((item) => itemMap.set(item.id, item.name));

  // Build settings display embed
  const embed = new EmbedBuilder()
    .setTitle("⚙️ Travel Settings")
    .setColor(0x0099ff)
    .addFields(
      {
        name: "Alerts Enabled",
        value: settings.alerts_enabled ? "✅ Yes" : "❌ No",
        inline: true,
      },
      {
        name: "Alert Cooldown",
        value: `${settings.alert_cooldown_minutes} minutes`,
        inline: true,
      },
      {
        name: "Min Profit Per Trip",
        value: settings.min_profit_per_trip
          ? `$${settings.min_profit_per_trip.toLocaleString()}`
          : "Not set",
        inline: true,
      },
      {
        name: "Min Profit Per Minute",
        value: settings.min_profit_per_minute
          ? `$${settings.min_profit_per_minute.toLocaleString()}`
          : "Not set",
        inline: true,
      },
      {
        name: "Blacklisted Items",
        value:
          settings.blacklisted_items.length > 0
            ? (settings.blacklisted_items as number[])
                .map((id) => itemMap.get(id) || `ID: ${id}`)
                .join(", ")
            : "None",
        inline: false,
      },
      {
        name: "Blacklisted Categories",
        value:
          blacklistedCategoryNames.length > 0
            ? blacklistedCategoryNames.join(", ")
            : "None",
        inline: false,
      },
    )
    .setFooter({ text: "Select a setting below to edit" });

  // Create select menu for choosing which setting to edit
  const selectMenu = new StringSelectMenuBuilder()
    .setCustomId("travel_setting_select")
    .setPlaceholder("Choose a setting to edit")
    .addOptions(
      {
        label: "Alerts Toggle",
        description: settings.alerts_enabled
          ? "Currently: Enabled"
          : "Currently: Disabled",
        value: "alerts_enabled",
        emoji: "🔔",
      },
      {
        label: "Alert Cooldown",
        description: `Current: ${settings.alert_cooldown_minutes} minutes`,
        value: "alert_cooldown",
        emoji: "⏰",
      },
      {
        label: "Min Profit Per Trip",
        description: settings.min_profit_per_trip
          ? `Current: $${settings.min_profit_per_trip.toLocaleString()}`
          : "Not set",
        value: "min_profit_trip",
        emoji: "💰",
      },
      {
        label: "Min Profit Per Minute",
        description: settings.min_profit_per_minute
          ? `Current: $${settings.min_profit_per_minute.toLocaleString()}`
          : "Not set",
        value: "min_profit_minute",
        emoji: "⏱️",
      },
      {
        label: "Item Blacklist",
        description:
          settings.blacklisted_items.length > 0
            ? `${settings.blacklisted_items.length} item(s) blacklisted`
            : "No items blacklisted",
        value: "blacklisted_items",
        emoji: "🚫",
      },
      {
        label: "Category Blacklist",
        description:
          settings.blacklisted_categories.length > 0
            ? `${settings.blacklisted_categories.length} category/ies blacklisted`
            : "No categories blacklisted",
        value: "blacklisted_categories",
        emoji: "📁",
      },
    );

  const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    selectMenu,
  );

  await interaction.update({
    content: "",
    embeds: [embed],
    components: [row],
  });
}

// Handler for when user selects a setting to edit
export async function handleTravelSettingSelect(
  interaction: StringSelectMenuInteraction,
  supabase: SupabaseClient,
) {
  const userId = await getAuthorizedUser(supabase, interaction.user.id);
  if (!userId) {
    await interaction.reply({
      content:
        "❌ Your account is no longer linked. Please run `/setup` again.",
      ...(interaction.guild && { flags: MessageFlags.Ephemeral }),
    });
    return;
  }

  const selectedSetting = interaction.values[0];

  if (selectedSetting === "alerts_enabled") {
    await handleToggleAlertsEnabled(interaction, supabase, userId);
  } else if (selectedSetting === "alert_cooldown") {
    await handleEditAlertCooldown(interaction, supabase, userId);
  } else if (selectedSetting === "min_profit_trip") {
    await handleEditMinProfitTrip(interaction, supabase, userId);
  } else if (selectedSetting === "min_profit_minute") {
    await handleEditMinProfitMinute(interaction, supabase, userId);
  } else if (selectedSetting === "blacklisted_items") {
    await handleEditBlacklistedItems(interaction, supabase, userId);
  } else if (selectedSetting === "blacklisted_categories") {
    await handleEditBlacklistedCategories(interaction, supabase, userId);
  }
}

// Setting edit handlers (now accept userId and StringSelectMenuInteraction)
async function handleToggleAlertsEnabled(
  interaction: StringSelectMenuInteraction,
  supabase: SupabaseClient,
  userId: string,
) {
  const { data: settings } = await supabase
    .from(TABLE_NAMES.TRAVEL_SETTINGS)
    .select("alerts_enabled")
    .eq("user_id", userId)
    .single();

  const newValue = !settings?.alerts_enabled;

  const { error } = await supabase
    .from(TABLE_NAMES.TRAVEL_SETTINGS)
    .update({ alerts_enabled: newValue })
    .eq("user_id", userId);

  if (error) {
    await interaction.reply({
      content: "❌ Failed to update alerts setting.",
      ...(interaction.guild && { flags: MessageFlags.Ephemeral }),
    });
    return;
  }

  await interaction.reply({
    content: newValue
      ? "✅ Travel alerts **enabled**. You will receive DMs when profitable opportunities are found."
      : "❌ Travel alerts **disabled**. You will not receive DM notifications.",
    ...(interaction.guild && { flags: MessageFlags.Ephemeral }),
  });
}

async function handleEditAlertCooldown(
  interaction: StringSelectMenuInteraction,
  supabase: SupabaseClient,
  userId: string,
) {
  const { data: settings } = await supabase
    .from(TABLE_NAMES.TRAVEL_SETTINGS)
    .select("alert_cooldown_minutes")
    .eq("user_id", userId)
    .single();

  const modal = new ModalBuilder()
    .setCustomId("modal_alert_cooldown")
    .setTitle("Edit Alert Cooldown");

  const input = new TextInputBuilder()
    .setCustomId("value")
    .setLabel("Alert Cooldown (minutes)")
    .setStyle(TextInputStyle.Short)
    .setPlaceholder("60")
    .setValue(settings?.alert_cooldown_minutes?.toString() || "60")
    .setRequired(true);

  modal.addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(input),
  );
  await interaction.showModal(modal);
}

async function handleEditMinProfitTrip(
  interaction: StringSelectMenuInteraction,
  supabase: SupabaseClient,
  userId: string,
) {
  const { data: settings } = await supabase
    .from(TABLE_NAMES.TRAVEL_SETTINGS)
    .select("min_profit_per_trip")
    .eq("user_id", userId)
    .single();

  const modal = new ModalBuilder()
    .setCustomId("modal_min_profit_trip")
    .setTitle("Edit Min Profit Per Trip");

  const input = new TextInputBuilder()
    .setCustomId("value")
    .setLabel("Minimum Profit Per Trip ($)")
    .setStyle(TextInputStyle.Short)
    .setPlaceholder("1000000 (leave empty to disable)")
    .setValue(settings?.min_profit_per_trip?.toString() || "")
    .setRequired(false);

  modal.addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(input),
  );
  await interaction.showModal(modal);
}

async function handleEditMinProfitMinute(
  interaction: StringSelectMenuInteraction,
  supabase: SupabaseClient,
  userId: string,
) {
  const { data: settings } = await supabase
    .from(TABLE_NAMES.TRAVEL_SETTINGS)
    .select("min_profit_per_minute")
    .eq("user_id", userId)
    .single();

  const modal = new ModalBuilder()
    .setCustomId("modal_min_profit_minute")
    .setTitle("Edit Min Profit Per Minute");

  const input = new TextInputBuilder()
    .setCustomId("value")
    .setLabel("Minimum Profit Per Minute ($)")
    .setStyle(TextInputStyle.Short)
    .setPlaceholder("10000 (leave empty to disable)")
    .setValue(settings?.min_profit_per_minute?.toString() || "")
    .setRequired(false);

  modal.addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(input),
  );
  await interaction.showModal(modal);
}

async function handleEditBlacklistedItems(
  interaction: StringSelectMenuInteraction,
  supabase: SupabaseClient,
  userId: string,
) {
  const { data: settings } = await supabase
    .from(TABLE_NAMES.TRAVEL_SETTINGS)
    .select("blacklisted_items")
    .eq("user_id", userId)
    .single();

  // Fetch item names
  const { data: items } = await supabase
    .from(TABLE_NAMES.TORN_ITEMS)
    .select("id, name")
    .in("id", (settings?.blacklisted_items as number[]) || []);

  const itemMap = new Map<number, string>();
  items?.forEach((item) => itemMap.set(item.id, item.name));

  const currentValue = (settings?.blacklisted_items as number[])
    .map((id) => itemMap.get(id) || id.toString())
    .join(", ");

  const modal = new ModalBuilder()
    .setCustomId("modal_blacklisted_items")
    .setTitle("Edit Item Blacklist");

  const input = new TextInputBuilder()
    .setCustomId("value")
    .setLabel("Blacklisted Items (names or IDs)")
    .setStyle(TextInputStyle.Paragraph)
    .setPlaceholder("Xanax, Vicodin, 206, 207\nUse /search item to find")
    .setValue(currentValue)
    .setRequired(false);

  modal.addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(input),
  );
  await interaction.showModal(modal);
}

async function handleEditBlacklistedCategories(
  interaction: StringSelectMenuInteraction,
  supabase: SupabaseClient,
  userId: string,
) {
  const { data: settings } = await supabase
    .from(TABLE_NAMES.TRAVEL_SETTINGS)
    .select("blacklisted_categories")
    .eq("user_id", userId)
    .single();

  const { data: categories } = await supabase
    .from(TABLE_NAMES.TORN_CATEGORIES)
    .select("id, name")
    .in("id", (settings?.blacklisted_categories as number[]) || []);

  const categoryMap = new Map<number, string>();
  categories?.forEach((cat) => categoryMap.set(cat.id, cat.name));

  const currentValue = (settings?.blacklisted_categories as number[])
    .map((id) => categoryMap.get(id) || id.toString())
    .join(", ");

  const modal = new ModalBuilder()
    .setCustomId("modal_blacklisted_categories")
    .setTitle("Edit Category Blacklist");

  const input = new TextInputBuilder()
    .setCustomId("value")
    .setLabel("Blacklisted Categories (names or IDs)")
    .setStyle(TextInputStyle.Paragraph)
    .setPlaceholder("Flowers, Plushies\nUse /search category to see all")
    .setValue(currentValue)
    .setRequired(false);

  modal.addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(input),
  );
  await interaction.showModal(modal);
}

// Modal submission handlers for individual settings
export async function handleModalAlertCooldown(
  interaction: ModalSubmitInteraction,
  supabase: SupabaseClient,
) {
  const userId = await getAuthorizedUser(supabase, interaction.user.id);
  if (!userId) {
    await interaction.reply({
      content: "❌ Your account is no longer linked.",
      ...(interaction.guild && { flags: MessageFlags.Ephemeral }),
    });
    return;
  }

  const value = parseInt(interaction.fields.getTextInputValue("value"));
  if (isNaN(value) || value < 15) {
    await interaction.reply({
      content:
        "❌ Invalid cooldown value. Must be at least 15 minutes to prevent spam.",
      ...(interaction.guild && { flags: MessageFlags.Ephemeral }),
    });
    return;
  }

  const { error } = await supabase
    .from(TABLE_NAMES.TRAVEL_SETTINGS)
    .update({ alert_cooldown_minutes: value })
    .eq("user_id", userId);

  if (error) {
    await interaction.reply({
      content: "❌ Failed to update setting.",
      ...(interaction.guild && { flags: MessageFlags.Ephemeral }),
    });
    return;
  }

  await interaction.reply({
    content: `✅ Alert cooldown updated to ${value} minutes.`,
    ...(interaction.guild && { flags: MessageFlags.Ephemeral }),
  });
}

export async function handleModalMinProfitTrip(
  interaction: ModalSubmitInteraction,
  supabase: SupabaseClient,
) {
  const userId = await getAuthorizedUser(supabase, interaction.user.id);
  if (!userId) {
    await interaction.reply({
      content: "❌ Your account is no longer linked.",
      ...(interaction.guild && { flags: MessageFlags.Ephemeral }),
    });
    return;
  }

  const valueStr = interaction.fields.getTextInputValue("value").trim();
  const value = valueStr ? parseInt(valueStr) : null;

  if (valueStr && (isNaN(value!) || value! < 100000)) {
    await interaction.reply({
      content:
        "❌ Invalid profit value. Must be at least $100,000 or empty to disable.",
      ...(interaction.guild && { flags: MessageFlags.Ephemeral }),
    });
    return;
  }

  const { error } = await supabase
    .from(TABLE_NAMES.TRAVEL_SETTINGS)
    .update({ min_profit_per_trip: value })
    .eq("user_id", userId);

  if (error) {
    await interaction.reply({
      content: "❌ Failed to update setting.",
      ...(interaction.guild && { flags: MessageFlags.Ephemeral }),
    });
    return;
  }

  await interaction.reply({
    content: value
      ? `✅ Minimum profit per trip set to $${value.toLocaleString()}.`
      : "✅ Minimum profit per trip filter disabled.",
    ...(interaction.guild && { flags: MessageFlags.Ephemeral }),
  });
}

export async function handleModalMinProfitMinute(
  interaction: ModalSubmitInteraction,
  supabase: SupabaseClient,
) {
  const userId = await getAuthorizedUser(supabase, interaction.user.id);
  if (!userId) {
    await interaction.reply({
      content: "❌ Your account is no longer linked.",
      ...(interaction.guild && { flags: MessageFlags.Ephemeral }),
    });
    return;
  }

  const valueStr = interaction.fields.getTextInputValue("value").trim();
  const value = valueStr ? parseInt(valueStr) : null;

  if (valueStr && (isNaN(value!) || value! < 1000)) {
    await interaction.reply({
      content:
        "❌ Invalid profit value. Must be at least $1,000 or empty to disable.",
      ...(interaction.guild && { flags: MessageFlags.Ephemeral }),
    });
    return;
  }

  const { error } = await supabase
    .from(TABLE_NAMES.TRAVEL_SETTINGS)
    .update({ min_profit_per_minute: value })
    .eq("user_id", userId);

  if (error) {
    await interaction.reply({
      content: "❌ Failed to update setting.",
      ...(interaction.guild && { flags: MessageFlags.Ephemeral }),
    });
    return;
  }

  await interaction.reply({
    content: value
      ? `✅ Minimum profit per minute set to $${value.toLocaleString()}.`
      : "✅ Minimum profit per minute filter disabled.",
    ...(interaction.guild && { flags: MessageFlags.Ephemeral }),
  });
}

export async function handleModalBlacklistedItems(
  interaction: ModalSubmitInteraction,
  supabase: SupabaseClient,
) {
  const userId = await getAuthorizedUser(supabase, interaction.user.id);
  if (!userId) {
    await interaction.reply({
      content: "❌ Your account is no longer linked.",
      ...(interaction.guild && { flags: MessageFlags.Ephemeral }),
    });
    return;
  }

  const rawInput = interaction.fields.getTextInputValue("value").trim();
  if (!rawInput) {
    // Clear blacklist
    const { error } = await supabase
      .from(TABLE_NAMES.TRAVEL_SETTINGS)
      .update({ blacklisted_items: [] })
      .eq("user_id", userId);

    if (error) {
      await interaction.reply({
        content: "❌ Failed to update setting.",
        ...(interaction.guild && { flags: MessageFlags.Ephemeral }),
      });
      return;
    }

    await interaction.reply({
      content: "✅ Item blacklist cleared.",
      ...(interaction.guild && { flags: MessageFlags.Ephemeral }),
    });
    return;
  }

  // Parse input: comma-separated IDs or names
  const inputs = rawInput
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s);

  const itemIds: number[] = [];
  const itemNames: string[] = [];

  for (const input of inputs) {
    const asNumber = parseInt(input);
    if (!isNaN(asNumber)) {
      itemIds.push(asNumber);
    } else {
      itemNames.push(input);
    }
  }

  // Look up names in database
  if (itemNames.length > 0) {
    const { data: items } = await supabase
      .from(TABLE_NAMES.TORN_ITEMS)
      .select("id, name");

    const nameToId = new Map<string, number>();
    items?.forEach((item) => {
      nameToId.set(item.name.toLowerCase(), item.id);
    });

    for (const name of itemNames) {
      const id = nameToId.get(name.toLowerCase());
      if (id) {
        itemIds.push(id);
      }
    }
  }

  // Remove duplicates
  const uniqueIds = Array.from(new Set(itemIds));

  const { error } = await supabase
    .from(TABLE_NAMES.TRAVEL_SETTINGS)
    .update({ blacklisted_items: uniqueIds })
    .eq("user_id", userId);

  if (error) {
    await interaction.reply({
      content: "❌ Failed to update setting.",
      ...(interaction.guild && { flags: MessageFlags.Ephemeral }),
    });
    return;
  }

  await interaction.reply({
    content: `✅ Item blacklist updated with ${uniqueIds.length} item(s).`,
    ...(interaction.guild && { flags: MessageFlags.Ephemeral }),
  });
}

export async function handleModalBlacklistedCategories(
  interaction: ModalSubmitInteraction,
  supabase: SupabaseClient,
) {
  const userId = await getAuthorizedUser(supabase, interaction.user.id);
  if (!userId) {
    await interaction.reply({
      content: "❌ Your account is no longer linked.",
      ...(interaction.guild && { flags: MessageFlags.Ephemeral }),
    });
    return;
  }

  const rawInput = interaction.fields.getTextInputValue("value").trim();
  if (!rawInput) {
    // Clear blacklist
    const { error } = await supabase
      .from(TABLE_NAMES.TRAVEL_SETTINGS)
      .update({ blacklisted_categories: [] })
      .eq("user_id", userId);

    if (error) {
      await interaction.reply({
        content: "❌ Failed to update setting.",
        ...(interaction.guild && { flags: MessageFlags.Ephemeral }),
      });
      return;
    }

    await interaction.reply({
      content: "✅ Category blacklist cleared.",
      ...(interaction.guild && { flags: MessageFlags.Ephemeral }),
    });
    return;
  }

  // Parse input: comma-separated IDs or names
  const inputs = rawInput
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s);

  const categoryIds: number[] = [];
  const categoryNames: string[] = [];

  for (const input of inputs) {
    const asNumber = parseInt(input);
    if (!isNaN(asNumber)) {
      categoryIds.push(asNumber);
    } else {
      categoryNames.push(input);
    }
  }

  // Look up names in database
  if (categoryNames.length > 0) {
    const { data: categories } = await supabase
      .from(TABLE_NAMES.TORN_CATEGORIES)
      .select("id, name");

    const nameToId = new Map<string, number>();
    categories?.forEach((cat) => {
      nameToId.set(cat.name.toLowerCase(), cat.id);
    });

    for (const name of categoryNames) {
      const id = nameToId.get(name.toLowerCase());
      if (id) {
        categoryIds.push(id);
      }
    }
  }

  // Remove duplicates
  const uniqueIds = Array.from(new Set(categoryIds));

  const { error } = await supabase
    .from(TABLE_NAMES.TRAVEL_SETTINGS)
    .update({ blacklisted_categories: uniqueIds })
    .eq("user_id", userId);

  if (error) {
    await interaction.reply({
      content: "❌ Failed to update setting.",
      ...(interaction.guild && { flags: MessageFlags.Ephemeral }),
    });
    return;
  }

  await interaction.reply({
    content: `✅ Category blacklist updated with ${uniqueIds.length} category/ies.`,
    ...(interaction.guild && { flags: MessageFlags.Ephemeral }),
  });
}
