import { startDbScheduledRunner } from "../lib/scheduler.js";
import { supabase } from "../lib/supabase.js";
import { TABLE_NAMES, ALERT_MODULES } from "@sentinel/shared";
import { logError, logWarn } from "../lib/logger.js";
import { executeSync } from "../lib/sync.js";

const WORKER_NAME = "travel_alerts_worker";
const DB_WORKER_KEY = "travel_alerts_worker";

const BOT_HTTP_URL =
  process.env.NODE_ENV === "development"
    ? "http://localhost:3001"
    : process.env.BOT_HTTP_URL || "http://localhost:3001";

const ALERT_DELAY_MS = 1000; // 1 second delay between sending DMs

interface TravelRecommendation {
  user_id: string;
  item_id: number;
  item_name: string;
  destination: string;
  profit_per_unit: number;
  available_quantity: number;
  profit_per_trip: number;
  profit_per_minute: number;
  travel_time_minutes: number;
  round_trip_minutes: number;
  best_item_id: number;
  created_at: string;
  sentinel_torn_items?: { name: string };
  sentinel_torn_destinations?: { name: string };
}

interface TravelSettings {
  user_id: string;
  alerts_enabled: boolean;
  alert_cooldown_minutes: number;
  min_profit_per_trip: number;
  min_profit_per_minute: number;
  blacklisted_item_ids: number[];
  blacklisted_categories: string[];
}

/**
 * Check travel recommendations and send alerts to users
 */
