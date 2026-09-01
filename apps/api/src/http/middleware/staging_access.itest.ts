import {
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
  SignJWT,
} from "jose";
import { handleHttpRequest } from "../../index";
import type { Bindings } from "../../shared/config";
import { MAX_STRIPE_WEBHOOK_BODY_BYTES } from "../../shared/constants";
import { testEnv } from "../../test/helpers";

const TEAM_DOMAIN = "https://zenguy-integration.cloudflareaccess.com";
const AUDIENCE = "integration-access-audience-000000000000000000000000000000";
const CONTEXT = {} as ExecutionContext;

async function accessFixture(
  identity: { subject?: string; commonName?: string } = {},
): Promise<{
  assertion: string;
  keyResolver: ReturnType<typeof createLocalJWKSet>;
  currentDate: Date;
}> {
  const now = Math.floor(Date.now() / 1_000);
  const pair = await generateKeyPair("RS256");
  const publicJwk = await exportJWK(pair.publicKey);
  const assertion = await new SignJWT({
    type: "app",
    ...(identity.commonName === undefined
      ? {}
      : { common_name: identity.commonName }),
  })
    .setProtectedHeader({ alg: "RS256", kid: "integration-key", typ: "JWT" })
    .setIssuer(TEAM_DOMAIN)
    .setAudience([AUDIENCE])
    .setSubject(identity.subject ?? "integration-access-user")
    .setIssuedAt(now)
    .setExpirationTime(now + 300)
    .sign(pair.privateKey);
  return {
    assertion,
    keyResolver: createLocalJWKSet({
      keys: [
        { ...publicJwk, alg: "RS256", kid: "integration-key", use: "sig" },
      ],
    }),
    currentDate: new Date(now * 1_000),
  };
}

function stagingEnv(): Bindings {
  const env: Bindings = {
    ...testEnv(),
    ENVIRONMENT: "staging",
    APP_URL: "https://staging-app.zenguy.com",
    CF_ACCESS_TEAM_DOMAIN: TEAM_DOMAIN,
    CF_ACCESS_AUD: AUDIENCE,
  };
  delete env.PADDLE_API_KEY;
  delete env.PADDLE_WEBHOOK_SECRET;
  delete env.PADDLE_CLIENT_TOKEN;
  delete env.PADDLE_ENVIRONMENT;
  delete env.PADDLE_PRODUCT_ID;
  delete env.PADDLE_PRICE_ID;
  delete env.PADDLE_OVERAGE_PRICE_ID;
  delete env.PADDLE_ALERT_CREDIT_PRODUCT_ID;
  delete env.PADDLE_ALERT_CREDIT_PRICE_ID;
  env.STRIPE_SECRET_KEY = "sk_test_integration123";
  env.STRIPE_WEBHOOK_SECRET = "whsec_integration123";
  env.STRIPE_ENVIRONMENT = "test";
  env.STRIPE_PRODUCT_ID = "prod_integration123";
  env.STRIPE_PRICE_ID = "price_integration123";
  env.STRIPE_OVERAGE_PRICE_ID = "price_overageintegration123";
  return env;
}

describe("staging Access Worker boundary", () => {
  it("denies every staging API surface before routing when the assertion is absent", async () => {
    const requests = [
      new Request("https://api-staging.zenguy.com/api/health"),
      new Request("https://staging-app.zenguy.com/api/auth/login", {
        method: "POST",
      }),
      new Request("https://staging-app.zenguy.com/api/webhooks/stripe", {
        method: "POST",
      }),
      new Request("https://api-staging.zenguy.com/api/runner/claim", {
        method: "POST",
      }),
      new Request("https://api-staging.zenguy.com/api/v1/workspaces"),
      new Request("https://api-staging.zenguy.com/api/health", {
        method: "OPTIONS",
      }),
    ];

    for (const request of requests) {
      const response = await handleHttpRequest(request, stagingEnv(), CONTEXT);
      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toEqual({
        error: { code: "FORBIDDEN", message: "Access denied" },
      });
    }
  });

  it("reaches Hono only after cryptographic Access verification succeeds", async () => {
    const fixture = await accessFixture();
    const response = await handleHttpRequest(
      new Request("https://api-staging.zenguy.com/api/health", {
        headers: { "Cf-Access-Jwt-Assertion": fixture.assertion },
      }),
      stagingEnv(),
      CONTEXT,
      fixture,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      data: { ok: true, environment: "staging", runnerDispatch: "queue" },
    });
  });

  it("accepts a service token and denies one without a client identity", async () => {
    const valid = await accessFixture({
      subject: "",
      commonName: "integration-runner.access",
    });
    const accepted = await handleHttpRequest(
      new Request("https://api-staging.zenguy.com/api/health", {
        headers: { "Cf-Access-Jwt-Assertion": valid.assertion },
      }),
      stagingEnv(),
      CONTEXT,
      valid,
    );
    expect(accepted.status).toBe(200);

    const unidentified = await accessFixture({
      subject: "",
      commonName: "   ",
    });
    const denied = await handleHttpRequest(
      new Request("https://api-staging.zenguy.com/api/health", {
        headers: { "Cf-Access-Jwt-Assertion": unidentified.assertion },
      }),
      stagingEnv(),
      CONTEXT,
      unidentified,
    );
    expect(denied.status).toBe(403);
    await expect(denied.json()).resolves.toEqual({
      error: { code: "FORBIDDEN", message: "Access denied" },
    });
  });

  it("lets only the exact Stripe POST reach its HMAC and strict body-limit checks", async () => {
    const invalidSignature = "t=1787472000,v1=invalid";
    const rejected = await handleHttpRequest(
      new Request("https://staging-app.zenguy.com/api/webhooks/stripe", {
        method: "POST",
        headers: { "Stripe-Signature": invalidSignature },
        body: "{}",
      }),
      stagingEnv(),
      CONTEXT,
    );
    expect(rejected.status).toBe(401);
    await expect(rejected.json()).resolves.toEqual({
      error: { code: "UNAUTHORIZED", message: "Invalid Stripe signature" },
    });

    const oversized = await handleHttpRequest(
      new Request("https://staging-app.zenguy.com/api/webhooks/stripe", {
        method: "POST",
        headers: { "Stripe-Signature": invalidSignature },
        body: "x".repeat(MAX_STRIPE_WEBHOOK_BODY_BYTES + 1),
      }),
      stagingEnv(),
      CONTEXT,
    );
    expect(oversized.status).toBe(413);
  });

  it("preserves health routing in development and production without Access bindings", async () => {
    for (const environment of ["development", "production"] as const) {
      const bindings = testEnv();
      bindings.ENVIRONMENT = environment;
      bindings.APP_URL =
        environment === "production"
          ? "https://app.zenguy.com"
          : "http://localhost:5173";
      delete bindings.CF_ACCESS_TEAM_DOMAIN;
      delete bindings.CF_ACCESS_AUD;

      const response = await handleHttpRequest(
        new Request(`${bindings.APP_URL}/api/health`),
        bindings,
        CONTEXT,
      );
      expect(response.status).toBe(200);
    }
  });
});
