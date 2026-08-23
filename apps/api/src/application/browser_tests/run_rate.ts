import { RATE_LIMITS } from "../../shared/constants";
import { sha256Hex } from "../../shared/crypto";
import {
  enforceRateLimitScopes,
  normalizeRateLimitAddress,
  type RateLimiter,
} from "../../shared/ratelimit";

export async function enforceRunCreateRate(
  limiter: RateLimiter,
  workspaceId: string,
  actorId: string,
  ip?: string,
): Promise<void> {
  await enforceRateLimitScopes(
    limiter,
    [
      `run_create:workspace:${workspaceId}`,
      `run_create:user:${actorId}`,
      `run_create:ip:${await sha256Hex(normalizeRateLimitAddress(ip))}`,
    ],
    RATE_LIMITS.run_create,
  );
}
