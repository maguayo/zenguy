import { env } from "cloudflare:test";
import type { Bindings } from "../shared/config";

const DELETE_STATEMENTS = [
  "DELETE FROM refresh_tokens",
  "DELETE FROM email_tokens",
  "DELETE FROM users",
] as const;

export function testEnv(): Bindings {
  return {
    ...env,
    ENVIRONMENT: "development",
    APP_URL: "http://localhost:5173",
    JWT_SECRET: "test-secret".padEnd(32, "-"),
    ENCRYPTION_KEY: "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=",
    ARTIFACT_URL_SECRET: "artifact-test-secret".padEnd(32, "-"),
    RESEND_API_KEY: "",
    EMAIL_FROM: "Zenguy <test@example.com>",
    ANTHROPIC_API_KEY: "test-anthropic-key",
    LLM_MODEL: "claude-test",
    LLM_USE_VISION: "true",
    TWILIO_ACCOUNT_SID: "test-twilio-sid",
    TWILIO_AUTH_TOKEN: "test-twilio-token",
    TWILIO_FROM_SMS: "+34600000001",
    TWILIO_FROM_WHATSAPP: "+34600000002",
    TWILIO_FROM_CALL: "+34600000003",
    PADDLE_API_KEY: "test-paddle-key",
    PADDLE_WEBHOOK_SECRET: "test-paddle-webhook-secret",
    PADDLE_CLIENT_TOKEN: "test-paddle-client-token",
    PADDLE_ENVIRONMENT: "sandbox",
    PADDLE_PRICE_ID: "pri_test_monthly",
    PADDLE_OVERAGE_PRICE_ID: "pri_test_overage",
  };
}

export async function freshDb(): Promise<void> {
  await testEnv().DB.batch(
    DELETE_STATEMENTS.map((statement) => testEnv().DB.prepare(statement)),
  );
}
