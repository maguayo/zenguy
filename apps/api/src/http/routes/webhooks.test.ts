import { buildApp } from "../../app";
import { FixedClock } from "../../shared/clock";
import { hmacSha256Hex } from "../../shared/crypto";
import { fakeBindings } from "../../test/fakes/bindings";
import { FakeIds } from "../../test/fakes/ids";
import { FakeAuditRepo, FakeSubscriptionRepo } from "../../test/fakes/repos";
import { PADDLE_SUBSCRIPTION_CREATED } from "../../test/fixtures/paddle";

const NOW = Date.parse("2026-09-01T00:05:00Z");

describe("Paddle webhook route", () => {
  it("is public, preserves the raw body, and returns the success envelope", async () => {
    const env = fakeBindings();
    const app = buildApp(env, {
      clock: new FixedClock(NOW),
      ids: new FakeIds(),
      subscriptions: new FakeSubscriptionRepo(),
      audits: new FakeAuditRepo(),
    });
    const rawBody = JSON.stringify(PADDLE_SUBSCRIPTION_CREATED);
    const timestamp = NOW / 1_000;
    const signature = await hmacSha256Hex(
      env.PADDLE_WEBHOOK_SECRET,
      `${timestamp}:${rawBody}`,
    );

    const response = await app.request("/api/webhooks/paddle", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "Paddle-Signature": `ts=${timestamp};h1=${signature}`,
      },
      body: rawBody,
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      data: { received: true },
    });
  });

  it("returns 401 for a bad signature", async () => {
    const app = buildApp(fakeBindings(), {
      clock: new FixedClock(NOW),
      subscriptions: new FakeSubscriptionRepo(),
      audits: new FakeAuditRepo(),
    });

    const response = await app.request("/api/webhooks/paddle", {
      method: "POST",
      headers: { "Paddle-Signature": `ts=${NOW / 1_000};h1=${"0".repeat(64)}` },
      body: JSON.stringify(PADDLE_SUBSCRIPTION_CREATED),
    });

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "UNAUTHORIZED",
        message: "Invalid Paddle signature",
      },
    });
  });
});
