import { FixedClock } from "./clock";
import { D1RateLimiter } from "./ratelimit";
import { freshDb, testEnv } from "../test/helpers";

describe("D1RateLimiter", () => {
  beforeEach(freshDb);

  it("admits exactly the configured number of concurrent hits", async () => {
    const limiter = new D1RateLimiter(testEnv().DB, new FixedClock(10_000));
    const results = await Promise.all(
      Array.from({ length: 12 }, () => limiter.hit("login:shared", 5, 60)),
    );

    expect(results.filter(({ allowed }) => allowed)).toHaveLength(5);
    expect(results.filter(({ allowed }) => !allowed)).toHaveLength(7);
    expect(new Set(results.map(({ retryAfterSeconds }) => retryAfterSeconds))).toEqual(
      new Set([50]),
    );
  });

  it("atomically admits all scopes without charging siblings of blocked hits", async () => {
    const database = testEnv().DB;
    const limiter = new D1RateLimiter(database, new FixedClock(10_000));
    const results = await Promise.all(
      Array.from({ length: 12 }, (_, index) =>
        limiter.hitMany(
          ["login:shared", `login:request:${index}`],
          5,
          60,
        ),
      ),
    );

    expect(results.filter(({ allowed }) => allowed)).toHaveLength(5);
    expect(results.filter(({ allowed }) => !allowed)).toHaveLength(7);
    const shared = await database
      .prepare(
        `SELECT request_count FROM rate_limit_windows
         WHERE rate_key = 'login:shared' AND window_start = 0`,
      )
      .first<{ request_count: number }>();
    const siblings = await database
      .prepare(
        `SELECT COUNT(*) AS count FROM rate_limit_windows
         WHERE rate_key LIKE 'login:request:%' AND window_start = 0`,
      )
      .first<{ count: number }>();
    expect(shared?.request_count).toBe(5);
    expect(siblings?.count).toBe(5);
  });

  it("deduplicates scopes and rejects invalid rules before writing", async () => {
    const database = testEnv().DB;
    const limiter = new D1RateLimiter(database, new FixedClock(10_000));

    await expect(
      limiter.hitMany(["login:same", "login:same"], 1, 60),
    ).resolves.toMatchObject({ allowed: true });
    await expect(limiter.hitMany([], 1, 60)).rejects.toThrow(
      "Invalid atomic rate-limit rule",
    );
    await expect(limiter.hitMany(["login:invalid"], 0, 60)).rejects.toThrow(
      "Invalid atomic rate-limit rule",
    );

    const rows = await database
      .prepare("SELECT rate_key, request_count FROM rate_limit_windows")
      .all<{ rate_key: string; request_count: number }>();
    expect(rows.results).toEqual([
      { rate_key: "login:same", request_count: 1 },
    ]);
  });

  it("keeps keys independent and starts a fresh fixed window", async () => {
    const clock = new FixedClock(59_500);
    const limiter = new D1RateLimiter(testEnv().DB, clock);

    expect((await limiter.hit("first", 1, 60)).allowed).toBe(true);
    expect((await limiter.hit("first", 1, 60)).allowed).toBe(false);
    expect((await limiter.hit("second", 1, 60)).allowed).toBe(true);
    clock.advance(500);
    expect((await limiter.hit("first", 1, 60)).allowed).toBe(true);
  });
});
