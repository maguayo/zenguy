import type { Context, MiddlewareHandler } from "hono";
import type { AppEnv } from "../http/env";
import { AppError } from "./errors";
import type { Clock } from "./clock";
import { systemClock } from "./clock";
import { RATE_LIMITS } from "./constants";
import { sha256Hex } from "./crypto";

export interface RateLimiter {
  hit(
    key: string,
    limit: number,
    windowSeconds: number,
  ): Promise<{ allowed: boolean; retryAfterSeconds: number }>;
  /**
   * Atomically consumes the same rule across every key when the implementation
   * supports it. Production uses this path; the optional shape keeps small
   * test doubles and deliberately local adapters source-compatible.
   */
  hitMany?(
    keys: readonly string[],
    limit: number,
    windowSeconds: number,
  ): Promise<{ allowed: boolean; retryAfterSeconds: number }>;
}

const MAX_ATOMIC_RATE_LIMIT_SCOPES = 16;

/**
 * Strict fixed-window limiter. The conditional UPSERT is one D1 statement on
 * the primary database, so only `limit` concurrent callers can receive a row.
 */
export class D1RateLimiter implements RateLimiter {
  constructor(
    private readonly database: D1Database,
    private readonly clock: Clock = systemClock,
  ) {}

  async hit(
    key: string,
    limit: number,
    windowSeconds: number,
  ): Promise<{ allowed: boolean; retryAfterSeconds: number }> {
    return await this.hitMany([key], limit, windowSeconds);
  }

  async hitMany(
    keys: readonly string[],
    limit: number,
    windowSeconds: number,
  ): Promise<{ allowed: boolean; retryAfterSeconds: number }> {
    const uniqueKeys = [...new Set(keys)];
    if (
      uniqueKeys.length === 0 ||
      uniqueKeys.length > MAX_ATOMIC_RATE_LIMIT_SCOPES ||
      uniqueKeys.some((key) => key.length === 0) ||
      !Number.isSafeInteger(limit) ||
      limit <= 0 ||
      !Number.isSafeInteger(windowSeconds) ||
      windowSeconds <= 0
    ) {
      throw new Error("Invalid atomic rate-limit rule");
    }
    const now = this.clock.now();
    const windowMilliseconds = windowSeconds * 1_000;
    const windowStart = Math.floor(now / windowMilliseconds) * windowMilliseconds;
    const expiresAt = windowStart + windowMilliseconds + 60_000;
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((windowStart + windowMilliseconds - now) / 1_000),
    );
    const requestedRows = uniqueKeys.map(() => "(?)").join(", ");
    const rows = await this.database
      .prepare(
        `WITH requested(rate_key) AS (VALUES ${requestedRows})
         INSERT INTO rate_limit_windows
           (rate_key, window_start, request_count, expires_at)
         SELECT requested.rate_key, ?, 1, ?
         FROM requested
         WHERE NOT EXISTS (
           SELECT 1
           FROM requested AS candidate
           JOIN rate_limit_windows AS existing
             ON existing.rate_key = candidate.rate_key
            AND existing.window_start = ?
           WHERE existing.request_count >= ?
         )
         ON CONFLICT(rate_key, window_start) DO UPDATE SET
           request_count = rate_limit_windows.request_count + 1,
           expires_at = excluded.expires_at
         RETURNING rate_key`,
      )
      .bind(...uniqueKeys, windowStart, expiresAt, windowStart, limit)
      .all<{ rate_key: string }>();
    return {
      allowed: rows.results.length === uniqueKeys.length,
      retryAfterSeconds,
    };
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

export async function enforceRateLimitScopes(
  limiter: RateLimiter,
  keys: readonly string[],
  rule: { readonly limit: number; readonly windowSeconds: number },
): Promise<void> {
  const result = limiter.hitMany === undefined
    ? await fallbackRateLimitScopes(limiter, keys, rule)
    : await limiter.hitMany(keys, rule.limit, rule.windowSeconds);
  if (!result.allowed) {
    throw new AppError(
      "RATE_LIMITED",
      "Too many requests",
      undefined,
      result.retryAfterSeconds,
    );
  }
}

async function fallbackRateLimitScopes(
  limiter: RateLimiter,
  keys: readonly string[],
  rule: { readonly limit: number; readonly windowSeconds: number },
): Promise<{ allowed: boolean; retryAfterSeconds: number }> {
  const results = await Promise.all(
    keys.map((key) => limiter.hit(key, rule.limit, rule.windowSeconds)),
  );
  const blocked = results.find((result) => !result.allowed);
  return blocked ?? {
    allowed: true,
    retryAfterSeconds: Math.max(
      1,
      ...results.map((result) => result.retryAfterSeconds),
    ),
  };
}

export function normalizeRateLimitAddress(value: string | undefined): string {
  if (value === undefined) return "unknown";
  const raw = value.trim().toLowerCase();
  return /^[0-9a-f:.]{1,64}$/iu.test(raw) ? raw : "invalid";
}

function clientAddress(context: Context<AppEnv>): string {
  return normalizeRateLimitAddress(context.req.header("CF-Connecting-IP"));
}

/**
 * One shared creation budget across tests, monitors, channels and secrets.
 * Workspace, actor and source address are independent scopes, preventing an
 * attacker from rotating resource types, workspaces or accounts cheaply.
 */
export function collectionCreateRateLimit(
  limiter: RateLimiter,
): MiddlewareHandler<AppEnv> {
  const config = RATE_LIMITS.collection_create;
  return async (context, next) => {
    const addressHash = await sha256Hex(clientAddress(context));
    await enforceRateLimitScopes(
      limiter,
      [
        `collection_create:workspace:${context.get("workspace").id}`,
        `collection_create:actor:${context.get("user").id}`,
        `collection_create:ip:${addressHash}`,
      ],
      config,
    );
    await next();
  };
}
