import { FixedClock } from "../../shared/clock";
import type { Bindings } from "../../shared/config";
import { FakeKv } from "./kv";
import { fakeKeyWrappingService } from "./key_wrapping";

export function fakeBindings(): Bindings {
  return {
    DB: {} as D1Database,
    KV: new FakeKv(new FixedClock(Date.now())),
    ARTIFACTS: {} as R2Bucket,
    RUN_QUEUE: {} as Queue,
    CHECK_QUEUE: {} as Queue,
    NOTIFY_QUEUE: {} as Queue,
    EMAIL: {
      send: async () => ({ messageId: "test-email" }),
    } as SendEmail,
    ENVIRONMENT: "development",
    APP_URL: "https://app.zenguy.test",
    JWT_SECRET: "jwt-test-secret".padEnd(32, "-"),
    ENCRYPTION_KEY: "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=",
    ENCRYPTION_KEY_ID: "test-key-current",
    KEY_WRAPPING: fakeKeyWrappingService(),
    KEY_WRAPPING_KEY_ID: "test-wrapping-current",
    ARTIFACT_URL_SECRET: "artifact-test-secret".padEnd(32, "-"),
    RUNNER_API_TOKEN: "runner-test-secret".padEnd(32, "-"),
    RUNNER_FALLBACK_API_TOKEN: "fallback-runner-test-secret".padEnd(32, "-"),
    RUNNER_CAPABILITY_SECRET: "runner-capability-test-secret".padEnd(32, "-"),
    EMAIL_FROM: "Zenguy <notifications@zenguy.com>",
    LLM_MODEL: "gpt-5-mini",
    TWILIO_ACCOUNT_SID: "test-twilio-sid",
    TWILIO_AUTH_TOKEN: "test-twilio-token",
    TWILIO_FROM_SMS: "+34600000001",
    TWILIO_FROM_WHATSAPP: "+34600000002",
    TWILIO_FROM_CALL: "+34600000003",
    PADDLE_API_KEY: "test-paddle-key",
    PADDLE_WEBHOOK_SECRET: "test-paddle-webhook-secret",
    PADDLE_CLIENT_TOKEN: "test-paddle-client-token",
    PADDLE_ENVIRONMENT: "sandbox",
    PADDLE_PRODUCT_ID: "pro_test_zenguy",
    PADDLE_PRICE_ID: "pri_test_monthly",
    PADDLE_OVERAGE_PRICE_ID: "pri_test_overage",
  };
}
