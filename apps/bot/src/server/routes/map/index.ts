import { type MapRoutesDeps } from "./map-types.js";
import { registerMapReadRoutes } from "./map-read.js";
import { registerMapWriteRoutes } from "./map-write.js";

export function registerMapRoutes(deps: MapRoutesDeps): void {
  registerMapReadRoutes({
    app: deps.app,
    client: deps.client,
    magicLinkService: deps.magicLinkService,
  });
  registerMapWriteRoutes(deps);
}
