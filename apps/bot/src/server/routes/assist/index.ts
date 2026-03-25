import { type AssistRouteDeps } from "./assist-types.js";
import { registerAssistInstallRoute } from "./assist-install.js";
import { registerAssistEventsRoute } from "./assist-events.js";

export function registerAssistRoutes(deps: AssistRouteDeps): void {
  registerAssistInstallRoute(deps);
  registerAssistEventsRoute(deps);
}
