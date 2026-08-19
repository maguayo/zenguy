import { RATE_LIMITS } from "../../shared/constants";
import { AppError } from "../../shared/errors";
import type { RateLimiter } from "../../shared/ratelimit";

export async function enforceRunCreateRate(
  limiter: RateLimiter,
  workspaceId: string,
): Promise<void> {
  const result = await limiter.hit(
    `run_create:${workspaceId}`,
    RATE_LIMITS.run_create.limit,
    RATE_LIMITS.run_create.windowSeconds,
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
