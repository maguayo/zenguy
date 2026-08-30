import {
  SignJWT,
  createLocalJWKSet,
  decodeJwt,
  decodeProtectedHeader,
  exportJWK,
  generateKeyPair,
  type JWTPayload,
  type JWTVerifyGetKey,
} from "jose";
import {
  GoogleOAuthError,
  GoogleOAuthProvider,
  safeOAuthNext,
} from "./google_oauth";

const NOW = Date.UTC(2026, 7, 29, 12, 0, 0);
const NOW_SECONDS = Math.floor(NOW / 1_000);
const REDIRECT_URI = "https://api.zenguy.com/api/auth/google/callback";
const CLIENT_ID = "google-client-id.apps.googleusercontent.com";
const CLIENT_SECRET = "test-google-client-secret";
const STATE_SECRET = "test-google-state-secret".padEnd(32, "-");
const KEY_ID = "google-test-key";
const CONFIG = {
  clientId: CLIENT_ID,
  clientSecret: CLIENT_SECRET,
  stateSecret: STATE_SECRET,
};

class TestClock {
  constructor(private milliseconds = NOW) {}

  now(): number {
    return this.milliseconds;
  }

  advance(milliseconds: number): void {
    this.milliseconds += milliseconds;
  }
}

let googlePrivateKey: CryptoKey;
let googleKeyResolver: JWTVerifyGetKey;

beforeAll(async () => {
  const keys = await generateKeyPair("RS256", { extractable: true });
  googlePrivateKey = keys.privateKey;
  const publicJwk = await exportJWK(keys.publicKey);
  publicJwk.alg = "RS256";
  publicJwk.kid = KEY_ID;
  publicJwk.use = "sig";
  googleKeyResolver = createLocalJWKSet({ keys: [publicJwk] });
});

function noTokenExchange(): typeof fetch {
  return vi.fn<typeof fetch>(async () => {
    throw new Error("unexpected token exchange");
  });
}

function provider(input: {
  clock?: TestClock;
  fetchFn?: typeof fetch;
  timeoutMs?: number;
  stateSecret?: string;
} = {}): GoogleOAuthProvider {
  return new GoogleOAuthProvider(
    { ...CONFIG, stateSecret: input.stateSecret ?? STATE_SECRET },
    {
      clock: input.clock ?? new TestClock(),
      fetchFn: input.fetchFn ?? noTokenExchange(),
      keyResolver: googleKeyResolver,
      tokenExchangeTimeoutMs: input.timeoutMs,
    },
  );
}

async function startAuthorization(
  oauth: GoogleOAuthProvider,
  next = "/w/ws_1/overview?tab=runs#latest",
) {
  const created = await oauth.createAuthorization({
    redirectUri: REDIRECT_URI,
    next,
  });
  const authorizationUrl = new URL(created.authorizationUrl);
  const returnedState = authorizationUrl.searchParams.get("state");
  const nonce = authorizationUrl.searchParams.get("nonce");
  if (returnedState === null || nonce === null) {
    throw new Error("authorization URL is missing required test values");
  }
  return { ...created, authorizationUrl, returnedState, nonce };
}

async function signGoogleIdToken(
  nonce: string,
  overrides: JWTPayload = {},
): Promise<string> {
  return new SignJWT({
    iss: "https://accounts.google.com",
    aud: CLIENT_ID,
    sub: "google-subject-123",
    email: " Alice@Example.COM ",
    email_verified: true,
    name: " Alice Example ",
    nonce,
    iat: NOW_SECONDS,
    exp: NOW_SECONDS + 5 * 60,
    ...overrides,
  })
    .setProtectedHeader({ alg: "RS256", kid: KEY_ID, typ: "JWT" })
    .sign(googlePrivateKey);
}

function tamperJwt(token: string): string {
  const parts = token.split(".");
  const signature = parts[2];
  if (parts.length !== 3 || signature === undefined || signature.length === 0) {
    throw new Error("invalid test JWT");
  }
  parts[2] = `${signature[0] === "A" ? "B" : "A"}${signature.slice(1)}`;
  return parts.join(".");
}

async function sha256Base64Url(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  let binary = "";
  for (const byte of new Uint8Array(digest)) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}

