import {
  SignJWT,
  createRemoteJWKSet,
  jwtVerify,
  type JWTPayload,
  type JWTVerifyGetKey,
} from "jose";

const GOOGLE_AUTHORIZATION_ENDPOINT =
  "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const GOOGLE_JWKS_ENDPOINT = "https://www.googleapis.com/oauth2/v3/certs";
const GOOGLE_ISSUERS = [
  "https://accounts.google.com",
  "accounts.google.com",
] as const;

const STATE_ISSUER = "zenguy-api";
const PUBLIC_STATE_AUDIENCE = "zenguy-google-oauth-state";
const TRANSACTION_AUDIENCE = "zenguy-google-oauth-transaction";
const PUBLIC_STATE_PURPOSE = "google_oauth_state";
const TRANSACTION_PURPOSE = "google_oauth_transaction";

const STATE_TTL_SECONDS = 10 * 60;
const CLOCK_TOLERANCE_SECONDS = 30;
const ID_TOKEN_MAX_AGE_SECONDS = 10 * 60;
const DEFAULT_TOKEN_EXCHANGE_TIMEOUT_MS = 5_000;

const MAX_NEXT_LENGTH = 2_048;
const MAX_REDIRECT_URI_LENGTH = 2_048;
const MAX_AUTHORIZATION_CODE_LENGTH = 4_096;
const MAX_RETURNED_STATE_LENGTH = 2_048;
const MAX_STATE_COOKIE_LENGTH = 4_096;
const MAX_TOKEN_RESPONSE_BYTES = 32 * 1_024;
const MAX_ID_TOKEN_LENGTH = 16_384;
const MAX_CLIENT_ID_LENGTH = 1_024;
const MAX_CLIENT_SECRET_LENGTH = 4_096;
const MAX_STATE_SECRET_LENGTH = 4_096;
const MAX_EMAIL_LENGTH = 320;
const MAX_NAME_LENGTH = 512;
const MIN_STATE_SECRET_BYTES = 32;

const BASE64URL_256_BIT_PATTERN = /^[A-Za-z0-9_-]{43}$/u;
const JWT_PATTERN = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u;
const AUTHORIZATION_CODE_PATTERN = /^[\u0021-\u007e]+$/u;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/u;
const ENCODED_PATH_SEPARATOR_OR_CONTROL_PATTERN =
  /%(?:0[0-9a-f]|1[0-9a-f]|2f|5c|7f)/iu;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+$/u;
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder("utf-8", { fatal: true });

const productionGoogleJwks = createRemoteJWKSet(
  new URL(GOOGLE_JWKS_ENDPOINT),
  {
    timeoutDuration: 5_000,
    cooldownDuration: 30_000,
    cacheMaxAge: 10 * 60 * 1_000,
  },
);

export type GoogleOAuthErrorCode =
  | "invalid_configuration"
  | "invalid_redirect_uri"
  | "invalid_state"
  | "invalid_authorization_code"
  | "token_exchange_failed"
  | "invalid_id_token";

export type GoogleOAuthDiagnostic =
  | "token_exchange_fetch_error"
  | "token_exchange_invalid_response"
  | "token_exchange_rejected"
  | "token_exchange_rejected_4xx"
  | "token_exchange_rejected_5xx"
  | "token_exchange_rejected_invalid_client"
  | "token_exchange_rejected_invalid_grant"
  | "token_exchange_rejected_invalid_request"
  | "token_exchange_rejected_server_error"
  | "token_exchange_rejected_temporarily_unavailable"
  | "token_exchange_rejected_unauthorized_client"
  | "token_exchange_rejected_unsupported_grant_type"
  | "token_exchange_timeout";

/** A stable, non-sensitive error that HTTP routes can map to a safe redirect. */
export class GoogleOAuthError extends Error {
  override readonly name = "GoogleOAuthError";

  constructor(
    readonly code: GoogleOAuthErrorCode,
    message: string,
    readonly diagnostic?: GoogleOAuthDiagnostic,
  ) {
    super(message);
  }
}

