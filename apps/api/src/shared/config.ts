import { z } from "zod";
import {
  createEncryptionKeyring,
  type EncryptionKeyVersion,
  type EncryptionKeyring,
} from "./crypto";
import { D1WorkspaceDataKeyStore } from "../infrastructure/db/workspace_data_key_store";
import {
  CloudflareKeyWrappingProvider,
  type KeyWrappingServiceBinding,
} from "../infrastructure/crypto/cloudflare_key_wrapping";

interface OptionalBindings {
  /** Required for staging and the production runner; exact Access team origin. */
  CF_ACCESS_TEAM_DOMAIN?: string;
  /** Required only in staging; audience tag of the Access app covering both API routes. */
  CF_ACCESS_AUD?: string;
  /** Required in production; audience of the service-only runner Access app. */
  CF_RUNNER_ACCESS_AUD?: string;
  RUNNER_CF_ACCESS_COMMON_NAME?: string;
  ENCRYPTION_PREVIOUS_KEYS?: string;
  /** Required in named environments; private RPC capability, not a URL/token. */
  KEY_WRAPPING?: KeyWrappingServiceBinding;
  /** Non-secret active KEK identifier expected from KEY_WRAPPING. */
  KEY_WRAPPING_KEY_ID?: string;
  TWILIO_FROM_WHATSAPP?: string;
  PADDLE_API_KEY?: string;
  PADDLE_WEBHOOK_SECRET?: string;
  PADDLE_CLIENT_TOKEN?: string;
  PADDLE_ENVIRONMENT?: string;
  PADDLE_PRODUCT_ID?: string;
  PADDLE_PRICE_ID?: string;
  PADDLE_OVERAGE_PRICE_ID?: string;
  PADDLE_ALERT_CREDIT_PRODUCT_ID?: string;
  PADDLE_ALERT_CREDIT_PRICE_ID?: string;
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  STRIPE_ENVIRONMENT?: string;
  STRIPE_PRODUCT_ID?: string;
  STRIPE_PRICE_ID?: string;
  STRIPE_OVERAGE_PRICE_ID?: string;
  STRIPE_ALERT_CREDIT_PRODUCT_ID?: string;
  STRIPE_ALERT_CREDIT_PRICE_ID?: string;
  COMPLIMENTARY_ISSUER_EMAILS?: string;
  IOS_APP_STORE_URL?: string;
  EXPO_PUSH_ACCESS_TOKEN?: string;
}

interface WidenedConfigBindings {
  ENVIRONMENT: string;
  APP_URL: string;
  ENCRYPTION_KEY_ID: string;
  LLM_MODEL: string;
  EMAIL_FROM: string;
}

type BindingOverrides = OptionalBindings & WidenedConfigBindings;

/**
 * Binding names and platform types come from the committed Wrangler output.
 * Runtime-optional feature groups stay optional so development can fail closed
 * through `loadConfig` instead of requiring placeholder secrets.
 */
export type Bindings = Omit<
  Env,
  keyof BindingOverrides
> &
  BindingOverrides;

export interface PaddleConfig {
  apiKey: string;
  webhookSecret: string;
  clientToken: string;
  environment: "sandbox" | "production";
  productId: string;
  priceId: string;
  overagePriceId: string;
  /** One-time price for a €10 alert-credit pack; null disables top-ups. */
  alertCreditPriceId: string | null;
  /** Product owning the alert-credit price; null disables top-ups. */
  alertCreditProductId: string | null;
  apiBase: "https://sandbox-api.paddle.com" | "https://api.paddle.com";
}

export interface StripeConfig {
  secretKey: string;
  webhookSecret: string;
  environment: "test" | "live";
  productId: string;
  priceId: string;
  overagePriceId: string;
  /** One-time price for a €10 alert-credit pack; null disables top-ups. */
  alertCreditPriceId: string | null;
  /** Product owning the alert-credit price; null disables top-ups. */
  alertCreditProductId: string | null;
  apiBase: "https://api.stripe.com";
}

export interface AppConfig {
  appUrl: string;
  environment: "development" | "staging" | "production";
  jwtSecret: string;
  encryptionKeys: EncryptionKeyring;
  artifactUrlSecret: string;
  runnerApiToken: string;
  runnerFallbackApiToken: string;
  // Vacío cuando el runner de Cloudflare Containers no está desplegado en el
  // entorno; las rutas lo tratan como modo cf deshabilitado (fail-closed).
  runnerCfApiToken: string;
  runnerCapabilitySecret: string;
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
  stripe: StripeConfig | null;
  complimentaryIssuerEmails: string[];
  iosAppStoreUrl: string | null;
  /** Expo push "enhanced security" token; null sends without one. */
  expoPushAccessToken: string | null;
}

