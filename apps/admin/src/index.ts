import { buildApp } from "./server/app";
import type { Bindings } from "./server/env";

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
};
