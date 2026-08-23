import { buildApp } from "../../app";
import { FixedClock } from "../../shared/clock";
import { hmacSha256Hex, hmacSign } from "../../shared/crypto";
import { fakeBindings } from "../../test/fakes/bindings";
import { FakeIds } from "../../test/fakes/ids";
import {
  FakeAuditRepo,
  FakeSubscriptionRepo,
  FakeWorkspaceRepo,
} from "../../test/fakes/repos";
import { FakePaddleCheckoutIntentRepo } from "../../test/fakes/paddle_checkout_intents";
import { PADDLE_SUBSCRIPTION_CREATED } from "../../test/fixtures/paddle";
import { MAX_PADDLE_WEBHOOK_BODY_BYTES } from "../../shared/constants";

const NOW = Date.parse("2026-09-01T00:05:00Z");

describe("Paddle webhook route", () => {
  it("is public, preserves the raw body, and returns the success envelope", async () => {
    const env = fakeBindings();
    const checkoutIntents = new FakePaddleCheckoutIntentRepo();
    checkoutIntents.intents.set("pci_route", {
      id: "pci_route",
      workspaceId: "ws_primary",
      actorUserId: "usr_owner",
      purpose: "subscription",
      productId: env.PADDLE_PRODUCT_ID!,
      priceId: env.PADDLE_PRICE_ID!,
      quantity: 1,
      currencyCode: "EUR",
      amountCents: 3_900,
      createdAt: NOW - 1_000,
      expiresAt: NOW + 60_000,
      consumedAt: null,
      providerReference: null,
    });
    const workspaces = new FakeWorkspaceRepo();
    await workspaces.insert({
      id: "ws_primary",
      name: "Primary",
      slug: "primary",
      timezone: "UTC",
      ownerUserId: "usr_owner",
      createdAt: 1,
      updatedAt: 1,
      deletedAt: null,
    });
    const app = buildApp(env, {
      clock: new FixedClock(NOW),
      ids: new FakeIds(),
      subscriptions: new FakeSubscriptionRepo(),
      checkoutIntents,
      workspaces,
      audits: new FakeAuditRepo(),
    });
    const rawBody = JSON.stringify({
      ...PADDLE_SUBSCRIPTION_CREATED,
      data: {
        ...PADDLE_SUBSCRIPTION_CREATED.data,
        custom_data: {
          checkout_intent_id: "pci_route",
          checkout_intent_sig: await hmacSign(
            env.PADDLE_WEBHOOK_SECRET!,
            "zenguy:paddle-checkout-intent:v1:pci_route",
          ),
        },
      },
    });
    const timestamp = NOW / 1_000;
    const signature = await hmacSha256Hex(
      env.PADDLE_WEBHOOK_SECRET!,
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

  it("rejects an oversized body before signature verification", async () => {
    const app = buildApp(fakeBindings(), {
      clock: new FixedClock(NOW),
      subscriptions: new FakeSubscriptionRepo(),
      audits: new FakeAuditRepo(),
    });

    const response = await app.request("/api/webhooks/paddle", {
      method: "POST",
      headers: {
        "content-length": String(MAX_PADDLE_WEBHOOK_BODY_BYTES + 1),
        "Paddle-Signature": "invalid",
      },
      body: "x",
    });

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toEqual({
      error: { code: "PAYLOAD_TOO_LARGE", message: "Request body too large" },
    });
  });

  it("does not trust an understated Content-Length on the webhook stream", async () => {
    const app = buildApp(fakeBindings(), {
      clock: new FixedClock(NOW),
      subscriptions: new FakeSubscriptionRepo(),
      audits: new FakeAuditRepo(),
    });

    const response = await app.request("/api/webhooks/paddle", {
      method: "POST",
      headers: {
        "content-length": "1",
        "Paddle-Signature": "invalid",
      },
      body: "x".repeat(MAX_PADDLE_WEBHOOK_BODY_BYTES + 1),
    });

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toEqual({
      error: { code: "PAYLOAD_TOO_LARGE", message: "Request body too large" },
    });
  });
});
