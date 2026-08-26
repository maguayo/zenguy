import {
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
  SignJWT,
  type JWTVerifyGetKey,
} from "jose";
import type { Bindings } from "../../shared/config";
import { fakeBindings } from "../../test/fakes/bindings";
import { enforceStagingAccess } from "./staging_access";

const NOW_SECONDS = 1_787_472_000;
const CURRENT_DATE = new Date(NOW_SECONDS * 1_000);
const TEAM_DOMAIN = "https://zenguy-tests.cloudflareaccess.com";
const AUDIENCE = "access-audience-0000000000000000000000000000000000000000";
const KEY_ID = "access-signing-key";

let privateKey: CryptoKey;
let publicKey: CryptoKey;
let keyResolver: JWTVerifyGetKey;

interface TokenOptions {
  payload?: Record<string, unknown>;
  issuer?: string | null;
  audience?: string | string[] | null;
  subject?: string | null;
  issuedAt?: number | null;
  expiration?: number | null;
  notBefore?: number | null;
  protectedType?: string | null;
  protectedKeyId?: string | null;
  signingKey?: CryptoKey;
}

async function accessToken(options: TokenOptions = {}): Promise<string> {
  const token = new SignJWT({
    type: "app",
    ...options.payload,
  }).setProtectedHeader({
    alg: "RS256",
    ...(options.protectedKeyId === null
      ? {}
      : { kid: options.protectedKeyId ?? KEY_ID }),
    ...(options.protectedType === null
      ? {}
      : { typ: options.protectedType ?? "JWT" }),
  });
  const issuer = options.issuer === undefined ? TEAM_DOMAIN : options.issuer;
  const audience =
    options.audience === undefined ? [AUDIENCE] : options.audience;
  const subject =
    options.subject === undefined ? "access-user-1" : options.subject;
  const issuedAt = options.issuedAt === undefined ? NOW_SECONDS : options.issuedAt;
  const expiration =
    options.expiration === undefined ? NOW_SECONDS + 300 : options.expiration;
  if (issuer !== null) token.setIssuer(issuer);
  if (audience !== null) token.setAudience(audience);
  if (subject !== null) token.setSubject(subject);
  if (issuedAt !== null) token.setIssuedAt(issuedAt);
  if (expiration !== null) token.setExpirationTime(expiration);
  if (options.notBefore !== undefined && options.notBefore !== null) {
    token.setNotBefore(options.notBefore);
  }
  return token.sign(options.signingKey ?? privateKey);
}

function stagingEnv(overrides: Partial<Bindings> = {}): Bindings {
  return {
    ...fakeBindings(),
    ENVIRONMENT: "staging",
    APP_URL: "https://staging-app.zenguy.com",
    CF_ACCESS_TEAM_DOMAIN: TEAM_DOMAIN,
    CF_ACCESS_AUD: AUDIENCE,
    ...overrides,
  };
}

async function guard(
  assertion?: string,
  env = stagingEnv(),
): Promise<Response | null> {
  const headers = new Headers();
  if (assertion !== undefined) {
    headers.set("Cf-Access-Jwt-Assertion", assertion);
  }
  return enforceStagingAccess(
    new Request("https://api-staging.zenguy.com/api/health", { headers }),
    env,
    { keyResolver, currentDate: CURRENT_DATE },
  );
}