async function processAlertsHandler(): Promise<void> {
  try {
    // Get all travel settings with alerts enabled
    const { data: settings, error: settingsError } = await supabase
      .from(TABLE_NAMES.TRAVEL_SETTINGS)
      .select("*")
      .eq("alerts_enabled", true);

    if (settingsError) throw settingsError;
    if (!settings || settings.length === 0) {
      return;
    }

    let alertsSent = 0;
    let _alertsSkipped = 0;
    let alertsBlocked = 0;

    for (const setting of settings as TravelSettings[]) {
      try {
        // Get user discord_id from user_data table
        const { data: userData, error: userError } = await supabase
          .from(TABLE_NAMES.USER_DATA)
          .select("discord_id")
          .eq("user_id", setting.user_id)
          .single();

        if (userError || !userData?.discord_id) {
          continue;
        }

        // Get last alert data
        const { data: lastAlert } = await supabase
          .from(TABLE_NAMES.USER_ALERTS)
          .select("last_alert_sent_at, last_alert_data")
          .eq("user_id", setting.user_id)
          .eq("module", ALERT_MODULES.TRAVEL)
          .single();

        // Check cooldown
        if (lastAlert?.last_alert_sent_at) {
          const lastAlertTime = new Date(
            lastAlert.last_alert_sent_at,
          ).getTime();
          const cooldownMs = setting.alert_cooldown_minutes * 60 * 1000;
          const timeSinceLastAlert = Date.now() - lastAlertTime;

          if (timeSinceLastAlert < cooldownMs) {
            _alertsSkipped++;
            continue;
          }
        }

        // Get top recommendation for user
        let query = supabase
          .from(TABLE_NAMES.TRAVEL_RECOMMENDATIONS)
          .select(
            `
            *,
            sentinel_torn_items!best_item_id(name),
            sentinel_torn_destinations!destination_id(name)
          `,
          )
          .eq("user_id", setting.user_id);

        // Only apply filters if thresholds are set
        if (setting.min_profit_per_trip !== null) {
          query = query.gte("profit_per_trip", setting.min_profit_per_trip);
        }
        if (setting.min_profit_per_minute !== null) {
          query = query.gte("profit_per_minute", setting.min_profit_per_minute);
        }

        const { data: recommendations, error: recError } = await query
          .order("profit_per_minute", { ascending: false })
          .limit(1);

        if (recError) throw recError;
        if (!recommendations || recommendations.length === 0) {
          _alertsSkipped++;
          continue;
        }

        const rec = recommendations[0] as TravelRecommendation;
        const itemName = rec.sentinel_torn_items?.name || "Unknown Item";
        const destination = rec.sentinel_torn_destinations?.name || "Unknown";
        const itemId = rec.best_item_id || 0;

        // Check blacklists
        if (setting.blacklisted_item_ids?.includes(itemId)) {
          _alertsSkipped++;
          continue;
        }

        // Check if this is the same recommendation as last alert
        if (
          lastAlert?.last_alert_data?.item_id === itemId &&
          lastAlert?.last_alert_data?.destination === destination
        ) {
          _alertsSkipped++;
          continue;
        }

        // Build embed - matching /travel command format
        const profitPerTrip = rec.profit_per_trip
          ? `$${Number(rec.profit_per_trip).toLocaleString("en-US")}`
          : "N/A";
        const profitPerMinute = rec.profit_per_minute
          ? `$${Number(rec.profit_per_minute).toLocaleString("en-US")}/min`
          : "N/A";
        const roundTripTime = rec.round_trip_minutes
          ? (() => {
              const hours = Math.floor(rec.round_trip_minutes / 60);
              const minutes = rec.round_trip_minutes % 60;
              return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
            })()
          : "N/A";

        const embed = {
          title: "🌍 Travel Alert",
          color: 0x10b981,
          description: "A new profitable travel opportunity is available!",
          fields: [
            {
              name: "Destination",
              value: `**${destination}**`,
              inline: true,
            },
            {
              name: "Potential Profit",
              value: profitPerTrip,
              inline: true,
            },
            {
              name: "Best Item to Buy",
              value: itemName,
              inline: true,
            },
            {
              name: "Profit per Minute",
              value: profitPerMinute,
              inline: true,
            },
            {
              name: "Round Trip Time",
              value: roundTripTime,
              inline: true,
            },
            {
              name: "Check Details",
              value: "Use `/travel` for full info",
              inline: true,
            },
          ],
          footer: {
            text: "Sentinel Travel Recommendations • Adjust with /settings",
          },
          timestamp: new Date().toISOString(),
        };

        // Send DM via bot HTTP endpoint
        const response = await fetch(`${BOT_HTTP_URL}/send-dm`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            userId: setting.user_id,
            discordId: userData.discord_id,
            embed,
          }),
        });

        const result = (await response.json()) as {
          success?: boolean;
          recipient?: string;
          error?: string;
          code?: string;
        };

        if (!response.ok) {
          if (result.code === "DM_BLOCKED") {
            alertsBlocked++;
          } else {
            throw new Error(result.error || "Failed to send DM");
          }
        } else {
          alertsSent++;

          // Update last alert data
          await supabase.from(TABLE_NAMES.USER_ALERTS).upsert({
            user_id: setting.user_id,
            module: ALERT_MODULES.TRAVEL,
            last_alert_sent_at: new Date().toISOString(),
            last_alert_data: {
              item_id: itemId,
              item_name: itemName,
              destination: destination,
              profit_per_trip: rec.profit_per_trip,
            },
          });
        }

        // Delay between messages to avoid rate limits
        if (alertsSent > 0 && alertsSent % 5 === 0) {
          await new Promise((resolve) => setTimeout(resolve, ALERT_DELAY_MS));
        }
      } catch (error: unknown) {
        const err = error as { message?: string };
        logError(WORKER_NAME, err.message || String(error));
      }
    }

    if (alertsSent > 0 || alertsBlocked > 0) {
      const parts = [];
      if (alertsSent > 0) parts.push(`${alertsSent} sent`);
      if (alertsBlocked > 0) parts.push(`${alertsBlocked} blocked`);
      logWarn(WORKER_NAME, parts.join(", "));
    }
  } catch (error) {
    logError(WORKER_NAME, String(error));
    throw error;
  }
}

export function startTravelAlerts() {
  return startDbScheduledRunner({
    worker: DB_WORKER_KEY,
    defaultCadenceSeconds: 300, // 5 minutes
    pollIntervalMs: 5000,
    handler: async () => {
      return await executeSync({
        name: WORKER_NAME,
        timeout: 30000,
        handler: processAlertsHandler,
      });
    },
  });
}