function expectOAuthError(
  promise: Promise<unknown>,
  code: GoogleOAuthError["code"],
): Promise<void> {
  return expect(promise).rejects.toMatchObject({
    name: "GoogleOAuthError",
    code,
  }) as Promise<void>;
}

describe("safeOAuthNext", () => {
  it.each([
    ["/", "/"],
    ["/w/ws_1/overview?tab=runs#latest", "/w/ws_1/overview?tab=runs#latest"],
    ["/settings/billing", "/settings/billing"],
    ["/search?q=foo%2Ebar", "/search?q=foo%2Ebar"],
    [undefined, "/"],
    [null, "/"],
    ["", "/"],
    ["https://evil.example/", "/"],
    ["//evil.example/", "/"],
    ["/\\evil.example/", "/"],
    ["/%2fevil.example/", "/"],
    ["/%5cevil.example/", "/"],
    ["/%2e%2e//evil.example/x", "/"],
    ["/.%2e//evil.example/x", "/"],
    ["/foo/%2e%2e//evil.example/x", "/"],
    ["/ok%0d%0aLocation:%20https://evil.example", "/"],
    [" /settings", "/"],
    ["/settings ", "/"],
  ])("maps %s to a safe local target", (input, expected) => {
    expect(safeOAuthNext(input)).toBe(expected);
  });
});

describe("GoogleOAuthProvider authorization", () => {
  it("creates a signed, expiring state and an S256 PKCE request", async () => {
    const oauth = provider();
    const authorization = await startAuthorization(oauth);
    const url = authorization.authorizationUrl;

    expect(url.origin + url.pathname).toBe(
      "https://accounts.google.com/o/oauth2/v2/auth",
    );
    expect(url.searchParams.get("client_id")).toBe(CLIENT_ID);
    expect(url.searchParams.get("redirect_uri")).toBe(REDIRECT_URI);
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("scope")).toBe("openid email profile");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(authorization.nonce).toMatch(/^[A-Za-z0-9_-]{43}$/u);

    const publicState = decodeJwt(authorization.returnedState);
    const transaction = decodeJwt(authorization.stateCookie);
    expect(decodeProtectedHeader(authorization.returnedState)).toEqual({
      alg: "HS256",
      typ: "JWT",
    });
    expect(publicState).toMatchObject({
      aud: "zenguy-google-oauth-state",
      exp: NOW_SECONDS + 600,
      iat: NOW_SECONDS,
      iss: "zenguy-api",
      purpose: "google_oauth_state",
    });
    expect(publicState).not.toHaveProperty("nonce");
    expect(publicState).not.toHaveProperty("verifier");
    expect(publicState).not.toHaveProperty("next");
    expect(transaction).toMatchObject({
      aud: "zenguy-google-oauth-transaction",
      exp: NOW_SECONDS + 600,
      iat: NOW_SECONDS,
      iss: "zenguy-api",
      next: "/w/ws_1/overview?tab=runs#latest",
      nonce: authorization.nonce,
      purpose: "google_oauth_transaction",
      redirect_uri: REDIRECT_URI,
      verifier: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/u),
    });
    expect(transaction.jti).toBe(publicState.jti);
    expect(url.searchParams.get("code_challenge")).toBe(
      await sha256Base64Url(transaction.verifier as string),
    );
    expect(authorization.stateCookie.length).toBeLessThanOrEqual(4_096);

    await expect(
      oauth.readAuthorizationState({
        returnedState: authorization.returnedState,
        stateCookie: authorization.stateCookie,
      }),
    ).resolves.toEqual({ next: "/w/ws_1/overview?tab=runs#latest" });
  });

  it("uses a safe fallback for an untrusted next value", async () => {
    const authorization = await startAuthorization(
      provider(),
      "https://evil.example/phish",
    );

    await expect(
      provider().readAuthorizationState({
        returnedState: authorization.returnedState,
        stateCookie: authorization.stateCookie,
      }),
    ).resolves.toEqual({ next: "/" });
  });

  it.each([
    "http://api.zenguy.com/api/auth/google/callback",
    "https://user@api.zenguy.com/api/auth/google/callback",
    "https://api.zenguy.com/api/auth/google/callback?next=/admin",
    "https://api.zenguy.com/api/auth/google/callback#fragment",
  ])("rejects an unsafe redirect URI: %s", async (redirectUri) => {
    await expectOAuthError(
      provider().createAuthorization({ redirectUri, next: "/" }),
      "invalid_redirect_uri",
    );
  });

  it("rejects weak state secrets at construction", () => {
    expect(() => provider({ stateSecret: "too-short" })).toThrowError(
      expect.objectContaining({
        name: "GoogleOAuthError",
        code: "invalid_configuration",
      }),
    );
  });
});

