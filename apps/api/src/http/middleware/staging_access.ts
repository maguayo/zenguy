import {
  createRemoteJWKSet,
  jwtVerify,
  type JWTVerifyGetKey,
} from "jose";
import type { Bindings } from "../../shared/config";

const ACCESS_ASSERTION_HEADER = "Cf-Access-Jwt-Assertion";
const ACCESS_TOKEN_TYPE = "app";
const STAGING_PADDLE_WEBHOOK_ORIGIN = "https://staging-app.zenguy.com";
const PADDLE_WEBHOOK_PATH = "/api/webhooks/paddle";
const CLOCK_TOLERANCE_SECONDS = 30;
const MAX_ASSERTION_LENGTH = 16_384;
const MAX_AUDIENCE_LENGTH = 256;
const AUDIENCE_PATTERN = /^[A-Za-z0-9_-]+$/u;

interface StagingAccessConfig {
  issuer: string;
  audience: string;
}

export interface StagingAccessVerificationOptions {
  /** Test seam for an in-memory JWKS. Production always uses the remote Access JWKS. */
  keyResolver?: JWTVerifyGetKey;
  /** Test seam for deterministic lifetime checks. */
  currentDate?: Date;
}

let cachedRemoteJwks:
  | { issuer: string; resolver: JWTVerifyGetKey }
  | undefined;

function stagingAccessConfig(env: Bindings): StagingAccessConfig {
  const rawTeamDomain = env.CF_ACCESS_TEAM_DOMAIN;
  const rawAudience = env.CF_ACCESS_AUD;
  if (
    typeof rawTeamDomain !== "string" ||
    typeof rawAudience !== "string"
  ) {
    throw new Error("Missing staging Access configuration");
  }

  const teamDomain = rawTeamDomain.trim();
  const audience = rawAudience.trim();
  let parsed: URL;
  try {
    parsed = new URL(teamDomain);
  } catch {
    throw new Error("Invalid staging Access configuration");
  }

  if (
    parsed.protocol !== "https:" ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.port !== "" ||
    parsed.pathname !== "/" ||
    parsed.search !== "" ||
    parsed.hash !== "" ||
    !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.cloudflareaccess\.com$/u.test(
      parsed.hostname,
    )
  ) {
    throw new Error("Invalid staging Access configuration");
  }
  if (
    audience.length < 16 ||
    audience.length > MAX_AUDIENCE_LENGTH ||
    !AUDIENCE_PATTERN.test(audience)
  ) {
    throw new Error("Invalid staging Access configuration");
  }

  return { issuer: parsed.origin, audience };
}

function remoteJwks(issuer: string): JWTVerifyGetKey {
  if (cachedRemoteJwks?.issuer === issuer) {
    return cachedRemoteJwks.resolver;
  }
  const resolver = createRemoteJWKSet(
    new URL(`${issuer}/cdn-cgi/access/certs`),
    {
      timeoutDuration: 5_000,
      cooldownDuration: 30_000,
      cacheMaxAge: 600_000,
    },
  );
  cachedRemoteJwks = { issuer, resolver };
  return resolver;
}

function exactAudience(
  actual: string | string[] | undefined,
  expected: string,
): boolean {
  if (typeof actual === "string") return actual === expected;
  return (
    Array.isArray(actual) && actual.length === 1 && actual[0] === expected
  );
}

/**
 * Validates the assertion exactly as an Access application token. This checks
 * the rotating RS256 signature plus issuer, audience, JOSE type, payload type,
 * human/service identity, issuance time, expiration and (when present)
 * not-before time.
 */
async function verifyStagingAccessAssertion(
  assertion: string,
  config: StagingAccessConfig,
  options: StagingAccessVerificationOptions = {},
): Promise<boolean> {
  try {
    const currentDate = options.currentDate ?? new Date();
    const { payload, protectedHeader } = await jwtVerify(
      assertion,
      options.keyResolver ?? remoteJwks(config.issuer),
      {
        algorithms: ["RS256"],
        issuer: config.issuer,
        audience: config.audience,
        typ: "JWT",
        clockTolerance: CLOCK_TOLERANCE_SECONDS,
        currentDate,
        requiredClaims: ["sub", "iat", "exp", "type"],
      },
    );

    const now = Math.floor(currentDate.getTime() / 1_000);
    const hasHumanIdentity =
      typeof payload.sub === "string" && payload.sub.trim().length > 0;
    const hasServiceIdentity =
      payload.sub === "" &&
      typeof payload.common_name === "string" &&
      payload.common_name.trim().length > 0;
    return (
      typeof protectedHeader.kid === "string" &&
      protectedHeader.kid.trim().length > 0 &&
      payload.type === ACCESS_TOKEN_TYPE &&
      (hasHumanIdentity || hasServiceIdentity) &&
      typeof payload.iat === "number" &&
      typeof payload.exp === "number" &&
      Number.isSafeInteger(payload.iat) &&
      Number.isSafeInteger(payload.exp) &&
      payload.iat <= now + CLOCK_TOLERANCE_SECONDS &&
      payload.exp > payload.iat &&
      exactAudience(payload.aud, config.audience)
    );
  } catch {
    return false;
  }
}

function accessDenied(): Response {
  return Response.json(
    { error: { code: "FORBIDDEN", message: "Access denied" } },
    {
      status: 403,
      headers: {
        "Cache-Control": "no-store",
        Pragma: "no-cache",
        "Referrer-Policy": "no-referrer",
        "X-Content-Type-Options": "nosniff",
        "X-Frame-Options": "DENY",
      },
    },
  );
}

function isPaddleWebhookCallback(request: Request): boolean {
  const url = new URL(request.url);
  const signature = request.headers.get("Paddle-Signature");
  return (
    request.method === "POST" &&
    url.origin === STAGING_PADDLE_WEBHOOK_ORIGIN &&
    url.pathname === PADDLE_WEBHOOK_PATH &&
    url.search === "" &&
    typeof signature === "string" &&
    signature.trim().length > 0
  );
}

/**
 * Returns a denial response for unauthenticated staging requests, or null when
 * the request may proceed. Development and production never use staging
 * credentials and retain their existing behavior.
 */
export async function enforceStagingAccess(
  request: Request,
  env: Bindings,
  options: StagingAccessVerificationOptions = {},
): Promise<Response | null> {
  if (env.ENVIRONMENT !== "staging") return null;

  // Paddle cannot present an Access token. Only its exact documented callback
  // may reach the route-level body cap and timestamped HMAC verification.
  if (isPaddleWebhookCallback(request)) return null;

  let config: StagingAccessConfig;
  try {
    config = stagingAccessConfig(env);
  } catch {
    return accessDenied();
  }

  const assertion = request.headers.get(ACCESS_ASSERTION_HEADER);
  if (
    assertion === null ||
    assertion.length === 0 ||
    assertion.length > MAX_ASSERTION_LENGTH ||
    assertion !== assertion.trim()
  ) {
    return accessDenied();
  }

  return (await verifyStagingAccessAssertion(assertion, config, options))
    ? null
    : accessDenied();
}
