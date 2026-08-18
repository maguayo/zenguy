import { createMiddleware } from "hono/factory";
import type { AppEnv } from "../env";

function requestIdValue(): string {
  return [...crypto.getRandomValues(new Uint8Array(4))]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export const requestId = createMiddleware<AppEnv>(async (context, next) => {
  const value = requestIdValue();
  context.set("requestId", value);
  await next();
  context.header("X-Request-Id", value);
});
