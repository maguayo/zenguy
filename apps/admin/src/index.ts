import { buildApp } from "./server/app";
import type { Bindings } from "./server/env";

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
