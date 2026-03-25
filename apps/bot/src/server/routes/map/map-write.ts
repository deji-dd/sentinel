import { type MapRoutesDeps } from "./map-types.js";
import { registerMapCrudRoutes } from "./map-write-crud.js";
import { registerMapDuplicateRoutes } from "./map-write-duplicate.js";
import { registerMapPublishRoutes } from "./map-write-publish.js";
import { registerMapSaveRoute } from "./map-write-save.js";

export function registerMapWriteRoutes({
  app,
  mapRateLimiter,
  client,
  discordClient,
  magicLinkService,
}: MapRoutesDeps): void {
  registerMapCrudRoutes({ app, magicLinkService });
  registerMapDuplicateRoutes({ app, mapRateLimiter, magicLinkService });
  registerMapPublishRoutes({ app, client, magicLinkService });
  registerMapSaveRoute({
    app,
    mapRateLimiter,
    discordClient,
    magicLinkService,
  });
}
