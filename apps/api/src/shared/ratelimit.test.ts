import { FixedClock } from "./clock";
import { KvRateLimiter } from "./ratelimit";
import { FakeKv } from "../test/fakes/kv";

describe("KvRateLimiter", () => {
  it("allows requests below the limit and blocks at the limit", async () => {
    const clock = new FixedClock(10_000);
    const limiter = new KvRateLimiter(new FakeKv(clock), clock);

    await expect(limiter.hit("login:ip", 2, 60)).resolves.toMatchObject({
      allowed: true,
    });
    await expect(limiter.hit("login:ip", 2, 60)).resolves.toMatchObject({
      allowed: true,
    });
    await expect(limiter.hit("login:ip", 2, 60)).resolves.toEqual({
      allowed: false,
      retryAfterSeconds: 50,
    });
  });

  it("keeps independent keys independent", async () => {
    const clock = new FixedClock(0);
    const limiter = new KvRateLimiter(new FakeKv(clock), clock);

    await limiter.hit("login:first", 1, 60);
    await expect(limiter.hit("login:first", 1, 60)).resolves.toMatchObject({
      allowed: false,
    });
    await expect(limiter.hit("login:second", 1, 60)).resolves.toMatchObject({
      allowed: true,
    });
  });

  it("resets on the next fixed window", async () => {
    const clock = new FixedClock(59_500);
    const limiter = new KvRateLimiter(new FakeKv(clock), clock);

    await limiter.hit("register:ip", 1, 60);
    const blocked = await limiter.hit("register:ip", 1, 60);
    expect(blocked).toEqual({ allowed: false, retryAfterSeconds: 1 });

    clock.advance(500);
    await expect(limiter.hit("register:ip", 1, 60)).resolves.toMatchObject({
      allowed: true,
    });
  });

  it("honors KV expiration TTL in the fake", async () => {
    const clock = new FixedClock(0);
    const kv = new FakeKv(clock);
    await kv.put("temporary", "1", { expirationTtl: 2 });

    await expect(kv.get("temporary")).resolves.toBe("1");
    clock.advance(2_000);
    await expect(kv.get("temporary")).resolves.toBeNull();
  });
});
