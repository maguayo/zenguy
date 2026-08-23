import { RATE_LIMITS } from "../../shared/constants";
import { sha256Hex } from "../../shared/crypto";
import type { RateLimiter } from "../../shared/ratelimit";
import { enforceRunCreateRate } from "./run_rate";

describe("enforceRunCreateRate", () => {
  it("charges independent workspace, actor, and source-address scopes", async () => {
    const hit = vi.fn(async () => ({ allowed: true, retryAfterSeconds: 1 }));
    const limiter: RateLimiter = { hit };

    await enforceRunCreateRate(
      limiter,
      "ws_rate",
      "usr_rate",
      "203.0.113.42",
    );

    expect(hit.mock.calls).toEqual([
      [
        "run_create:workspace:ws_rate",
        RATE_LIMITS.run_create.limit,
        RATE_LIMITS.run_create.windowSeconds,
      ],
      [
        "run_create:user:usr_rate",
        RATE_LIMITS.run_create.limit,
        RATE_LIMITS.run_create.windowSeconds,
      ],
      [
        `run_create:ip:${await sha256Hex("203.0.113.42")}`,
        RATE_LIMITS.run_create.limit,
        RATE_LIMITS.run_create.windowSeconds,
      ],
    ]);
  });

  it("rejects when any atomic scope is exhausted", async () => {
    const limiter: RateLimiter = {
      hit: vi.fn(async (key) => ({
        allowed: !key.startsWith("run_create:user:"),
        retryAfterSeconds: 17,
      })),
    };

    await expect(
      enforceRunCreateRate(limiter, "ws_rate", "usr_rate", "203.0.113.42"),
    ).rejects.toMatchObject({ code: "RATE_LIMITED", retryAfterSeconds: 17 });
  });
});
