import { RATE_LIMITS } from "../../shared/constants";
import { AppError } from "../../shared/errors";
import type { RateLimiter } from "../../shared/ratelimit";

export async function enforceMonitorCreateRate(
  limiter: RateLimiter,
  workspaceId: string,
): Promise<void> {
  const result = await limiter.hit(
    `monitor_create:${workspaceId}`,
    RATE_LIMITS.monitor_create.limit,
    RATE_LIMITS.monitor_create.windowSeconds,
  );
  if (!result.allowed) {
    throw new AppError(
      "RATE_LIMITED",
      "Too many requests",
      undefined,
      result.retryAfterSeconds,
    );
  }
}

export async function enforceTestRequestRate(
  limiter: RateLimiter,
  workspaceId: string,
): Promise<void> {
  const result = await limiter.hit(
    `test_request:${workspaceId}`,
    RATE_LIMITS.test_request.limit,
    RATE_LIMITS.test_request.windowSeconds,
  );
  if (!result.allowed) {
    throw new AppError(
      "RATE_LIMITED",
      "Too many requests",
      undefined,
      result.retryAfterSeconds,
    );
  }
}
