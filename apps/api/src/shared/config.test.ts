import { loadConfig, type Bindings } from "./config";

function encryptionKey(byte = 1, length = 32): string {
  return btoa(String.fromCharCode(...new Uint8Array(length).fill(byte)));
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
    ARTIFACT_URL_SECRET: "a".repeat(32),
    RUNNER_API_TOKEN: "r".repeat(32),
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
    PADDLE_PRICE_ID: "pri_monthly",
    PADDLE_OVERAGE_PRICE_ID: "pri_overage",
  };
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
      "ARTIFACT_URL_SECRET",
      "RUNNER_API_TOKEN",
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
    expect(config.encryptionKey).toEqual(new Uint8Array(32).fill(1));
    expect(config.runnerApiToken).toBe("r".repeat(32));
    expect(config.llmModel).toBe("gpt-5-mini");
    expect(config.paddle).toMatchObject({
      environment: "sandbox",
      apiBase: "https://sandbox-api.paddle.com",
      priceId: "pri_monthly",
      overagePriceId: "pri_overage",
    });
    expect(config.complimentaryIssuerEmails).toEqual([]);
  });

  it("starts safely with Paddle and WhatsApp disabled", () => {
    const env = completeBindings();
    delete env.TWILIO_FROM_WHATSAPP;
    delete env.PADDLE_API_KEY;
    delete env.PADDLE_WEBHOOK_SECRET;
    delete env.PADDLE_CLIENT_TOKEN;
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
    delete env.PADDLE_PRICE_ID;
    delete env.PADDLE_OVERAGE_PRICE_ID;

    expect(() => loadConfig(env)).toThrowError(
      "Missing Paddle env: PADDLE_WEBHOOK_SECRET, PADDLE_CLIENT_TOKEN, PADDLE_PRICE_ID, PADDLE_OVERAGE_PRICE_ID",
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
    expect(env).not.toHaveProperty("ASSETS");
  });

  it("rejects an encryption key that does not decode to 32 bytes", () => {
    const env = completeBindings();
    env.ENCRYPTION_KEY = encryptionKey(1, 31);

    expect(() => loadConfig(env)).toThrowError(
      "ENCRYPTION_KEY must decode to exactly 32 bytes",
    );
  });
});