describe("GoogleOAuthProvider callback", () => {
  it("exchanges the code without redirects or caching and verifies the ID token", async () => {
    let idToken = "";
    const fetchFn = vi.fn<typeof fetch>(async () =>
      new Response(JSON.stringify({ id_token: idToken }), {
        headers: { "Content-Type": "application/json" },
        status: 200,
      }),
    );
    const oauth = provider({ fetchFn });
    const authorization = await startAuthorization(oauth);
    idToken = await signGoogleIdToken(authorization.nonce, {
      azp: CLIENT_ID,
      hd: "zenguy.com",
    });

    await expect(
      oauth.completeAuthorization({
        code: "4/0A-test-authorization-code",
        redirectUri: REDIRECT_URI,
        returnedState: authorization.returnedState,
        stateCookie: authorization.stateCookie,
      }),
    ).resolves.toEqual({
      subject: "google-subject-123",
      email: "alice@example.com",
      name: "Alice Example",
      hostedDomain: "zenguy.com",
    });

    expect(fetchFn).toHaveBeenCalledOnce();
    const [resource, init] = fetchFn.mock.calls[0] ?? [];
    expect(resource).toBe("https://oauth2.googleapis.com/token");
    expect(init).toMatchObject({
      cache: "no-store",
      credentials: "omit",
      method: "POST",
      redirect: "error",
    });
    const headers = new Headers(init?.headers);
    expect(headers.get("accept")).toBe("application/json");
    expect(headers.get("cache-control")).toBe("no-store");
    expect(headers.get("content-type")).toBe(
      "application/x-www-form-urlencoded",
    );
    const body = init?.body;
    expect(body).toBeInstanceOf(URLSearchParams);
    const params = new URLSearchParams(body as URLSearchParams);
    expect(params.get("client_id")).toBe(CLIENT_ID);
    expect(params.get("client_secret")).toBe(CLIENT_SECRET);
    expect(params.get("code")).toBe("4/0A-test-authorization-code");
    expect(params.get("code_verifier")).toBe(
      decodeJwt(authorization.stateCookie).verifier,
    );
    expect(params.get("grant_type")).toBe("authorization_code");
    expect(params.get("redirect_uri")).toBe(REDIRECT_URI);
    expect(init?.signal?.aborted).toBe(false);
  });

  it("rejects tampered, mismatched, and expired state before fetching", async () => {
    const fetchFn = vi.fn<typeof fetch>(async () =>
      new Response(JSON.stringify({ id_token: "unused" })),
    );
    const clock = new TestClock();
    const oauth = provider({ clock, fetchFn });
    const first = await startAuthorization(oauth, "/first");
    const second = await startAuthorization(oauth, "/second");

    await expectOAuthError(
      oauth.readAuthorizationState({
        returnedState: tamperJwt(first.returnedState),
        stateCookie: first.stateCookie,
      }),
      "invalid_state",
    );
    await expectOAuthError(
      oauth.completeAuthorization({
        code: "valid-code",
        redirectUri: REDIRECT_URI,
        returnedState: second.returnedState,
        stateCookie: first.stateCookie,
      }),
      "invalid_state",
    );

    clock.advance(631_000);
    await expectOAuthError(
      oauth.readAuthorizationState({
        returnedState: first.returnedState,
        stateCookie: first.stateCookie,
      }),
      "invalid_state",
    );
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("binds the transaction to the redirect URI and validates state before code", async () => {
    const fetchFn = vi.fn<typeof fetch>();
    const oauth = provider({ fetchFn });
    const authorization = await startAuthorization(oauth);

    await expectOAuthError(
      oauth.completeAuthorization({
        code: "valid-code",
        redirectUri: "https://api.zenguy.com/another/callback",
        returnedState: authorization.returnedState,
        stateCookie: authorization.stateCookie,
      }),
      "invalid_state",
    );
    await expectOAuthError(
      oauth.completeAuthorization({
        code: "",
        redirectUri: REDIRECT_URI,
        returnedState: tamperJwt(authorization.returnedState),
        stateCookie: authorization.stateCookie,
      }),
      "invalid_state",
    );
    await expectOAuthError(
      oauth.completeAuthorization({
        code: "bad code with spaces",
        redirectUri: REDIRECT_URI,
        returnedState: authorization.returnedState,
        stateCookie: authorization.stateCookie,
      }),
      "invalid_authorization_code",
    );
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it.each([
    ["wrong issuer", { iss: "https://evil.example" }],
    ["wrong audience", { aud: "another-client" }],
    ["multiple audiences", { aud: [CLIENT_ID, "another-client"], azp: CLIENT_ID }],
    ["wrong authorized party", { azp: "another-client" }],
    ["wrong nonce", { nonce: "A".repeat(43) }],
    ["unverified email", { email_verified: false }],
    ["string email verification", { email_verified: "true" }],
    ["malformed hosted domain", { hd: "bad/domain" }],
    ["non-string hosted domain", { hd: 42 }],
    ["missing subject", { sub: undefined }],
    ["old issuance time", { iat: NOW_SECONDS - 631 }],
    ["future issuance time", { iat: NOW_SECONDS + 31 }],
    ["expired token", { exp: NOW_SECONDS - 31 }],
  ] satisfies ReadonlyArray<readonly [string, JWTPayload]>) (
    "rejects an ID token with %s",
    async (_caseName, overrides) => {
      let idToken = "";
      const fetchFn = vi.fn<typeof fetch>(async () =>
        new Response(JSON.stringify({ id_token: idToken }), { status: 200 }),
      );
      const oauth = provider({ fetchFn });
      const authorization = await startAuthorization(oauth);
      idToken = await signGoogleIdToken(authorization.nonce, overrides);

      await expectOAuthError(
        oauth.completeAuthorization({
          code: "valid-code",
          redirectUri: REDIRECT_URI,
          returnedState: authorization.returnedState,
          stateCookie: authorization.stateCookie,
        }),
        "invalid_id_token",
      );
    },
  );

  it.each([
    ["a provider error", new Response('{"error":"invalid_grant"}', { status: 400 })],
    ["malformed JSON", new Response("not json", { status: 200 })],
    ["a missing ID token", new Response("{}", { status: 200 })],
    ["an oversized body", new Response("x".repeat(32 * 1_024 + 1), { status: 200 })],
  ])("bounds and rejects %s from the token endpoint", async (_name, response) => {
    const fetchFn = vi.fn<typeof fetch>(async () => response);
    const oauth = provider({ fetchFn });
    const authorization = await startAuthorization(oauth);

    await expectOAuthError(
      oauth.completeAuthorization({
        code: "valid-code",
        redirectUri: REDIRECT_URI,
        returnedState: authorization.returnedState,
        stateCookie: authorization.stateCookie,
      }),
      "token_exchange_failed",
    );
  });

  it("enforces the token exchange timeout", async () => {
    const fetchFn = vi.fn<typeof fetch>(
      (_resource, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => reject(new DOMException("Aborted", "AbortError")),
            { once: true },
          );
        }),
    );
    const oauth = provider({ fetchFn, timeoutMs: 1 });
    const authorization = await startAuthorization(oauth);

    await expectOAuthError(
      oauth.completeAuthorization({
        code: "valid-code",
        redirectUri: REDIRECT_URI,
        returnedState: authorization.returnedState,
        stateCookie: authorization.stateCookie,
      }),
      "token_exchange_failed",
    );
    expect(fetchFn).toHaveBeenCalledOnce();
  });

  it("classifies a structurally invalid provider token as an invalid ID token", async () => {
    const fetchFn = vi.fn<typeof fetch>(async () =>
      new Response(JSON.stringify({ id_token: "not-a-jwt" }), { status: 200 }),
    );
    const oauth = provider({ fetchFn });
    const authorization = await startAuthorization(oauth);

    await expectOAuthError(
      oauth.completeAuthorization({
        code: "valid-code",
        redirectUri: REDIRECT_URI,
        returnedState: authorization.returnedState,
        stateCookie: authorization.stateCookie,
      }),
      "invalid_id_token",
    );
  });
});