describe("staging Cloudflare Access guard", () => {
  beforeAll(async () => {
    const pair = await generateKeyPair("RS256");
    privateKey = pair.privateKey;
    publicKey = pair.publicKey;
    const publicJwk = await exportJWK(pair.publicKey);
    keyResolver = createLocalJWKSet({
      keys: [{ ...publicJwk, alg: "RS256", kid: KEY_ID, use: "sig" }],
    });
  });

  afterEach(() => vi.unstubAllGlobals());

  it("accepts a valid, current RS256 Access application assertion", async () => {
    await expect(guard(await accessToken())).resolves.toBeNull();
  });

  it("accepts the documented service-token identity shape", async () => {
    const assertion = await accessToken({
      subject: "",
      payload: { common_name: "runner-service-token.access" },
    });

    await expect(guard(assertion)).resolves.toBeNull();
  });

  it("loads rotating keys only from the configured Access issuer", async () => {
    const publicJwk = await exportJWK(publicKey);
    const fetchMock = vi.fn(
      async (_input: Parameters<typeof fetch>[0]) =>
        Response.json({
          keys: [{ ...publicJwk, alg: "RS256", kid: KEY_ID, use: "sig" }],
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const assertion = await accessToken();
    const response = await enforceStagingAccess(
      new Request("https://api-staging.zenguy.com/api/health", {
        headers: { "Cf-Access-Jwt-Assertion": assertion },
      }),
      stagingEnv(),
      { currentDate: CURRENT_DATE },
    );

    expect(response).toBeNull();
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      `${TEAM_DOMAIN}/cdn-cgi/access/certs`,
    );
  });

  it("fails closed when the rotating JWKS cannot be loaded", async () => {
    const unavailableIssuer = "https://jwks-unavailable.cloudflareaccess.com";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network unavailable");
      }),
    );
    const assertion = await accessToken({ issuer: unavailableIssuer });
    const response = await enforceStagingAccess(
      new Request("https://api-staging.zenguy.com/api/health", {
        headers: { "Cf-Access-Jwt-Assertion": assertion },
      }),
      stagingEnv({ CF_ACCESS_TEAM_DOMAIN: unavailableIssuer }),
      { currentDate: CURRENT_DATE },
    );

    expect(response?.status).toBe(403);
  });

  it("denies missing assertions and never falls back to the Access cookie", async () => {
    const missing = await guard();
    const cookieOnly = await enforceStagingAccess(
      new Request("https://api-staging.zenguy.com/api/health", {
        headers: { Cookie: `CF_Authorization=${await accessToken()}` },
      }),
      stagingEnv(),
      { keyResolver, currentDate: CURRENT_DATE },
    );

    for (const response of [missing, cookieOnly]) {
      expect(response?.status).toBe(403);
      expect(response?.headers.get("Cache-Control")).toBe("no-store");
      expect(response?.headers.get("X-Content-Type-Options")).toBe("nosniff");
      await expect(response?.json()).resolves.toEqual({
        error: { code: "FORBIDDEN", message: "Access denied" },
      });
    }
  });

  it("exempts only Stripe's exact signed POST callback for route-level HMAC verification", async () => {
    const signature = "t=1787472000,v1=invalid-but-present";
    await expect(
      enforceStagingAccess(
        new Request("https://staging-app.zenguy.com/api/webhooks/stripe", {
          method: "POST",
          headers: { "Stripe-Signature": signature },
        }),
        stagingEnv(),
        { keyResolver, currentDate: CURRENT_DATE },
      ),
    ).resolves.toBeNull();

    const guarded = [
      new Request("https://staging-app.zenguy.com/api/webhooks/stripe"),
      new Request("https://staging-app.zenguy.com/api/webhooks/stripe", {
        method: "POST",
      }),
      new Request("https://staging-app.zenguy.com/api/webhooks/stripe/", {
        method: "POST",
        headers: { "Stripe-Signature": signature },
      }),
      new Request("https://staging-app.zenguy.com/api/webhooks/stripe?retry=1", {
        method: "POST",
        headers: { "Stripe-Signature": signature },
      }),
      new Request("https://api-staging.zenguy.com/api/webhooks/stripe", {
        method: "POST",
        headers: { "Stripe-Signature": signature },
      }),
    ];
    for (const request of guarded) {
      expect(
        (await enforceStagingAccess(request, stagingEnv(), {
          keyResolver,
          currentDate: CURRENT_DATE,
        }))?.status,
      ).toBe(403);
    }
  });

  it("rejects issuer, audience, signature, algorithm and both token types strictly", async () => {
    const otherPair = await generateKeyPair("RS256");
    const symmetricKey = crypto.getRandomValues(new Uint8Array(32));
    const hs256 = await new SignJWT({ type: "app" })
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .setIssuer(TEAM_DOMAIN)
      .setAudience(AUDIENCE)
      .setSubject("access-user-1")
      .setIssuedAt(NOW_SECONDS)
      .setExpirationTime(NOW_SECONDS + 300)
      .sign(symmetricKey);
    const invalid = [
      await accessToken({ issuer: "https://other.cloudflareaccess.com" }),
      await accessToken({ audience: "different-access-audience" }),
      await accessToken({ audience: [AUDIENCE, "another-application"] }),
      await accessToken({ signingKey: otherPair.privateKey }),
      hs256,
      await accessToken({ protectedKeyId: null }),
      await accessToken({ protectedType: null }),
      await accessToken({ protectedType: "at+jwt" }),
      await accessToken({ payload: { type: "org" } }),
      await accessToken({ payload: { type: undefined } }),
    ];

    for (const assertion of invalid) {
      expect((await guard(assertion))?.status).toBe(403);
    }
  });

  it("requires a coherent subject, issued-at and expiration lifetime", async () => {
    const invalid = [
      await accessToken({ subject: null }),
      await accessToken({ subject: "   " }),
      await accessToken({ issuedAt: null }),
      await accessToken({ expiration: null }),
      await accessToken({ expiration: NOW_SECONDS - 60 }),
      await accessToken({ notBefore: NOW_SECONDS + 31 }),
      await accessToken({
        issuedAt: NOW_SECONDS + 31,
        expiration: NOW_SECONDS + 300,
      }),
      await accessToken({
        issuedAt: NOW_SECONDS + 120,
        expiration: NOW_SECONDS + 60,
      }),
    ];

    for (const assertion of invalid) {
      expect((await guard(assertion))?.status).toBe(403);
    }
  });

  it("denies service assertions without an unambiguous client identity", async () => {
    const invalid = [
      await accessToken({ subject: "" }),
      await accessToken({ subject: "", payload: { common_name: "" } }),
      await accessToken({ subject: "", payload: { common_name: "   " } }),
      await accessToken({ subject: "", payload: { common_name: 42 } }),
      await accessToken({
        subject: "   ",
        payload: { common_name: "runner-service-token.access" },
      }),
      await accessToken({
        subject: null,
        payload: { common_name: "runner-service-token.access" },
      }),
    ];

    for (const assertion of invalid) {
      expect((await guard(assertion))?.status).toBe(403);
    }
  });

  it("fails closed for missing or unsafe issuer/audience configuration", async () => {
    const assertion = await accessToken();
    const invalidDomains = [
      undefined,
      "http://zenguy-tests.cloudflareaccess.com",
      "https://user@zenguy-tests.cloudflareaccess.com",
      "https://zenguy-tests.cloudflareaccess.com:444",
      "https://zenguy-tests.cloudflareaccess.com/keys",
      "https://zenguy-tests.cloudflareaccess.com?redirect=1",
      "https://cloudflareaccess.com",
      "https://zenguy-tests.cloudflareaccess.com.attacker.example",
      "https://attacker.example",
    ];
    for (const domain of invalidDomains) {
      const response = await guard(
        assertion,
        stagingEnv({ CF_ACCESS_TEAM_DOMAIN: domain }),
      );
      expect(response?.status).toBe(403);
    }

    for (const audience of [
      undefined,
      "short",
      "bad audience",
      "x".repeat(257),
    ]) {
      const response = await guard(
        assertion,
        stagingEnv({ CF_ACCESS_AUD: audience }),
      );
      expect(response?.status).toBe(403);
    }
  });

  it("rejects malformed and oversized assertions without exposing the reason", async () => {
    for (const assertion of [
      "not-a-jwt",
      `${await accessToken()}x`,
      "x".repeat(16_385),
    ]) {
      const response = await guard(assertion);
      expect(response?.status).toBe(403);
      await expect(response?.json()).resolves.toEqual({
        error: { code: "FORBIDDEN", message: "Access denied" },
      });
    }
  });

  it("leaves development and production unchanged without touching Access JWKS", async () => {
    const resolver = vi.fn(async () => {
      throw new Error("must not be called");
    }) as JWTVerifyGetKey;
    for (const environment of ["development", "production"] as const) {
      const env = fakeBindings();
      env.ENVIRONMENT = environment;
      delete env.CF_ACCESS_TEAM_DOMAIN;
      delete env.CF_ACCESS_AUD;
      await expect(
        enforceStagingAccess(
          new Request("https://api.zenguy.com/api/health"),
          env,
          { keyResolver: resolver, currentDate: CURRENT_DATE },
        ),
      ).resolves.toBeNull();
    }
    expect(resolver).not.toHaveBeenCalled();
  });
});