export interface GoogleIdentityClaims {
  /** Google's immutable account identifier (`sub`), not the mutable email. */
  subject: string;
  email: string;
  name: string | null;
  /** Signed Workspace domain; null for consumer/third-party Google accounts. */
  hostedDomain: string | null;
}

export interface GoogleOAuthConfig {
  clientId: string;
  clientSecret: string;
  stateSecret: string;
}

export interface GoogleOAuthProviderOptions {
  /** Test seam for the token endpoint. Production uses the Worker global fetch. */
  fetchFn?: typeof fetch;
  /** Test seam for an in-memory JWKS. Production uses Google's rotating JWKS. */
  keyResolver?: JWTVerifyGetKey;
  /** Millisecond clock, structurally compatible with the application's Clock. */
  clock?: { now(): number };
  /** Test seam for deterministic PKCE, nonce, and transaction identifiers. */
  randomBytes?: (length: number) => Uint8Array;
  tokenExchangeTimeoutMs?: number;
}

export interface GoogleAuthorizationInput {
  redirectUri: string;
  next: string;
}

export interface GoogleAuthorization {
  authorizationUrl: string;
  stateCookie: string;
}

export interface GoogleAuthorizationStateInput {
  stateCookie: string;
  returnedState: string;
}

export interface GoogleAuthorizationState {
  next: string;
}

export interface GoogleAuthorizationCompletionInput
  extends GoogleAuthorizationStateInput {
  redirectUri: string;
  code: string;
}

interface OAuthTransaction extends GoogleAuthorizationState {
  id: string;
  nonce: string;
  pkceVerifier: string;
  redirectUri: string;
}

interface TokenResponse {
  idToken: string;
}

/**
 * Returns an internal path, or `/` for anything ambiguous or cross-origin.
 * Backslashes, control bytes, protocol-relative paths, and their encoded forms
 * are deliberately rejected so this remains safe when passed to a redirect API.
 */
export function safeOAuthNext(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_NEXT_LENGTH ||
    value !== value.trim() ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.startsWith("/\\") ||
    value.includes("\\") ||
    CONTROL_CHARACTER_PATTERN.test(value) ||
    ENCODED_PATH_SEPARATOR_OR_CONTROL_PATTERN.test(value)
  ) {
    return "/";
  }

  try {
    const base = new URL("https://oauth-next.invalid/");
    const parsed = new URL(value, base);
    if (
      parsed.origin !== base.origin ||
      parsed.username !== "" ||
      parsed.password !== ""
    ) {
      return "/";
    }
    const normalized = `${parsed.pathname}${parsed.search}${parsed.hash}`;
    if (
      !normalized.startsWith("/") ||
      normalized.startsWith("//") ||
      normalized.includes("\\") ||
      CONTROL_CHARACTER_PATTERN.test(normalized) ||
      ENCODED_PATH_SEPARATOR_OR_CONTROL_PATTERN.test(normalized)
    ) {
      return "/";
    }
    return normalized;
  } catch {
    return "/";
  }
}

function configurationError(): GoogleOAuthError {
  return new GoogleOAuthError(
    "invalid_configuration",
    "Invalid Google OAuth configuration",
  );
}

function invalidState(): GoogleOAuthError {
  return new GoogleOAuthError("invalid_state", "Invalid or expired OAuth state");
}

function validateConfig(config: GoogleOAuthConfig): GoogleOAuthConfig {
  if (
    typeof config?.clientId !== "string" ||
    typeof config.clientSecret !== "string" ||
    typeof config.stateSecret !== "string"
  ) {
    throw configurationError();
  }
  const clientId = config.clientId.trim();
  const clientSecret = config.clientSecret.trim();
  const stateSecret = config.stateSecret;
  if (
    clientId.length === 0 ||
    clientId.length > MAX_CLIENT_ID_LENGTH ||
    clientId !== config.clientId ||
    CONTROL_CHARACTER_PATTERN.test(clientId) ||
    clientSecret.length === 0 ||
    clientSecret.length > MAX_CLIENT_SECRET_LENGTH ||
    clientSecret !== config.clientSecret ||
    CONTROL_CHARACTER_PATTERN.test(clientSecret) ||
    stateSecret.length > MAX_STATE_SECRET_LENGTH ||
    textEncoder.encode(stateSecret).byteLength < MIN_STATE_SECRET_BYTES ||
    CONTROL_CHARACTER_PATTERN.test(stateSecret)
  ) {
    throw configurationError();
  }
  return { clientId, clientSecret, stateSecret };
}