const requiredEnvKeys = [
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
] as const satisfies readonly (keyof Bindings)[];

const paddleSecretKeys = [
  "PADDLE_API_KEY",
  "PADDLE_WEBHOOK_SECRET",
  "PADDLE_CLIENT_TOKEN",
  "PADDLE_PRODUCT_ID",
  "PADDLE_PRICE_ID",
  "PADDLE_OVERAGE_PRICE_ID",
] as const satisfies readonly (keyof Bindings)[];

const paddleRequiredKeys = [
  ...paddleSecretKeys,
  "PADDLE_ENVIRONMENT",
] as const satisfies readonly (keyof Bindings)[];

const stripeSecretKeys = [
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "STRIPE_PRODUCT_ID",
  "STRIPE_PRICE_ID",
  "STRIPE_OVERAGE_PRICE_ID",
] as const satisfies readonly (keyof Bindings)[];

const stripeConfiguredKeys = [
  ...stripeSecretKeys,
  "STRIPE_ALERT_CREDIT_PRODUCT_ID",
  "STRIPE_ALERT_CREDIT_PRICE_ID",
] as const satisfies readonly (keyof Bindings)[];

const stripeRequiredKeys = [
  ...stripeSecretKeys,
  "STRIPE_ENVIRONMENT",
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
  ENCRYPTION_KEY_ID: z.string().min(1),
  ENCRYPTION_PREVIOUS_KEYS: optionalNonEmptyString(),
  KEY_WRAPPING_KEY_ID: optionalNonEmptyString(),
  ARTIFACT_URL_SECRET: z.string().min(32),
  RUNNER_API_TOKEN: z.string().min(32),
  RUNNER_FALLBACK_API_TOKEN: z.string().min(32),
  RUNNER_CF_API_TOKEN: z.preprocess(
    (value) =>
      typeof value === "string" && value.trim() === "" ? undefined : value,
    z.string().min(32).optional(),
  ),
  RUNNER_CAPABILITY_SECRET: z.string().min(32),
  EMAIL_FROM: z.string().min(1),
  LLM_MODEL: z.string().min(1),
  TWILIO_ACCOUNT_SID: z.string().min(1),
  TWILIO_AUTH_TOKEN: z.string().min(1),
  TWILIO_FROM_SMS: z.string().min(1),
  TWILIO_FROM_WHATSAPP: optionalNonEmptyString(),
  TWILIO_FROM_CALL: z.string().min(1),
  EXPO_PUSH_ACCESS_TOKEN: optionalNonEmptyString(),
});

const paddleEnvSchema = z.object({
  PADDLE_API_KEY: z.string().min(1),
  PADDLE_WEBHOOK_SECRET: z.string().min(1),
  PADDLE_CLIENT_TOKEN: z.string().min(1),
  PADDLE_ENVIRONMENT: z.enum(["sandbox", "production"]),
  PADDLE_PRODUCT_ID: z.string().min(1),
  PADDLE_PRICE_ID: z.string().min(1),
  PADDLE_OVERAGE_PRICE_ID: z.string().min(1),
  PADDLE_ALERT_CREDIT_PRODUCT_ID: optionalNonEmptyString(),
  PADDLE_ALERT_CREDIT_PRICE_ID: optionalNonEmptyString(),
});

const stripeEnvSchema = z.object({
  STRIPE_SECRET_KEY: z
    .string()
    .regex(/^(?:sk|rk)_(?:test|live)_[A-Za-z0-9]+$/u),
  STRIPE_WEBHOOK_SECRET: z.string().regex(/^whsec_[A-Za-z0-9]+$/u),
  STRIPE_ENVIRONMENT: z.enum(["test", "live"]),
  STRIPE_PRODUCT_ID: z.string().regex(/^prod_[A-Za-z0-9]+$/u),
  STRIPE_PRICE_ID: z.string().regex(/^price_[A-Za-z0-9]+$/u),
  STRIPE_OVERAGE_PRICE_ID: z.string().regex(/^price_[A-Za-z0-9]+$/u),
  STRIPE_ALERT_CREDIT_PRODUCT_ID: optionalNonEmptyString(),
  STRIPE_ALERT_CREDIT_PRICE_ID: optionalNonEmptyString(),
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

const APP_STORE_HOST = "apps.apple.com";

/**
 * The App Store link published to the iOS app. Only an https URL on
 * apps.apple.com is accepted: the app opens it in response to a forced update,
 * so it must never point anywhere else.
 */
export function parseIosAppStoreUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.trim() === "") return null;
  let parsed: URL;
  try {
    parsed = new URL(value.trim());
  } catch {
    throw new Error("IOS_APP_STORE_URL must be a valid https://apps.apple.com URL");
  }
  if (parsed.protocol !== "https:" || parsed.hostname !== APP_STORE_HOST) {
    throw new Error("IOS_APP_STORE_URL must be a valid https://apps.apple.com URL");
  }
  return parsed.toString();
}

