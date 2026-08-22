import { Hono } from "hono";
import type { AppConfig } from "../../shared/config";
import { MIN_APP_VERSION } from "../../shared/constants";
import type { AppEnv } from "../env";

/**
 * Public, unauthenticated requirements for the native apps. The iOS app reads
 * this on launch and whenever it returns to the foreground; a build older than
 * `minVersion` blocks itself and sends the user to `storeUrl`.
 */
export function appVersionRoutes(
  config: Pick<AppConfig, "iosAppStoreUrl">,
): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get("/version", (context) => {
    context.header("Cache-Control", "public, max-age=300");
    return context.json({
      data: { minVersion: MIN_APP_VERSION, storeUrl: config.iosAppStoreUrl },
    });
  });

  return app;
}
