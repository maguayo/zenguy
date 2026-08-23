import { RATE_LIMITS } from "../../shared/constants";
import { sha256Hex } from "../../shared/crypto";
import {
  enforceRateLimitScopes,
  normalizeRateLimitAddress,
  type RateLimiter,
} from "../../shared/ratelimit";

async function enforceUptimeRate(
  limiter: RateLimiter,
  kind: "monitor_create" | "test_request",
  input: { workspaceId: string; actorId: string; ip?: string },
): Promise<void> {
  await enforceRateLimitScopes(
    limiter,
    [
      `${kind}:workspace:${input.workspaceId}`,
      `${kind}:actor:${input.actorId}`,
      `${kind}:ip:${await sha256Hex(normalizeRateLimitAddress(input.ip))}`,
    ],
    RATE_LIMITS[kind],
  );
}

export async function enforceMonitorCreateRate(
  limiter: RateLimiter,
  workspaceId: string,
  actorId: string,
  ip?: string,
): Promise<void> {
  await enforceUptimeRate(limiter, "monitor_create", {
    workspaceId,
    actorId,
    ip,
  });
}

export async function enforceTestRequestRate(
  limiter: RateLimiter,
  workspaceId: string,
  actorId: string,
  ip?: string,
): Promise<void> {
  await enforceUptimeRate(limiter, "test_request", {
    workspaceId,
    actorId,
    ip,
  });
}
