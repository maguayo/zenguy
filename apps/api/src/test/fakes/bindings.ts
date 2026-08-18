import { FixedClock } from "../../shared/clock";
import type { Bindings } from "../../shared/config";
import { FakeKv } from "./kv";

export function fakeBindings(): Bindings {
  return {
    DB: {} as D1Database,
    KV: new FakeKv(new FixedClock(Date.now())),
    ARTIFACTS: {} as R2Bucket,
    BROWSER: {} as BrowserRun,
    RUN_QUEUE: {} as Queue,
    CHECK_QUEUE: {} as Queue,
    NOTIFY_QUEUE: {} as Queue,
    ASSETS: {} as Fetcher,
    ENVIRONMENT: "development",
    APP_URL: "https://app.zenguy.test",
    JWT_SECRET: "jwt-test-secret".padEnd(32, "-"),
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