function validateTimeout(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > 30_000) {
    throw configurationError();
  }
  return value;
}

function validateRedirectUri(value: string): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_REDIRECT_URI_LENGTH ||
    value !== value.trim() ||
    CONTROL_CHARACTER_PATTERN.test(value) ||
    value.includes("\\")
  ) {
    throw new GoogleOAuthError(
      "invalid_redirect_uri",
      "Invalid OAuth redirect URI",
    );
  }

  try {
    const parsed = new URL(value);
    const loopback =
      parsed.hostname === "localhost" ||
      parsed.hostname === "127.0.0.1" ||
      parsed.hostname === "[::1]";
    if (
      (parsed.protocol !== "https:" &&
        !(parsed.protocol === "http:" && loopback)) ||
      parsed.username !== "" ||
      parsed.password !== "" ||
      parsed.search !== "" ||
      parsed.hash !== "" ||
      parsed.pathname === "/"
    ) {
      throw new Error("invalid redirect URI");
    }
    return parsed.toString();
  } catch {
    throw new GoogleOAuthError(
      "invalid_redirect_uri",
      "Invalid OAuth redirect URI",
    );
  }
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}

function exactArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return Uint8Array.from(bytes).buffer;
}

async function sha256Base64Url(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    exactArrayBuffer(textEncoder.encode(value)),
  );
  return bytesToBase64Url(new Uint8Array(digest));
}

async function timingSafeEqual(left: string, right: string): Promise<boolean> {
  const [leftDigest, rightDigest] = await Promise.all([
    crypto.subtle.digest("SHA-256", textEncoder.encode(left)),
    crypto.subtle.digest("SHA-256", textEncoder.encode(right)),
  ]);
  const leftBytes = new Uint8Array(leftDigest);
  const rightBytes = new Uint8Array(rightDigest);
  let difference = leftBytes.byteLength ^ rightBytes.byteLength;
  const length = Math.max(leftBytes.byteLength, rightBytes.byteLength);
  for (let index = 0; index < length; index += 1) {
    difference |=
      (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
  }
  return difference === 0;
}

function exactAudience(
  actual: string | string[] | undefined,
  expected: string,
): boolean {
  if (typeof actual === "string") return actual === expected;
  return Array.isArray(actual) && actual.length === 1 && actual[0] === expected;
}

function isSafeNumericDate(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  );
}

async function readBoundedText(
  response: Response,
  maxBytes: number,
): Promise<string> {
  const contentLength = response.headers.get("content-length");
  if (contentLength !== null) {
    const parsed = Number(contentLength);
    if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > maxBytes) {
      await response.body?.cancel().catch(() => undefined);
      throw new Error("response too large");
    }
  }

  if (response.body === null) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel("response too large");
        throw new Error("response too large");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const joined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return textDecoder.decode(joined);
}

function parseTokenResponse(value: string): TokenResponse {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("invalid token response");
  }
  if (
    !isPlainObject(parsed) ||
    typeof parsed.id_token !== "string" ||
    parsed.id_token.length === 0 ||
    parsed.id_token.length > MAX_ID_TOKEN_LENGTH
  ) {
    throw new Error("invalid token response");
  }
  return { idToken: parsed.id_token };
}

