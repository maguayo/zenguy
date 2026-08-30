import { buildApp } from "./server/app";
import { runCollection, scheduledCollectionDays } from "./server/costs/collection";
import type { Bindings } from "./server/env";
import { systemClock } from "./server/env";

// Built once per isolate, from the first request's env. Every var or secret
// change ships as a new Worker version, and a new version always starts fresh
// isolates, so the cache can never serve a stale binding.
let cached: ReturnType<typeof buildApp> | null = null;

export default {
  fetch(
    request: Request,
    env: Bindings,
    context: ExecutionContext,
  ): Promise<Response> | Response {
    cached ??= buildApp(env);
    return cached.fetch(request, env, context);
  },

  /** Nightly Cloudflare usage collection (wrangler.jsonc `triggers.crons`). */
  scheduled(controller: ScheduledController, env: Bindings, context: ExecutionContext): void {
    context.waitUntil(
      scheduledCollectionDays(env.DB)
        .then((days) =>
          runCollection(
            {
              db: env.DB,
              fetch: fetch.bind(globalThis),
              token: env.CF_ANALYTICS_API_TOKEN,
              accountId: env.CLOUDFLARE_ACCOUNT_ID,
              clock: systemClock,
            },
            { source: "cron", days },
          ),
        )
        .then((collection) => {
          // Never log the token; probe errors carry only GraphQL messages.
          console.log(
            JSON.stringify({
              event: "usage_collection",
              cron: controller.cron,
              status: collection?.status ?? "UNCONFIGURED",
              failed: collection?.probes.filter((probe) => !probe.ok).map((probe) => probe.probe) ?? [],
            }),
          );
        })
        .catch((error: unknown) => {
          console.error(
            JSON.stringify({
              event: "usage_collection_failed",
              cron: controller.cron,
              message: error instanceof Error ? error.message : String(error),
            }),
          );
        }),
    );
  },
};
