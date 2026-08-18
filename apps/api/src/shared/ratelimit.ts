import type { Context, MiddlewareHandler } from "hono";
import type { AppEnv } from "../http/env";
import { AppError } from "./errors";
import type { Clock } from "./clock";
import { systemClock } from "./clock";

export interface RateLimiter {
  hit(
    key: string,
    limit: number,
    windowSeconds: number,
  ): Promise<{ allowed: boolean; retryAfterSeconds: number }>;
}

export class KvRateLimiter implements RateLimiter {
  constructor(
    private readonly kv: KVNamespace,
    private readonly clock: Clock = systemClock,
  ) {}

  async hit(
    key: string,
    limit: number,
    windowSeconds: number,
  ): Promise<{ allowed: boolean; retryAfterSeconds: number }> {
    const now = this.clock.now();
    const windowMilliseconds = windowSeconds * 1000;
    const window = Math.floor(now / windowMilliseconds);
    const storageKey = `rl:${key}:${window}`;
    const raw = await this.kv.get(storageKey, "text");
    const parsed = raw === null ? 0 : Number.parseInt(raw, 10);
    const count = Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil(((window + 1) * windowMilliseconds - now) / 1000),
    );

    if (count >= limit) {
      return { allowed: false, retryAfterSeconds };
    }

    // KV is eventually consistent, so this is abuse protection rather than a
    // strict distributed quota. Small concurrent overruns are acceptable in V1.
    await this.kv.put(storageKey, String(count + 1), {
      expirationTtl: windowSeconds + 60,
    });
    return { allowed: true, retryAfterSeconds };
  }
}

export function rateLimit(
  limiter: RateLimiter,
  keyFn: (context: Context<AppEnv>) => string,
  limit: number,
  windowSeconds: number,
): MiddlewareHandler<AppEnv> {
  return async (context, next) => {
    const result = await limiter.hit(keyFn(context), limit, windowSeconds);
    if (!result.allowed) {
      throw new AppError(
        "RATE_LIMITED",
        "Too many requests",
        undefined,
        result.retryAfterSeconds,
      );
    }
    await next();
  };
}