function tokenEndpointDiagnostic(
  response: Response,
  responseBody: string,
): GoogleOAuthDiagnostic {
  let providerError: unknown;
  try {
    const parsed: unknown = JSON.parse(responseBody);
    providerError = isPlainObject(parsed) ? parsed.error : undefined;
  } catch {
    providerError = undefined;
  }

  switch (providerError) {
    case "invalid_client":
      return "token_exchange_rejected_invalid_client";
    case "invalid_grant":
      return "token_exchange_rejected_invalid_grant";
    case "invalid_request":
      return "token_exchange_rejected_invalid_request";
    case "server_error":
      return "token_exchange_rejected_server_error";
    case "temporarily_unavailable":
      return "token_exchange_rejected_temporarily_unavailable";
    case "unauthorized_client":
      return "token_exchange_rejected_unauthorized_client";
    case "unsupported_grant_type":
      return "token_exchange_rejected_unsupported_grant_type";
    default:
      if (response.status >= 400 && response.status < 500) {
        return "token_exchange_rejected_4xx";
      }
      if (response.status >= 500 && response.status < 600) {
        return "token_exchange_rejected_5xx";
      }
      return "token_exchange_rejected";
  }
}

function cleanOptionalName(value: unknown): string | null {
  if (value === undefined) return null;
  if (typeof value !== "string") throw new Error("invalid name");
  const normalized = value.trim();
  if (
    normalized.length === 0 ||
    normalized.length > MAX_NAME_LENGTH ||
    CONTROL_CHARACTER_PATTERN.test(normalized)
  ) {
    throw new Error("invalid name");
  }
  return normalized;
}

function cleanOptionalHostedDomain(value: unknown): string | null {
  if (value === undefined) return null;
  if (typeof value !== "string") throw new Error("invalid hosted domain");
  const normalized = value.trim().toLowerCase();
  if (
    normalized.length === 0 ||
    normalized.length > 253 ||
    CONTROL_CHARACTER_PATTERN.test(normalized) ||
    normalized.includes("..") ||
    !/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/u.test(normalized)
  ) {
    throw new Error("invalid hosted domain");
  }
  return normalized;
}

async function validateIdentityClaims(
  payload: JWTPayload,
  clientId: string,
  nonce: string,
  nowSeconds: number,
): Promise<GoogleIdentityClaims> {
  const email =
    typeof payload.email === "string"
      ? payload.email.trim().toLowerCase()
      : "";
  if (
    typeof payload.sub !== "string" ||
    payload.sub.length === 0 ||
    payload.sub.length > 255 ||
    CONTROL_CHARACTER_PATTERN.test(payload.sub) ||
    email.length === 0 ||
    email.length > MAX_EMAIL_LENGTH ||
    !EMAIL_PATTERN.test(email) ||
    CONTROL_CHARACTER_PATTERN.test(email) ||
    payload.email_verified !== true ||
    typeof payload.nonce !== "string" ||
    !BASE64URL_256_BIT_PATTERN.test(payload.nonce) ||
    !isSafeNumericDate(payload.iat) ||
    !isSafeNumericDate(payload.exp) ||
    payload.iat > nowSeconds + CLOCK_TOLERANCE_SECONDS ||
    payload.exp <= payload.iat ||
    !exactAudience(payload.aud, clientId) ||
    (payload.azp !== undefined && payload.azp !== clientId)
  ) {
    throw new Error("invalid identity claims");
  }

  if (!(await timingSafeEqual(payload.nonce, nonce))) {
    throw new Error("invalid nonce");
  }
  return {
    subject: payload.sub,
    email,
    name: cleanOptionalName(payload.name),
    hostedDomain: cleanOptionalHostedDomain(payload.hd),
  };
}

export class GoogleOAuthProvider {
  private readonly config: GoogleOAuthConfig;
  private readonly stateKey: Uint8Array;
  private readonly fetchFn: typeof fetch;
  private readonly keyResolver: JWTVerifyGetKey;
  private readonly clock: { now(): number };
  private readonly randomBytes: (length: number) => Uint8Array;
  private readonly tokenExchangeTimeoutMs: number;

  constructor(
    config: GoogleOAuthConfig,
    options: GoogleOAuthProviderOptions = {},
  ) {
    this.config = validateConfig(config);
    this.stateKey = textEncoder.encode(this.config.stateSecret);
    // Keep the Worker global behind an arrow. Workerd can enforce the receiver
    // on global fetch, while `this.fetchFn(...)` would otherwise invoke an
    // unbound reference with the provider instance as `this`.
    this.fetchFn = options.fetchFn ?? ((input, init) => fetch(input, init));
    this.keyResolver = options.keyResolver ?? productionGoogleJwks;
    this.clock = options.clock ?? { now: () => Date.now() };
    this.randomBytes =
      options.randomBytes ??
      ((length) => crypto.getRandomValues(new Uint8Array(length)));
    this.tokenExchangeTimeoutMs = validateTimeout(
      options.tokenExchangeTimeoutMs ?? DEFAULT_TOKEN_EXCHANGE_TIMEOUT_MS,
    );
  }

