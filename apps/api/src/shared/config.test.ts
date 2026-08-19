import { loadConfig, type Bindings } from "./config";

function encryptionKey(byte = 1, length = 32): string {
  return btoa(String.fromCharCode(...new Uint8Array(length).fill(byte)));
}

function completeBindings(): Bindings {
  return {
    DB: {} as D1Database,
    KV: {} as KVNamespace,
    ARTIFACTS: {} as R2Bucket,
    BROWSER: {} as BrowserRun,
    RUN_QUEUE: {} as Queue,
    CHECK_QUEUE: {} as Queue,
    NOTIFY_QUEUE: {} as Queue,
    EMAIL: {} as SendEmail,
    ENVIRONMENT: "development",
    APP_URL: "http://localhost:5173",
    JWT_SECRET: "j".repeat(32),
    ENCRYPTION_KEY: encryptionKey(),
    ARTIFACT_URL_SECRET: "a".repeat(32),
    EMAIL_FROM: "Zenguy <notifications@example.com>",
    OPENAI_API_KEY: "openai-test",
    LLM_MODEL: "gpt-5-mini",
    LLM_USE_VISION: "true",
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
      "EMAIL_FROM",
      "OPENAI_API_KEY",
      "LLM_MODEL",
      "LLM_USE_VISION",
      "TWILIO_ACCOUNT_SID",
      "TWILIO_AUTH_TOKEN",
      "TWILIO_FROM_SMS",
      "TWILIO_FROM_WHATSAPP",
      "TWILIO_FROM_CALL",
      "PADDLE_API_KEY",
      "PADDLE_WEBHOOK_SECRET",
      "PADDLE_CLIENT_TOKEN",
      "PADDLE_ENVIRONMENT",
      "PADDLE_PRICE_ID",
      "PADDLE_OVERAGE_PRICE_ID",
    ]) {
      expect(message).toContain(name);
    }
  });

  it("parses a complete environment", () => {
    const config = loadConfig(completeBindings());

    expect(config.environment).toBe("development");
    expect(config.encryptionKey).toEqual(new Uint8Array(32).fill(1));
    expect(config.llmUseVision).toBe(true);
    expect(config.openaiApiKey).toBe("openai-test");
    expect(config.llmModel).toBe("gpt-5-mini");
    expect(config.paddle).toMatchObject({
      environment: "sandbox",
      apiBase: "https://sandbox-api.paddle.com",
      priceId: "pri_monthly",
      overagePriceId: "pri_overage",
    });
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
