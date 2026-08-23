import {
  createRemoteJWKSet,
  jwtVerify,
  type JWTVerifyGetKey,
} from "jose";
import type { Bindings } from "../../shared/config";

const ACCESS_ASSERTION_HEADER = "Cf-Access-Jwt-Assertion";
const ACCESS_TOKEN_TYPE = "app";
const CLOCK_TOLERANCE_SECONDS = 30;
const MAX_ASSERTION_LENGTH = 16_384;
const MAX_AUDIENCE_LENGTH = 256;
const AUDIENCE_PATTERN = /^[A-Za-z0-9_-]+$/u;
const RUNNER_PATH_PREFIX = "/api/runner/";
const RUNNER_ORIGINS = new Set([
  "https://api.zenguy.com",
  "https://app.zenguy.com",
]);
const RUNNER_IDENTITIES = {
  "zenguy-production-primary": "zenguy-production-primary-runner",
  "zenguy-production-fallback": "zenguy-production-fallback-runner",
} as const;

interface RunnerAccessConfig {
  issuer: string;
  audience: string;
}

export interface RunnerAccessVerificationOptions {
  /** Test seam for an in-memory JWKS. Production uses the Access JWKS. */
  keyResolver?: JWTVerifyGetKey;
  /** Test seam for deterministic lifetime checks. */
  currentDate?: Date;
}

let cachedRemoteJwks:
  | { issuer: string; resolver: JWTVerifyGetKey }
  | undefined;

function runnerAccessConfig(env: Bindings): RunnerAccessConfig {
  const rawTeamDomain = env.CF_ACCESS_TEAM_DOMAIN;
  const rawAudience = env.CF_RUNNER_ACCESS_AUD;
  if (
    typeof rawTeamDomain !== "string" ||
    typeof rawAudience !== "string"
  ) {
    throw new Error("Missing runner Access configuration");
  }

  const teamDomain = rawTeamDomain.trim();
  const audience = rawAudience.trim();
  let parsed: URL;
  try {
    parsed = new URL(teamDomain);
  } catch {
    throw new Error("Invalid runner Access configuration");
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
    ) ||
    audience.length < 16 ||
    audience.length > MAX_AUDIENCE_LENGTH ||
    !AUDIENCE_PATTERN.test(audience)
  ) {
    throw new Error("Invalid runner Access configuration");
  }
  return { issuer: parsed.origin, audience };
}

function remoteJwks(issuer: string): JWTVerifyGetKey {
  if (cachedRemoteJwks?.issuer === issuer) return cachedRemoteJwks.resolver;
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
  return Array.isArray(actual) && actual.length === 1 && actual[0] === expected;
}

function denied(): Response {
  return Response.json(
    { error: { code: "FORBIDDEN", message: "Access denied" } },
    {
      status: 403,
      headers: {
        "Cache-Control": "no-store",
        Pragma: "no-cache",
        "Referrer-Policy": "no-referrer",
        "X-Content-Type-Options": "nosniff",
      },
    },
  );
}

async function validRunnerAssertion(
  assertion: string,
  expectedCommonName: string,
  config: RunnerAccessConfig,
  options: RunnerAccessVerificationOptions,
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
        requiredClaims: ["sub", "iat", "exp", "type", "common_name"],
      },
    );
    const now = Math.floor(currentDate.getTime() / 1_000);
    return (
      typeof protectedHeader.kid === "string" &&
      protectedHeader.kid.trim().length > 0 &&
      payload.type === ACCESS_TOKEN_TYPE &&
      payload.sub === "" &&
      payload.common_name === expectedCommonName &&
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

/**
 * Defense in depth behind the service-only Access policy: production runner
 * calls must carry a verified service assertion whose identity matches the
 * worker ID used by the bootstrap token and per-job capability layers.
 */
export async function enforceProductionRunnerAccess(
  request: Request,
  env: Bindings,
  options: RunnerAccessVerificationOptions = {},
): Promise<Response | null> {
  const url = new URL(request.url);
  const isRunnerPath =
    url.pathname === "/api/runner" ||
    url.pathname.startsWith(RUNNER_PATH_PREFIX);
  if (env.ENVIRONMENT !== "production" || !isRunnerPath) return null;
  if (!RUNNER_ORIGINS.has(url.origin) || url.search !== "") return denied();

  const workerId = request.headers.get("X-Zenguy-Worker-Id");
  const expectedCommonName =
    workerId === null
      ? undefined
      : RUNNER_IDENTITIES[workerId as keyof typeof RUNNER_IDENTITIES];
  const assertion = request.headers.get(ACCESS_ASSERTION_HEADER);
  if (
    expectedCommonName === undefined ||
    assertion === null ||
    assertion.length === 0 ||
    assertion.length > MAX_ASSERTION_LENGTH ||
    assertion !== assertion.trim()
  ) {
    return denied();
  }

  let config: RunnerAccessConfig;
  try {
    config = runnerAccessConfig(env);
  } catch {
    return denied();
  }
  return (await validRunnerAssertion(
    assertion,
    expectedCommonName,
    config,
    options,
  ))
    ? null
    : denied();
}
