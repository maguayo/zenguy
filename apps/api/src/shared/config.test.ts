import { loadConfig, type Bindings } from "./config";

import { D1WorkspaceDataKeyStore } from "../infrastructure/db/workspace_data_key_store";
import {
  CloudflareKeyWrappingProvider,
  type KeyWrappingServiceBinding,
} from "../infrastructure/crypto/cloudflare_key_wrapping";

function encryptionKey(byte = 1, length = 32): string {
  return btoa(String.fromCharCode(...new Uint8Array(length).fill(byte)));
}

function keyWrappingService(): KeyWrappingServiceBinding {
  return {
    wrapDataKey: async () => {
      throw new Error("not called while loading config");
    },
    unwrapDataKey: async () => {
      throw new Error("not called while loading config");
    },
  };
}

function completeBindings(): Bindings {
  return {
    DB: {} as D1Database,
    KV: {} as KVNamespace,
    ARTIFACTS: {} as R2Bucket,
    RUN_QUEUE: {} as Queue,
    CHECK_QUEUE: {} as Queue,
    NOTIFY_QUEUE: {} as Queue,
    EMAIL: {} as SendEmail,
    ENVIRONMENT: "development",
    APP_URL: "http://localhost:5173",
    JWT_SECRET: "j".repeat(32),
    ENCRYPTION_KEY: encryptionKey(),
    ENCRYPTION_KEY_ID: "key-current",
    KEY_WRAPPING: keyWrappingService(),
    KEY_WRAPPING_KEY_ID: "wrapping-current",
    ARTIFACT_URL_SECRET: "a".repeat(32),
    RUNNER_API_TOKEN: "r".repeat(32),
    RUNNER_FALLBACK_API_TOKEN: "f".repeat(32),
    RUNNER_CAPABILITY_SECRET: "c".repeat(32),
    EMAIL_FROM: "Zenguy <notifications@example.com>",
    LLM_MODEL: "gpt-5-mini",
    TWILIO_ACCOUNT_SID: "twilio-sid",
    TWILIO_AUTH_TOKEN: "twilio-token",
    TWILIO_FROM_SMS: "+34600000001",
    TWILIO_FROM_WHATSAPP: "+34600000002",
    TWILIO_FROM_CALL: "+34600000003",
    PADDLE_API_KEY: "paddle-api",
    PADDLE_WEBHOOK_SECRET: "paddle-webhook",
    PADDLE_CLIENT_TOKEN: "paddle-client",
    PADDLE_ENVIRONMENT: "sandbox",
    PADDLE_PRODUCT_ID: "pro_monthly",
    PADDLE_PRICE_ID: "pri_monthly",
    PADDLE_OVERAGE_PRICE_ID: "pri_overage",
  };
}

function stripeBindings(): Bindings {
  const env = completeBindings();
  delete env.PADDLE_API_KEY;
  delete env.PADDLE_WEBHOOK_SECRET;
  delete env.PADDLE_CLIENT_TOKEN;
  delete env.PADDLE_PRODUCT_ID;
  delete env.PADDLE_PRICE_ID;
  delete env.PADDLE_OVERAGE_PRICE_ID;
  delete env.PADDLE_ENVIRONMENT;
  env.STRIPE_SECRET_KEY = "sk_test_example123";
  env.STRIPE_WEBHOOK_SECRET = "whsec_example123";
  env.STRIPE_ENVIRONMENT = "test";
  env.STRIPE_PRODUCT_ID = "prod_monthly123";
  env.STRIPE_PRICE_ID = "price_monthly123";
  env.STRIPE_OVERAGE_PRICE_ID = "price_overage123";
  env.STRIPE_ALERT_CREDIT_PRODUCT_ID = "prod_alert123";
  env.STRIPE_ALERT_CREDIT_PRICE_ID = "price_alert123";
  return env;
}