  async createAuthorization(
    input: GoogleAuthorizationInput,
  ): Promise<GoogleAuthorization> {
    const redirectUri = validateRedirectUri(input.redirectUri);
    const next = safeOAuthNext(input.next);
    const issuedAt = this.nowSeconds();
    const expiresAt = issuedAt + STATE_TTL_SECONDS;
    const transactionId = this.randomToken();
    const nonce = this.randomToken();
    const pkceVerifier = this.randomToken();
    const codeChallenge = await sha256Base64Url(pkceVerifier);

    const [returnedState, stateCookie] = await Promise.all([
      new SignJWT({ purpose: PUBLIC_STATE_PURPOSE })
        .setProtectedHeader({ alg: "HS256", typ: "JWT" })
        .setIssuer(STATE_ISSUER)
        .setAudience(PUBLIC_STATE_AUDIENCE)
        .setJti(transactionId)
        .setIssuedAt(issuedAt)
        .setExpirationTime(expiresAt)
        .sign(this.stateKey),
      new SignJWT({
        purpose: TRANSACTION_PURPOSE,
        nonce,
        verifier: pkceVerifier,
        next,
        redirect_uri: redirectUri,
      })
        .setProtectedHeader({ alg: "HS256", typ: "JWT" })
        .setIssuer(STATE_ISSUER)
        .setAudience(TRANSACTION_AUDIENCE)
        .setJti(transactionId)
        .setIssuedAt(issuedAt)
        .setExpirationTime(expiresAt)
        .sign(this.stateKey),
    ]);

    if (
      returnedState.length > MAX_RETURNED_STATE_LENGTH ||
      stateCookie.length > MAX_STATE_COOKIE_LENGTH
    ) {
      throw configurationError();
    }

    const authorizationUrl = new URL(GOOGLE_AUTHORIZATION_ENDPOINT);
    authorizationUrl.searchParams.set("client_id", this.config.clientId);
    authorizationUrl.searchParams.set("redirect_uri", redirectUri);
    authorizationUrl.searchParams.set("response_type", "code");
    authorizationUrl.searchParams.set("scope", "openid email profile");
    authorizationUrl.searchParams.set("state", returnedState);
    authorizationUrl.searchParams.set("nonce", nonce);
    authorizationUrl.searchParams.set("code_challenge", codeChallenge);
    authorizationUrl.searchParams.set("code_challenge_method", "S256");

    return { authorizationUrl: authorizationUrl.toString(), stateCookie };
  }

  async readAuthorizationState(
    input: GoogleAuthorizationStateInput,
  ): Promise<GoogleAuthorizationState> {
    const transaction = await this.readTransaction(input);
    return { next: transaction.next };
  }

  async completeAuthorization(
    input: GoogleAuthorizationCompletionInput,
  ): Promise<GoogleIdentityClaims> {
    const redirectUri = validateRedirectUri(input.redirectUri);
    const transaction = await this.readTransaction(input);
    if (!(await timingSafeEqual(transaction.redirectUri, redirectUri))) {
      throw invalidState();
    }
    if (
      typeof input.code !== "string" ||
      input.code.length === 0 ||
      input.code.length > MAX_AUTHORIZATION_CODE_LENGTH ||
      input.code !== input.code.trim() ||
      !AUTHORIZATION_CODE_PATTERN.test(input.code)
    ) {
      throw new GoogleOAuthError(
        "invalid_authorization_code",
        "Invalid OAuth authorization code",
      );
    }

    const idToken = await this.exchangeCode(
      input.code,
      transaction.pkceVerifier,
      redirectUri,
    );
    return this.verifyIdToken(idToken, transaction.nonce);
  }

