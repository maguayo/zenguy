import { z } from "zod";

export interface Bindings {
  DB: D1Database;
  KV: KVNamespace;
  ARTIFACTS: R2Bucket;
  BROWSER: BrowserRun;
  RUN_QUEUE: Queue;
  CHECK_QUEUE: Queue;
  NOTIFY_QUEUE: Queue;
  ENVIRONMENT: string;
  APP_URL: string;
  JWT_SECRET: string;
  ENCRYPTION_KEY: string;
  ARTIFACT_URL_SECRET: string;
  EMAIL: SendEmail;
  EMAIL_FROM: string;
  OPENAI_API_KEY: string;
  LLM_MODEL: string;
  LLM_USE_VISION: string;
  TWILIO_ACCOUNT_SID: string;
  TWILIO_AUTH_TOKEN: string;
  TWILIO_FROM_SMS: string;
  TWILIO_FROM_WHATSAPP: string;
  TWILIO_FROM_CALL: string;
  PADDLE_API_KEY: string;
  PADDLE_WEBHOOK_SECRET: string;
  PADDLE_CLIENT_TOKEN: string;
  PADDLE_ENVIRONMENT: string;
  PADDLE_PRICE_ID: string;
  PADDLE_OVERAGE_PRICE_ID: string;
}

export interface AppConfig {
  appUrl: string;
  environment: "development" | "staging" | "production";
  jwtSecret: string;
  encryptionKey: Uint8Array;
  artifactUrlSecret: string;
  emailFrom: string;
  openaiApiKey: string;
  llmModel: string;
  llmUseVision: boolean;
  twilio: {
    accountSid: string;
    authToken: string;
    fromSms: string;
    fromWhatsapp: string;
    fromCall: string;
  };
  paddle: {
    apiKey: string;
    webhookSecret: string;
    clientToken: string;
    environment: "sandbox" | "production";
    priceId: string;
    overagePriceId: string;
    apiBase: "https://sandbox-api.paddle.com" | "https://api.paddle.com";
  };
}

const requiredEnvKeys = [
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
] as const satisfies readonly (keyof Bindings)[];

const envSchema = z.object({
  APP_URL: z.url(),
  ENVIRONMENT: z.enum(["development", "staging", "production"]),
  JWT_SECRET: z.string().min(32),
  ENCRYPTION_KEY: z.string().min(1),
  ARTIFACT_URL_SECRET: z.string().min(32),
  EMAIL_FROM: z.string().min(1),
  OPENAI_API_KEY: z.string().min(1),
  LLM_MODEL: z.string().min(1),
  LLM_USE_VISION: z.enum(["true", "false"]),
  TWILIO_ACCOUNT_SID: z.string().min(1),
  TWILIO_AUTH_TOKEN: z.string().min(1),
  TWILIO_FROM_SMS: z.string().min(1),
  TWILIO_FROM_WHATSAPP: z.string().min(1),
  TWILIO_FROM_CALL: z.string().min(1),
  PADDLE_API_KEY: z.string().min(1),
  PADDLE_WEBHOOK_SECRET: z.string().min(1),
  PADDLE_CLIENT_TOKEN: z.string().min(1),
  PADDLE_ENVIRONMENT: z.enum(["sandbox", "production"]),
  PADDLE_PRICE_ID: z.string().min(1),
  PADDLE_OVERAGE_PRICE_ID: z.string().min(1),
});

function decodeEncryptionKey(encoded: string): Uint8Array {
  let decoded: string;
  try {
    decoded = atob(encoded);
  } catch {
    throw new Error("ENCRYPTION_KEY must be valid base64 encoding exactly 32 bytes");
  }

  const bytes = Uint8Array.from(decoded, (character) => character.charCodeAt(0));
  if (bytes.byteLength !== 32) {
    throw new Error("ENCRYPTION_KEY must decode to exactly 32 bytes");
  }
  return bytes;
}

export function loadConfig(env: Bindings): AppConfig {
  const missing = requiredEnvKeys.filter((key) => {
    const value = env[key];
    if (typeof value !== "string") {
      return true;
    }
    return value.trim().length === 0;
  });
  if (missing.length > 0) {
    throw new Error(`Missing env: ${missing.join(", ")}`);
  }

  const parsed = envSchema.parse(env);
  const paddleApiBase =
    parsed.PADDLE_ENVIRONMENT === "sandbox"
      ? "https://sandbox-api.paddle.com"
      : "https://api.paddle.com";

  return {
    appUrl: parsed.APP_URL,
    environment: parsed.ENVIRONMENT,
    jwtSecret: parsed.JWT_SECRET,
    encryptionKey: decodeEncryptionKey(parsed.ENCRYPTION_KEY),
    artifactUrlSecret: parsed.ARTIFACT_URL_SECRET,
    emailFrom: parsed.EMAIL_FROM,
    openaiApiKey: parsed.OPENAI_API_KEY,
    llmModel: parsed.LLM_MODEL,
    llmUseVision: parsed.LLM_USE_VISION === "true",
    twilio: {
      accountSid: parsed.TWILIO_ACCOUNT_SID,
      authToken: parsed.TWILIO_AUTH_TOKEN,
      fromSms: parsed.TWILIO_FROM_SMS,
      fromWhatsapp: parsed.TWILIO_FROM_WHATSAPP,
      fromCall: parsed.TWILIO_FROM_CALL,
    },
    paddle: {
      apiKey: parsed.PADDLE_API_KEY,
      webhookSecret: parsed.PADDLE_WEBHOOK_SECRET,
      clientToken: parsed.PADDLE_CLIENT_TOKEN,
      environment: parsed.PADDLE_ENVIRONMENT,
      priceId: parsed.PADDLE_PRICE_ID,
      overagePriceId: parsed.PADDLE_OVERAGE_PRICE_ID,
      apiBase: paddleApiBase,
    },
  };
}
