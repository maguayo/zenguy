import {
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
  SignJWT,
  type JWTVerifyGetKey,
} from "jose";
import type { Bindings } from "../../shared/config";
import { fakeBindings } from "../../test/fakes/bindings";
import { enforceProductionRunnerAccess } from "./runner_access";

const NOW_SECONDS = 1_787_472_000;
const CURRENT_DATE = new Date(NOW_SECONDS * 1_000);
const TEAM_DOMAIN = "https://zenguy-tests.cloudflareaccess.com";
const AUDIENCE = "runner-access-audience-000000000000000000000000000000";
const KEY_ID = "runner-access-signing-key";
const PRIMARY = "zenguy-production-primary";
const PRIMARY_COMMON_NAME = "zenguy-production-primary-runner";

let privateKey: CryptoKey;
let keyResolver: JWTVerifyGetKey;

async function assertion(
  overrides: {
    commonName?: unknown;
    subject?: string;
    audience?: string | string[];
    issuer?: string;
    type?: unknown;
    expiration?: number;
  } = {},
): Promise<string> {
  return new SignJWT({
    type: overrides.type ?? "app",
    common_name: overrides.commonName ?? PRIMARY_COMMON_NAME,
  })
    .setProtectedHeader({ alg: "RS256", kid: KEY_ID, typ: "JWT" })
    .setIssuer(overrides.issuer ?? TEAM_DOMAIN)
    .setAudience(overrides.audience ?? AUDIENCE)
    .setSubject(overrides.subject ?? "")
    .setIssuedAt(NOW_SECONDS)
    .setExpirationTime(overrides.expiration ?? NOW_SECONDS + 300)
    .sign(privateKey);
}

function productionEnv(overrides: Partial<Bindings> = {}): Bindings {
  return {
    ...fakeBindings(),
    ENVIRONMENT: "production",
    APP_URL: "https://app.zenguy.com",
    CF_ACCESS_TEAM_DOMAIN: TEAM_DOMAIN,
    CF_RUNNER_ACCESS_AUD: AUDIENCE,
    ...overrides,
  };
}

async function guard(
  token: string | undefined,
  workerId = PRIMARY,
  url = "https://api.zenguy.com/api/runner/attempts/claim",
  env = productionEnv(),
): Promise<Response | null> {
  const headers = new Headers({ "X-Zenguy-Worker-Id": workerId });
  if (token !== undefined) headers.set("Cf-Access-Jwt-Assertion", token);
  return enforceProductionRunnerAccess(new Request(url, { headers }), env, {
    keyResolver,
    currentDate: CURRENT_DATE,
  });
}

describe("production runner Access guard", () => {
  beforeAll(async () => {
    const pair = await generateKeyPair("RS256");
    privateKey = pair.privateKey;
    const publicJwk = await exportJWK(pair.publicKey);
    keyResolver = createLocalJWKSet({
      keys: [{ ...publicJwk, alg: "RS256", kid: KEY_ID, use: "sig" }],
    });
  });

  it("accepts only the service identity matching the primary or fallback worker", async () => {
    await expect(guard(await assertion())).resolves.toBeNull();
    await expect(
      guard(
        await assertion({ commonName: "zenguy-production-fallback-runner" }),
        "zenguy-production-fallback",
        "https://app.zenguy.com/api/runner/attempts/claim-stale",
      ),
    ).resolves.toBeNull();

    for (const [token, workerId] of [
      [await assertion({ commonName: "zenguy-production-fallback-runner" }), PRIMARY],
      [await assertion(), "zenguy-production-fallback"],
      [await assertion(), "attacker-controlled"],
    ] as const) {
      expect((await guard(token, workerId))?.status).toBe(403);
    }
  });

  it("rejects human, wrong-application and expired assertions", async () => {
    const invalid = [
      await assertion({ subject: "human-user-id" }),
      await assertion({ audience: "different-runner-application" }),
      await assertion({ audience: [AUDIENCE, "another-application"] }),
      await assertion({ issuer: "https://other.cloudflareaccess.com" }),
      await assertion({ type: "org" }),
      await assertion({ expiration: NOW_SECONDS - 1 }),
      await assertion({ commonName: "" }),
    ];
    for (const token of invalid) expect((await guard(token))?.status).toBe(403);
  });

  it("fails closed for missing assertion, worker ID or configuration", async () => {
    expect((await guard(undefined))?.status).toBe(403);
    expect((await guard(await assertion(), ""))?.status).toBe(403);
    expect(
      (
        await guard(
          await assertion(),
          PRIMARY,
          "https://api.zenguy.com/api/runner/attempts/claim",
          productionEnv({ CF_RUNNER_ACCESS_AUD: undefined }),
        )
      )?.status,
    ).toBe(403);
  });

  it("rejects alternate origins, query strings and malformed assertions", async () => {
    const token = await assertion();
    for (const url of [
      "https://attacker.example/api/runner/attempts/claim",
      "https://api.zenguy.com/api/runner/attempts/claim?mode=fallback",
    ]) {
      expect((await guard(token, PRIMARY, url))?.status).toBe(403);
    }
    for (const malformed of ["not-a-jwt", "x".repeat(16_385)]) {
      expect((await guard(malformed))?.status).toBe(403);
    }
  });

  it("does not affect development, staging or non-runner production routes", async () => {
    for (const environment of ["development", "staging"] as const) {
      const env = fakeBindings();
      env.ENVIRONMENT = environment;
      await expect(
        enforceProductionRunnerAccess(
          new Request("https://api.zenguy.com/api/runner/attempts/claim"),
          env,
          { keyResolver, currentDate: CURRENT_DATE },
        ),
      ).resolves.toBeNull();
    }
    await expect(
      enforceProductionRunnerAccess(
        new Request("https://api.zenguy.com/api/health"),
        productionEnv(),
        { keyResolver, currentDate: CURRENT_DATE },
      ),
    ).resolves.toBeNull();
  });
});
