import { db } from "./index.js";

/**
 * Records a system boot event in the database for process restart/startup notifications.
 *
 * @param component - The component name ("bot", "worker", "api", etc.)
 * @param customMessage - Optional custom message to record
 */
export async function recordBootAlert(
  component: "bot" | "worker" | "api" | string,
  customMessage?: string,
): Promise<void> {
  const componentDisplayNames: Record<string, string> = {
    bot: "Discord Bot",
    worker: "Worker Process",
    api: "API Gateway",
  };

  const displayName = componentDisplayNames[component] || component;
  const message =
    customMessage || `Sentinel ${displayName} process successfully booted up.`;
  const timestamp = Date.now();
  const id = `boot_alert_${component}_${timestamp}`;

  try {
    await db.systemState.create({
      data: {
        id,
        init: false, // init = false indicates an unreported boot alert
        data: {
          component: displayName,
          message,
          timestamp,
        },
      },
    });
  } catch (error) {
    console.error(`[BootAlert] Failed to record boot alert for ${component}:`, error);
  }
}