  private async readTransaction(
    input: GoogleAuthorizationStateInput,
  ): Promise<OAuthTransaction> {
    if (
      typeof input.returnedState !== "string" ||
      input.returnedState.length === 0 ||
      input.returnedState.length > MAX_RETURNED_STATE_LENGTH ||
      !JWT_PATTERN.test(input.returnedState) ||
      typeof input.stateCookie !== "string" ||
      input.stateCookie.length === 0 ||
      input.stateCookie.length > MAX_STATE_COOKIE_LENGTH ||
      !JWT_PATTERN.test(input.stateCookie)
    ) {
      throw invalidState();
    }

    try {
      const currentDate = this.currentDate();
      const [publicState, transaction] = await Promise.all([
        jwtVerify(input.returnedState, this.stateKey, {
          algorithms: ["HS256"],
          issuer: STATE_ISSUER,
          audience: PUBLIC_STATE_AUDIENCE,
          typ: "JWT",
          clockTolerance: CLOCK_TOLERANCE_SECONDS,
          currentDate,
          maxTokenAge: STATE_TTL_SECONDS,
          requiredClaims: ["jti", "iat", "exp", "purpose"],
        }),
        jwtVerify(input.stateCookie, this.stateKey, {
          algorithms: ["HS256"],
          issuer: STATE_ISSUER,
          audience: TRANSACTION_AUDIENCE,
          typ: "JWT",
          clockTolerance: CLOCK_TOLERANCE_SECONDS,
          currentDate,
          maxTokenAge: STATE_TTL_SECONDS,
          requiredClaims: [
            "jti",
            "iat",
            "exp",
            "purpose",
            "nonce",
            "verifier",
            "next",
            "redirect_uri",
          ],
        }),
      ]);

      const statePayload = publicState.payload;
      const transactionPayload = transaction.payload;
      const now = Math.floor(currentDate.getTime() / 1_000);
      if (
        statePayload.purpose !== PUBLIC_STATE_PURPOSE ||
        transactionPayload.purpose !== TRANSACTION_PURPOSE ||
        typeof statePayload.jti !== "string" ||
        !BASE64URL_256_BIT_PATTERN.test(statePayload.jti) ||
        typeof transactionPayload.jti !== "string" ||
        !BASE64URL_256_BIT_PATTERN.test(transactionPayload.jti) ||
        typeof transactionPayload.nonce !== "string" ||
        !BASE64URL_256_BIT_PATTERN.test(transactionPayload.nonce) ||
        typeof transactionPayload.verifier !== "string" ||
        !BASE64URL_256_BIT_PATTERN.test(transactionPayload.verifier) ||
        typeof transactionPayload.next !== "string" ||
        safeOAuthNext(transactionPayload.next) !== transactionPayload.next ||
        typeof transactionPayload.redirect_uri !== "string" ||
        validateRedirectUri(transactionPayload.redirect_uri) !==
          transactionPayload.redirect_uri ||
        !this.validLifetime(statePayload, now) ||
        !this.validLifetime(transactionPayload, now) ||
        !(await timingSafeEqual(statePayload.jti, transactionPayload.jti))
      ) {
        throw invalidState();
      }

      return {
        id: statePayload.jti,
        nonce: transactionPayload.nonce,
        pkceVerifier: transactionPayload.verifier,
        next: transactionPayload.next,
        redirectUri: transactionPayload.redirect_uri,
      };
    } catch {
      throw invalidState();
    }
  }

  private validLifetime(payload: JWTPayload, now: number): boolean {
    return (
      isSafeNumericDate(payload.iat) &&
      isSafeNumericDate(payload.exp) &&
      payload.iat <= now + CLOCK_TOLERANCE_SECONDS &&
      payload.exp > payload.iat &&
      payload.exp - payload.iat === STATE_TTL_SECONDS
    );
  }