export function isComplimentaryIssuer(
  emails: readonly string[],
  email: string,
): boolean {
  return emails.includes(email.trim().toLowerCase());
}

function decodeEncryptionKey(encoded: string, name: string): Uint8Array {
  let decoded: string;
  try {
    decoded = atob(encoded);
  } catch {
    throw new Error(`${name} must be valid base64 encoding exactly 32 bytes`);
  }

  const bytes = Uint8Array.from(decoded, (character) => character.charCodeAt(0));
  if (bytes.byteLength !== 32) {
    throw new Error(`${name} must decode to exactly 32 bytes`);
  }
  return bytes;
}

function parsePreviousEncryptionKeys(value: string | undefined): EncryptionKeyVersion[] {
  if (value === undefined) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("ENCRYPTION_PREVIOUS_KEYS must be a JSON object of key ids to base64 keys");
  }
  if (parsed === null || Array.isArray(parsed) || typeof parsed !== "object") {
    throw new Error("ENCRYPTION_PREVIOUS_KEYS must be a JSON object of key ids to base64 keys");
  }
  const entries = Object.entries(parsed);
  if (entries.length > 8) {
    throw new Error("ENCRYPTION_PREVIOUS_KEYS supports at most 8 keys");
  }
  return entries.map(([id, encoded]) => {
    if (typeof encoded !== "string") {
      throw new Error("Every ENCRYPTION_PREVIOUS_KEYS value must be a base64 string");
    }
    return {
      id,
      key: decodeEncryptionKey(encoded, `Previous encryption key ${id}`),
    };
  });
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
  let keyEncryption: CloudflareKeyWrappingProvider | undefined;
  if (parsed.ENVIRONMENT !== "development") {
    const missingKeyWrappingBindings = [];
    if (parsed.KEY_WRAPPING_KEY_ID === undefined) {
      missingKeyWrappingBindings.push("KEY_WRAPPING_KEY_ID");
    }
    if (env.KEY_WRAPPING === undefined) {
      missingKeyWrappingBindings.push("KEY_WRAPPING");
    }
    if (missingKeyWrappingBindings.length > 0) {
      throw new Error(
        `Missing key-wrapping bindings: ${missingKeyWrappingBindings.join(", ")}`,
      );
    }
    keyEncryption = new CloudflareKeyWrappingProvider(
      parsed.KEY_WRAPPING_KEY_ID as string,
      env.KEY_WRAPPING as KeyWrappingServiceBinding,
    );
  }
  const encryptionKeys = createEncryptionKeyring(
    {
      id: parsed.ENCRYPTION_KEY_ID,
      key: decodeEncryptionKey(parsed.ENCRYPTION_KEY, "ENCRYPTION_KEY"),
    },
    parsePreviousEncryptionKeys(parsed.ENCRYPTION_PREVIOUS_KEYS),
    {
      // Production writers must never fall back to an isolate-local key map:
      // D1 makes the random workspace DEK durable across requests/regions.
      workspaceDataKeys: new D1WorkspaceDataKeyStore(env.DB),
      ...(keyEncryption === undefined ? {} : { keyEncryption }),
    },
  );
  if (parsed.RUNNER_API_TOKEN === parsed.RUNNER_FALLBACK_API_TOKEN) {
    throw new Error("Primary and fallback runner tokens must be independent");
  }
  if (
    parsed.RUNNER_CAPABILITY_SECRET === parsed.RUNNER_API_TOKEN ||
    parsed.RUNNER_CAPABILITY_SECRET === parsed.RUNNER_FALLBACK_API_TOKEN
  ) {
    throw new Error("Runner capability signing secret must be independent");
  }
  if (
    parsed.RUNNER_CF_API_TOKEN !== undefined &&
    (parsed.RUNNER_CF_API_TOKEN === parsed.RUNNER_API_TOKEN ||
      parsed.RUNNER_CF_API_TOKEN === parsed.RUNNER_FALLBACK_API_TOKEN ||
      parsed.RUNNER_CF_API_TOKEN === parsed.RUNNER_CAPABILITY_SECRET)
  ) {
    throw new Error("The cf runner token must be independent");
  }
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
    const alertCreditPriceId =
      parsedPaddle.PADDLE_ALERT_CREDIT_PRICE_ID ?? null;
    const alertCreditProductId =
      parsedPaddle.PADDLE_ALERT_CREDIT_PRODUCT_ID ?? null;
    if ((alertCreditPriceId === null) !== (alertCreditProductId === null)) {
      throw new Error(
        "PADDLE_ALERT_CREDIT_PRODUCT_ID and PADDLE_ALERT_CREDIT_PRICE_ID must be configured together",
      );
    }
    paddle = {
      apiKey: parsedPaddle.PADDLE_API_KEY,
      webhookSecret: parsedPaddle.PADDLE_WEBHOOK_SECRET,
      clientToken: parsedPaddle.PADDLE_CLIENT_TOKEN,
      environment: parsedPaddle.PADDLE_ENVIRONMENT,
      productId: parsedPaddle.PADDLE_PRODUCT_ID,
      priceId: parsedPaddle.PADDLE_PRICE_ID,
      overagePriceId: parsedPaddle.PADDLE_OVERAGE_PRICE_ID,
      alertCreditPriceId,
      alertCreditProductId,
      apiBase:
        parsedPaddle.PADDLE_ENVIRONMENT === "sandbox"
          ? "https://sandbox-api.paddle.com"
          : "https://api.paddle.com",
    };
  }

  const stripeEnabled = stripeConfiguredKeys.some((key) => {
    const value = env[key];
    return typeof value === "string" && value.trim().length > 0;
  });
  let stripe: StripeConfig | null = null;
  if (stripeEnabled) {
    const missingStripe = stripeRequiredKeys.filter((key) => {
      const value = env[key];
      return typeof value !== "string" || value.trim().length === 0;
    });
    if (missingStripe.length > 0) {
      throw new Error(`Missing Stripe env: ${missingStripe.join(", ")}`);
    }
    const parsedStripe = stripeEnvSchema.parse(env);
    const keyEnvironment = parsedStripe.STRIPE_SECRET_KEY.split("_")[1];
    if (keyEnvironment !== parsedStripe.STRIPE_ENVIRONMENT) {
      throw new Error("STRIPE_SECRET_KEY does not match STRIPE_ENVIRONMENT");
    }
    const alertCreditPriceId =
      parsedStripe.STRIPE_ALERT_CREDIT_PRICE_ID ?? null;
    const alertCreditProductId =
      parsedStripe.STRIPE_ALERT_CREDIT_PRODUCT_ID ?? null;
    if ((alertCreditPriceId === null) !== (alertCreditProductId === null)) {
      throw new Error(
        "STRIPE_ALERT_CREDIT_PRODUCT_ID and STRIPE_ALERT_CREDIT_PRICE_ID must be configured together",
      );
    }
    stripe = {
      secretKey: parsedStripe.STRIPE_SECRET_KEY,
      webhookSecret: parsedStripe.STRIPE_WEBHOOK_SECRET,
      environment: parsedStripe.STRIPE_ENVIRONMENT,
      productId: parsedStripe.STRIPE_PRODUCT_ID,
      priceId: parsedStripe.STRIPE_PRICE_ID,
      overagePriceId: parsedStripe.STRIPE_OVERAGE_PRICE_ID,
      alertCreditPriceId,
      alertCreditProductId,
      apiBase: "https://api.stripe.com",
    };
  }
  if (stripe !== null && paddle !== null) {
    throw new Error("Configure Stripe or Paddle, not both");
  }

  return {
    appUrl: parsed.APP_URL,
    environment: parsed.ENVIRONMENT,
    jwtSecret: parsed.JWT_SECRET,
    encryptionKeys,
    artifactUrlSecret: parsed.ARTIFACT_URL_SECRET,
    runnerApiToken: parsed.RUNNER_API_TOKEN,
    runnerFallbackApiToken: parsed.RUNNER_FALLBACK_API_TOKEN,
    runnerCfApiToken: parsed.RUNNER_CF_API_TOKEN ?? "",
    runnerCapabilitySecret: parsed.RUNNER_CAPABILITY_SECRET,
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
    stripe,
    expoPushAccessToken: parsed.EXPO_PUSH_ACCESS_TOKEN ?? null,
    complimentaryIssuerEmails: parseComplimentaryIssuerEmails(
      env.COMPLIMENTARY_ISSUER_EMAILS,
    ),
    iosAppStoreUrl: parseIosAppStoreUrl(env.IOS_APP_STORE_URL),
  };
}
