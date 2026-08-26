import { buildApp } from "../../app";
import type { Bindings } from "../../shared/config";
import { FixedClock } from "../../shared/clock";
import { hmacSha256Hex } from "../../shared/crypto";
import { MAX_STRIPE_WEBHOOK_BODY_BYTES } from "../../shared/constants";
import { fakeBindings } from "../../test/fakes/bindings";
import { FakeAuditRepo, FakeSubscriptionRepo } from "../../test/fakes/repos";

const NOW = Date.parse("2026-09-01T00:05:00Z");
const WEBHOOK_SECRET = "whsec_routetest";

function stripeBindings(): Bindings {
  const env = fakeBindings();
  delete env.PADDLE_API_KEY;
  delete env.PADDLE_WEBHOOK_SECRET;
  delete env.PADDLE_CLIENT_TOKEN;
  delete env.PADDLE_ENVIRONMENT;
  delete env.PADDLE_PRODUCT_ID;
  delete env.PADDLE_PRICE_ID;
  delete env.PADDLE_OVERAGE_PRICE_ID;
  env.STRIPE_SECRET_KEY = "sk_test_route123";
  env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET;
  env.STRIPE_ENVIRONMENT = "test";
  env.STRIPE_PRODUCT_ID = "prod_route";
  env.STRIPE_PRICE_ID = "price_route";
  env.STRIPE_OVERAGE_PRICE_ID = "price_routeoverage";
  return env;
}

function app() {
  return buildApp(stripeBindings(), {
    clock: new FixedClock(NOW),
    subscriptions: new FakeSubscriptionRepo(),
    audits: new FakeAuditRepo(),
  });
}

describe("Stripe webhook route", () => {
  it("is public, preserves the raw body, and returns the success envelope", async () => {
    const rawBody = JSON.stringify({
      id: "evt_route",
      type: "ping",
      created: NOW / 1_000,
      data: { object: {} },
    });
    const timestamp = NOW / 1_000;
    const signature = await hmacSha256Hex(
      WEBHOOK_SECRET,
      `${timestamp}.${rawBody}`,
    );

    const response = await app().request("/api/webhooks/stripe", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "Stripe-Signature": `t=${timestamp},v1=${signature}`,
      },
      body: rawBody,
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      data: { received: true },
    });
  });

  it("returns 401 for a bad signature", async () => {
    const response = await app().request("/api/webhooks/stripe", {
      method: "POST",
      headers: {
        "Stripe-Signature": `t=${NOW / 1_000},v1=${"0".repeat(64)}`,
      },
      body: "{}",
    });

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "UNAUTHORIZED",
        message: "Invalid Stripe signature",
      },
    });
  });

  it("rejects an oversized body before signature verification", async () => {
    const response = await app().request("/api/webhooks/stripe", {
      method: "POST",
      headers: {
        "content-length": String(MAX_STRIPE_WEBHOOK_BODY_BYTES + 1),
        "Stripe-Signature": "invalid",
      },
      body: "x",
    });

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toEqual({
      error: { code: "PAYLOAD_TOO_LARGE", message: "Request body too large" },
    });
  });

  it("does not trust an understated Content-Length on the webhook stream", async () => {
    const response = await app().request("/api/webhooks/stripe", {
      method: "POST",
      headers: {
        "content-length": "1",
        "Stripe-Signature": "invalid",
      },
      body: "x".repeat(MAX_STRIPE_WEBHOOK_BODY_BYTES + 1),
    });

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toEqual({
      error: { code: "PAYLOAD_TOO_LARGE", message: "Request body too large" },
    });
  });
});