  private async exchangeCode(
    code: string,
    pkceVerifier: string,
    redirectUri: string,
  ): Promise<string> {
    const body = new URLSearchParams({
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      code,
      code_verifier: pkceVerifier,
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
    });
    const controller = new AbortController();
    let timedOut = false;
    const timeout = setTimeout(
      () => {
        timedOut = true;
        controller.abort("Google token exchange timed out");
      },
      this.tokenExchangeTimeoutMs,
    );

    try {
      let response: Response;
      try {
        response = await this.fetchFn(GOOGLE_TOKEN_ENDPOINT, {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Cache-Control": "no-store",
            "Content-Type": "application/x-www-form-urlencoded",
            Pragma: "no-cache",
          },
          body,
          cache: "no-store",
          credentials: "omit",
          // Workerd does not implement `redirect: "error"`. Manual preserves
          // fail-closed behavior because every 3xx is rejected by !response.ok.
          redirect: "manual",
          signal: controller.signal,
        });
      } catch {
        throw new GoogleOAuthError(
          "token_exchange_failed",
          "Google token exchange failed",
          timedOut ? "token_exchange_timeout" : "token_exchange_fetch_error",
        );
      }

      let responseBody: string;
      try {
        responseBody = await readBoundedText(
          response,
          MAX_TOKEN_RESPONSE_BYTES,
        );
      } catch {
        throw new GoogleOAuthError(
          "token_exchange_failed",
          "Google token exchange failed",
          timedOut
            ? "token_exchange_timeout"
            : "token_exchange_invalid_response",
        );
      }

      if (!response.ok) {
        throw new GoogleOAuthError(
          "token_exchange_failed",
          "Google token exchange failed",
          tokenEndpointDiagnostic(response, responseBody),
        );
      }

      try {
        return parseTokenResponse(responseBody).idToken;
      } catch {
        throw new GoogleOAuthError(
          "token_exchange_failed",
          "Google token exchange failed",
          "token_exchange_invalid_response",
        );
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  private async verifyIdToken(
    idToken: string,
    expectedNonce: string,
  ): Promise<GoogleIdentityClaims> {
    if (
      idToken.length === 0 ||
      idToken.length > MAX_ID_TOKEN_LENGTH ||
      !JWT_PATTERN.test(idToken)
    ) {
      throw new GoogleOAuthError("invalid_id_token", "Invalid Google ID token");
    }

    try {
      const currentDate = this.currentDate();
      const { payload, protectedHeader } = await jwtVerify(
        idToken,
        this.keyResolver,
        {
          algorithms: ["RS256"],
          issuer: [...GOOGLE_ISSUERS],
          audience: this.config.clientId,
          typ: "JWT",
          clockTolerance: CLOCK_TOLERANCE_SECONDS,
          currentDate,
          maxTokenAge: ID_TOKEN_MAX_AGE_SECONDS,
          requiredClaims: [
            "sub",
            "email",
            "email_verified",
            "nonce",
            "iat",
            "exp",
          ],
        },
      );
      if (
        protectedHeader.alg !== "RS256" ||
        typeof protectedHeader.kid !== "string" ||
        protectedHeader.kid.length === 0 ||
        protectedHeader.kid.length > 256 ||
        CONTROL_CHARACTER_PATTERN.test(protectedHeader.kid)
      ) {
        throw new Error("invalid protected header");
      }
      return await validateIdentityClaims(
        payload,
        this.config.clientId,
        expectedNonce,
        Math.floor(currentDate.getTime() / 1_000),
      );
    } catch {
      throw new GoogleOAuthError("invalid_id_token", "Invalid Google ID token");
    }
  }

  private randomToken(): string {
    const bytes = this.randomBytes(32);
    if (!(bytes instanceof Uint8Array) || bytes.byteLength !== 32) {
      throw configurationError();
    }
    const token = bytesToBase64Url(bytes);
    if (!BASE64URL_256_BIT_PATTERN.test(token)) throw configurationError();
    return token;
  }

  private currentDate(): Date {
    const milliseconds = this.clock.now();
    if (
      !Number.isSafeInteger(milliseconds) ||
      milliseconds < 0 ||
      milliseconds > 8_640_000_000_000_000
    ) {
      throw configurationError();
    }
    return new Date(milliseconds);
  }

  private nowSeconds(): number {
    return Math.floor(this.currentDate().getTime() / 1_000);
  }
}
