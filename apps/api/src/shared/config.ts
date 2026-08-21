import { z } from "zod";

export interface Bindings {
  DB: D1Database;
  KV: KVNamespace;
  ARTIFACTS: R2Bucket;
  RUN_QUEUE: Queue;
  CHECK_QUEUE: Queue;
  NOTIFY_QUEUE: Queue;
  ENVIRONMENT: string;
  APP_URL: string;
  JWT_SECRET: string;
  ENCRYPTION_KEY: string;
  ARTIFACT_URL_SECRET: string;
  RUNNER_API_TOKEN: string;
  EMAIL: SendEmail;
  EMAIL_FROM: string;
  LLM_MODEL: string;
  TWILIO_ACCOUNT_SID: string;
  TWILIO_AUTH_TOKEN: string;
  TWILIO_FROM_SMS: string;
  TWILIO_FROM_WHATSAPP?: string;
  TWILIO_FROM_CALL: string;
  PADDLE_API_KEY?: string;
  PADDLE_WEBHOOK_SECRET?: string;
  PADDLE_CLIENT_TOKEN?: string;
  PADDLE_ENVIRONMENT?: string;
  PADDLE_PRICE_ID?: string;
  PADDLE_OVERAGE_PRICE_ID?: string;
  COMPLIMENTARY_ISSUER_EMAILS?: string;
}

export interface PaddleConfig {
  apiKey: string;
  webhookSecret: string;
  clientToken: string;
  environment: "sandbox" | "production";
  priceId: string;
  overagePriceId: string;
  apiBase: "https://sandbox-api.paddle.com" | "https://api.paddle.com";
}

export interface AppConfig {
  appUrl: string;
  environment: "development" | "staging" | "production";
  jwtSecret: string;
  encryptionKey: Uint8Array;
  artifactUrlSecret: string;
  runnerApiToken: string;
  emailFrom: string;
  llmModel: string;
  twilio: {
    accountSid: string;
    authToken: string;
    fromSms: string;
    fromWhatsapp: string | null;
    fromCall: string;
  };
  paddle: PaddleConfig | null;
  complimentaryIssuerEmails: string[];
}

const requiredEnvKeys = [
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
] as const satisfies readonly (keyof Bindings)[];

const paddleSecretKeys = [
  "PADDLE_API_KEY",
  "PADDLE_WEBHOOK_SECRET",
  "PADDLE_CLIENT_TOKEN",
  "PADDLE_PRICE_ID",
  "PADDLE_OVERAGE_PRICE_ID",
] as const satisfies readonly (keyof Bindings)[];

const paddleRequiredKeys = [
  ...paddleSecretKeys,
  "PADDLE_ENVIRONMENT",
] as const satisfies readonly (keyof Bindings)[];

function optionalNonEmptyString() {
  return z.preprocess(
    (value) =>
      typeof value === "string" && value.trim() === "" ? undefined : value,
    z.string().min(1).optional(),
  );
}

const envSchema = z.object({
  APP_URL: z.url(),
  ENVIRONMENT: z.enum(["development", "staging", "production"]),
  JWT_SECRET: z.string().min(32),
  ENCRYPTION_KEY: z.string().min(1),
  ARTIFACT_URL_SECRET: z.string().min(32),
  RUNNER_API_TOKEN: z.string().min(32),
  EMAIL_FROM: z.string().min(1),
  LLM_MODEL: z.string().min(1),
  TWILIO_ACCOUNT_SID: z.string().min(1),
  TWILIO_AUTH_TOKEN: z.string().min(1),
  TWILIO_FROM_SMS: z.string().min(1),
  TWILIO_FROM_WHATSAPP: optionalNonEmptyString(),
  TWILIO_FROM_CALL: z.string().min(1),
});

const paddleEnvSchema = z.object({
  PADDLE_API_KEY: z.string().min(1),
  PADDLE_WEBHOOK_SECRET: z.string().min(1),
  PADDLE_CLIENT_TOKEN: z.string().min(1),
  PADDLE_ENVIRONMENT: z.enum(["sandbox", "production"]),
  PADDLE_PRICE_ID: z.string().min(1),
  PADDLE_OVERAGE_PRICE_ID: z.string().min(1),
});

export function parseComplimentaryIssuerEmails(value: unknown): string[] {
  if (typeof value !== "string" || value.trim() === "") return [];
  const emails = new Set<string>();
  for (const part of value.split(",")) {
    const email = part.trim().toLowerCase();
    if (email.includes("@")) emails.add(email);
  }
  return [...emails];
}

export function isComplimentaryIssuer(
  emails: readonly string[],
  email: string,
): boolean {
  return emails.includes(email.trim().toLowerCase());
}

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
  const paddleEnabled = paddleSecretKeys.some((key) => {
    const value = env[key];
    return typeof value === "string" && value.trim().length > 0;
  });
  let paddle: PaddleConfig | null = null;
  if (paddleEnabled) {
    const missingPaddle = paddleRequiredKeys.filter((key) => {
      const value = env[key];
      return typeof value !== "string" || value.trim().length === 0;
    });
    if (missingPaddle.length > 0) {
      throw new Error(`Missing Paddle env: ${missingPaddle.join(", ")}`);
    }
    const parsedPaddle = paddleEnvSchema.parse(env);
    paddle = {
      apiKey: parsedPaddle.PADDLE_API_KEY,
      webhookSecret: parsedPaddle.PADDLE_WEBHOOK_SECRET,
      clientToken: parsedPaddle.PADDLE_CLIENT_TOKEN,
      environment: parsedPaddle.PADDLE_ENVIRONMENT,
      priceId: parsedPaddle.PADDLE_PRICE_ID,
      overagePriceId: parsedPaddle.PADDLE_OVERAGE_PRICE_ID,
      apiBase:
        parsedPaddle.PADDLE_ENVIRONMENT === "sandbox"
          ? "https://sandbox-api.paddle.com"
          : "https://api.paddle.com",
    };
  }

  return {
    appUrl: parsed.APP_URL,
    environment: parsed.ENVIRONMENT,
    jwtSecret: parsed.JWT_SECRET,
    encryptionKey: decodeEncryptionKey(parsed.ENCRYPTION_KEY),
    artifactUrlSecret: parsed.ARTIFACT_URL_SECRET,
    runnerApiToken: parsed.RUNNER_API_TOKEN,
    emailFrom: parsed.EMAIL_FROM,
    llmModel: parsed.LLM_MODEL,
    twilio: {
      accountSid: parsed.TWILIO_ACCOUNT_SID,
      authToken: parsed.TWILIO_AUTH_TOKEN,
      fromSms: parsed.TWILIO_FROM_SMS,
      fromWhatsapp: parsed.TWILIO_FROM_WHATSAPP ?? null,
      fromCall: parsed.TWILIO_FROM_CALL,
    },
    paddle,
    complimentaryIssuerEmails: parseComplimentaryIssuerEmails(
      env.COMPLIMENTARY_ISSUER_EMAILS,
    ),
  };
}
