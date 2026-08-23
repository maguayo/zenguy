import { Hono } from "hono";
import type { User } from "../domain/users/types";
import type { Workspace } from "../domain/workspaces/types";
import type { AppEnv } from "../http/env";
import { sha256Hex } from "./crypto";
import { collectionCreateRateLimit, type RateLimiter } from "./ratelimit";

const USER: User = {
  id: "usr_1",
  name: "User",
  email: "user@example.com",
  passwordHash: "hash",
  emailVerifiedAt: 1,
  authVersion: 1,
  createdAt: 1,
  updatedAt: 1,
};
const WORKSPACE: Workspace = {
  id: "ws_1",
  name: "Workspace",
  slug: "workspace",
  timezone: "UTC",
  ownerUserId: USER.id,
  createdAt: 1,
  updatedAt: 1,
  deletedAt: null,
};

class RecordingLimiter implements RateLimiter {
  readonly keys: string[] = [];
  blockedKey: string | null = null;

  async hit(key: string): Promise<{ allowed: boolean; retryAfterSeconds: number }> {
    this.keys.push(key);
    return { allowed: key !== this.blockedKey, retryAfterSeconds: 45 };
  }
}

function appFor(limiter: RecordingLimiter): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.onError((error, context) =>
    context.json(
      { code: "code" in error ? error.code : "UNKNOWN" },
      "code" in error && error.code === "RATE_LIMITED" ? 429 : 500,
    ),
  );
  app.use("*", async (context, next) => {
    context.set("user", USER);
    context.set("workspace", WORKSPACE);
    await next();
  });
  app.post("/create", collectionCreateRateLimit(limiter), (context) =>
    context.text("created", 201),
  );
  return app;
}

describe("collectionCreateRateLimit", () => {
  it("uses one shared workspace/actor/IP namespace and hashes the address", async () => {
    const limiter = new RecordingLimiter();
    const response = await appFor(limiter).request("/create", {
      method: "POST",
      headers: { "CF-Connecting-IP": "203.0.113.42" },
    });
    const digest = await sha256Hex("203.0.113.42");

    expect(response.status).toBe(201);
    expect(limiter.keys).toEqual([
      "collection_create:workspace:ws_1",
      "collection_create:actor:usr_1",
      `collection_create:ip:${digest}`,
    ]);
    expect(limiter.keys.join(" ")).not.toContain("203.0.113.42");
  });

  it("blocks when any independent scope is exhausted", async () => {
    const limiter = new RecordingLimiter();
    limiter.blockedKey = "collection_create:actor:usr_1";
    const response = await appFor(limiter).request("/create", { method: "POST" });

    expect(response.status).toBe(429);
    await expect(response.json()).resolves.toEqual({ code: "RATE_LIMITED" });
  });
});
