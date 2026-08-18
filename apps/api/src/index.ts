import { buildApp } from "./app";
import type { Bindings } from "./shared/config";

export default {
  fetch(request, env, context) {
    return buildApp(env).fetch(request, env, context);
  },
} satisfies ExportedHandler<Bindings>;