describe("loadConfig", () => {
  it("names every missing environment variable in one error", () => {
    let message = "";
    try {
      loadConfig({} as Bindings);
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      if (error instanceof Error) {
        message = error.message;
      }
    }

    expect(message).toMatch(/^Missing env: /);
    for (const name of [
      "APP_URL",
      "ENVIRONMENT",
      "JWT_SECRET",
      "ENCRYPTION_KEY",
      "ENCRYPTION_KEY_ID",
      "ARTIFACT_URL_SECRET",
      "RUNNER_API_TOKEN",
      "RUNNER_FALLBACK_API_TOKEN",
      "RUNNER_CAPABILITY_SECRET",
      "EMAIL_FROM",
      "LLM_MODEL",
      "TWILIO_ACCOUNT_SID",
      "TWILIO_AUTH_TOKEN",
      "TWILIO_FROM_SMS",
      "TWILIO_FROM_CALL",
    ]) {
      expect(message).toContain(name);
    }
    expect(message).not.toContain("TWILIO_FROM_WHATSAPP");
    expect(message).not.toContain("PADDLE_API_KEY");
  });

  it("parses a complete environment", () => {
    const config = loadConfig(completeBindings());

    expect(config.environment).toBe("development");
    expect(config.encryptionKeys).toMatchObject({
      active: { id: "key-current", key: new Uint8Array(32).fill(1) },
      previous: [],
    });
    expect(config.encryptionKeys.workspaceDataKeys).toBeInstanceOf(
      D1WorkspaceDataKeyStore,
    );
    expect(config.runnerApiToken).toBe("r".repeat(32));
    expect(config.runnerFallbackApiToken).toBe("f".repeat(32));
    expect(config.runnerCapabilitySecret).toBe("c".repeat(32));
    expect(config.llmModel).toBe("gpt-5-mini");
    expect(config.paddle).toMatchObject({
      environment: "sandbox",
      apiBase: "https://sandbox-api.paddle.com",
      productId: "pro_monthly",
      priceId: "pri_monthly",
      overagePriceId: "pri_overage",
    });
    expect(config.complimentaryIssuerEmails).toEqual([]);
  });

  it("parses Stripe as the exclusive billing provider", () => {
    const config = loadConfig(stripeBindings());

    expect(config.paddle).toBeNull();
    expect(config.stripe).toMatchObject({
      environment: "test",
      apiBase: "https://api.stripe.com",
      productId: "prod_monthly123",
      priceId: "price_monthly123",
      overagePriceId: "price_overage123",
      alertCreditProductId: "prod_alert123",
      alertCreditPriceId: "price_alert123",
    });
  });

  it("accepts a least-privilege Stripe restricted key", () => {
    const env = stripeBindings();
    env.STRIPE_SECRET_KEY = "rk_test_restricted123";

    expect(loadConfig(env).stripe?.secretKey).toBe("rk_test_restricted123");
  });

  it("rejects a Stripe key from the wrong environment", () => {
    const env = stripeBindings();
    env.STRIPE_ENVIRONMENT = "live";

    expect(() => loadConfig(env)).toThrow(
      "STRIPE_SECRET_KEY does not match STRIPE_ENVIRONMENT",
    );
  });

  it("rejects alert-credit IDs without the Stripe core group", () => {
    const env = completeBindings();
    delete env.PADDLE_API_KEY;
    delete env.PADDLE_WEBHOOK_SECRET;
    delete env.PADDLE_CLIENT_TOKEN;
    delete env.PADDLE_PRODUCT_ID;
    delete env.PADDLE_PRICE_ID;
    delete env.PADDLE_OVERAGE_PRICE_ID;
    delete env.PADDLE_ENVIRONMENT;
    env.STRIPE_ALERT_CREDIT_PRODUCT_ID = "prod_alert123";
    env.STRIPE_ALERT_CREDIT_PRICE_ID = "price_alert123";

    expect(() => loadConfig(env)).toThrow(
      "Missing Stripe env: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, STRIPE_PRODUCT_ID, STRIPE_PRICE_ID, STRIPE_OVERAGE_PRICE_ID, STRIPE_ENVIRONMENT",
    );
  });

  it("starts safely with Paddle and WhatsApp disabled", () => {
    const env = completeBindings();
    delete env.TWILIO_FROM_WHATSAPP;
    delete env.PADDLE_API_KEY;
    delete env.PADDLE_WEBHOOK_SECRET;
    delete env.PADDLE_CLIENT_TOKEN;
    delete env.PADDLE_PRODUCT_ID;
    delete env.PADDLE_PRICE_ID;
    delete env.PADDLE_OVERAGE_PRICE_ID;
    // Wrangler may still provide this non-secret variable. It must not enable
    // Paddle without the complete secret group.
    env.PADDLE_ENVIRONMENT = "production";

    const config = loadConfig(env);

    expect(config.twilio.fromWhatsapp).toBeNull();
    expect(config.paddle).toBeNull();
  });

  it("rejects a partially configured Paddle secret group", () => {
    const env = completeBindings();
    delete env.PADDLE_WEBHOOK_SECRET;
    delete env.PADDLE_CLIENT_TOKEN;
    delete env.PADDLE_PRODUCT_ID;
    delete env.PADDLE_PRICE_ID;
    delete env.PADDLE_OVERAGE_PRICE_ID;

    expect(() => loadConfig(env)).toThrowError(
      "Missing Paddle env: PADDLE_WEBHOOK_SECRET, PADDLE_CLIENT_TOKEN, PADDLE_PRODUCT_ID, PADDLE_PRICE_ID, PADDLE_OVERAGE_PRICE_ID",
    );
  });

  it("requires alert-credit product and price IDs as a pair", () => {
    const missingProduct = completeBindings();
    missingProduct.PADDLE_ALERT_CREDIT_PRICE_ID = "pri_alert_credit";
    expect(() => loadConfig(missingProduct)).toThrow(
      "PADDLE_ALERT_CREDIT_PRODUCT_ID and PADDLE_ALERT_CREDIT_PRICE_ID must be configured together",
    );

    const missingPrice = completeBindings();
    missingPrice.PADDLE_ALERT_CREDIT_PRODUCT_ID = "pro_alert_credit";
    expect(() => loadConfig(missingPrice)).toThrow(
      "PADDLE_ALERT_CREDIT_PRODUCT_ID and PADDLE_ALERT_CREDIT_PRICE_ID must be configured together",
    );
  });

  it("parses complimentary issuer emails without requiring the binding", () => {
    const env = completeBindings();
    env.COMPLIMENTARY_ISSUER_EMAILS = " Marcos@aguayo.es, friend@example.com ,";

    expect(loadConfig(env).complimentaryIssuerEmails).toEqual([
      "marcos@aguayo.es",
      "friend@example.com",
    ]);
  });

  it("accepts staging as an application environment", () => {
    const env = completeBindings();
    env.ENVIRONMENT = "staging";
    env.APP_URL = "https://staging-app.zenguy.com";

    const config = loadConfig(env);

    expect(config.environment).toBe("staging");
    expect(config.appUrl).toBe("https://staging-app.zenguy.com");
    expect(config.encryptionKeys.keyEncryption).toBeInstanceOf(
      CloudflareKeyWrappingProvider,
    );
    expect(config.encryptionKeys.keyEncryption.activeKeyId).toBe(
      "wrapping-current",
    );
    expect(env).not.toHaveProperty("ASSETS");
  });

  it("fails closed in named environments without the KMS capability and key ID", () => {
    const missingBoth = completeBindings();
    missingBoth.ENVIRONMENT = "production";
    delete missingBoth.KEY_WRAPPING;
    delete missingBoth.KEY_WRAPPING_KEY_ID;
    expect(() => loadConfig(missingBoth)).toThrow(
      "Missing key-wrapping bindings: KEY_WRAPPING_KEY_ID, KEY_WRAPPING",
    );

    const malformedCapability = completeBindings();
    malformedCapability.ENVIRONMENT = "staging";
    malformedCapability.KEY_WRAPPING = {} as KeyWrappingServiceBinding;
    expect(() => loadConfig(malformedCapability)).toThrow(
      "Missing key-wrapping Service Binding",
    );
  });

  it("rejects an encryption key that does not decode to 32 bytes", () => {
    const env = completeBindings();
    env.ENCRYPTION_KEY = encryptionKey(1, 31);

    expect(() => loadConfig(env)).toThrowError(
      "ENCRYPTION_KEY must decode to exactly 32 bytes",
    );
  });

  it("parses previous encryption keys for dual-read without making them required", () => {
    const env = completeBindings();
    env.ENCRYPTION_PREVIOUS_KEYS = JSON.stringify({
      "key-previous-2": encryptionKey(2),
      "key-previous-3": encryptionKey(3),
    });

    expect(loadConfig(env).encryptionKeys).toMatchObject({
      active: { id: "key-current", key: new Uint8Array(32).fill(1) },
      previous: [
        { id: "key-previous-2", key: new Uint8Array(32).fill(2) },
        { id: "key-previous-3", key: new Uint8Array(32).fill(3) },
      ],
    });
  });

  it("rejects malformed, duplicate, or invalid previous encryption keys", () => {
    const malformed = completeBindings();
    malformed.ENCRYPTION_PREVIOUS_KEYS = "not-json";
    expect(() => loadConfig(malformed)).toThrow("ENCRYPTION_PREVIOUS_KEYS");

    const duplicate = completeBindings();
    duplicate.ENCRYPTION_PREVIOUS_KEYS = JSON.stringify({
      "key-current": encryptionKey(2),
    });
    expect(() => loadConfig(duplicate)).toThrow("Duplicate encryption key id");

    const short = completeBindings();
    short.ENCRYPTION_PREVIOUS_KEYS = JSON.stringify({
      "key-previous": encryptionKey(2, 31),
    });
    expect(() => loadConfig(short)).toThrow("must decode to exactly 32 bytes");
  });
});
