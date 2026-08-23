import {
  enforceRateLimitScopes,
  normalizeRateLimitAddress,
  type RateLimiter,
} from "./ratelimit";

describe("rate-limit scopes", () => {
  it("prefers one atomic multi-scope consumption when available", async () => {
    const hit = vi.fn(async () => ({ allowed: true, retryAfterSeconds: 1 }));
    const hitMany = vi.fn(async () => ({ allowed: true, retryAfterSeconds: 12 }));

    await enforceRateLimitScopes(
      { hit, hitMany },
      ["scope:workspace", "scope:actor", "scope:ip"],
      { limit: 4, windowSeconds: 60 },
    );

    expect(hit).not.toHaveBeenCalled();
    expect(hitMany).toHaveBeenCalledOnce();
    expect(hitMany).toHaveBeenCalledWith(
      ["scope:workspace", "scope:actor", "scope:ip"],
      4,
      60,
    );
  });

  it("charges every independent scope", async () => {
    const hit = vi.fn(async () => ({ allowed: true, retryAfterSeconds: 1 }));

    await enforceRateLimitScopes(
      { hit },
      ["scope:workspace", "scope:actor", "scope:ip"],
      { limit: 4, windowSeconds: 60 },
    );

    expect(hit.mock.calls).toEqual([
      ["scope:workspace", 4, 60],
      ["scope:actor", 4, 60],
      ["scope:ip", 4, 60],
    ]);
  });

  it("returns a stable rate-limit error when any scope is exhausted", async () => {
    const limiter: RateLimiter = {
      hit: vi.fn(async (key) => ({
        allowed: key !== "scope:actor",
        retryAfterSeconds: key === "scope:actor" ? 19 : 1,
      })),
    };

    await expect(
      enforceRateLimitScopes(
        limiter,
        ["scope:workspace", "scope:actor", "scope:ip"],
        { limit: 4, windowSeconds: 60 },
      ),
    ).rejects.toMatchObject({
      code: "RATE_LIMITED",
      message: "Too many requests",
      retryAfterSeconds: 19,
    });
  });
});

describe("normalizeRateLimitAddress", () => {
  it.each([
    [" 203.0.113.42 ", "203.0.113.42"],
    ["2001:DB8::1", "2001:db8::1"],
    [undefined, "unknown"],
    ["forwarded.example", "invalid"],
    ["203.0.113.42, 10.0.0.1", "invalid"],
  ])("normalizes %s without accepting forwarded lists", (value, expected) => {
    expect(normalizeRateLimitAddress(value)).toBe(expected);
  });
});
