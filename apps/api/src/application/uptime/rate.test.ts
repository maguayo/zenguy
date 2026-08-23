import { RATE_LIMITS } from "../../shared/constants";
import { sha256Hex } from "../../shared/crypto";
import type { RateLimiter } from "../../shared/ratelimit";
import { enforceMonitorCreateRate, enforceTestRequestRate } from "./rate";

describe("uptime abuse rate limits", () => {
  it.each([
    ["monitor_create", enforceMonitorCreateRate],
    ["test_request", enforceTestRequestRate],
  ] as const)("charges all scopes for %s", async (kind, enforce) => {
    const hit = vi.fn(async () => ({ allowed: true, retryAfterSeconds: 1 }));
    const limiter: RateLimiter = { hit };

    await enforce(limiter, "ws_rate", "usr_rate", "203.0.113.42");

    const rule = RATE_LIMITS[kind];
    expect(hit.mock.calls).toEqual([
      [`${kind}:workspace:ws_rate`, rule.limit, rule.windowSeconds],
      [`${kind}:actor:usr_rate`, rule.limit, rule.windowSeconds],
      [
        `${kind}:ip:${await sha256Hex("203.0.113.42")}`,
        rule.limit,
        rule.windowSeconds,
      ],
    ]);
  });
});
