import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { cloudflareAccessVerifier } from "./access";

const TEAM_DOMAIN = "https://zenguy-test.cloudflareaccess.com";
const AUDIENCE = "access-audience-000000000000000000";

describe("Cloudflare Access JWT verification", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("accepts only a valid RS256 application token for the configured issuer and audience", async () => {
    const { privateKey, publicKey } = await generateKeyPair("RS256");
    const jwk = await exportJWK(publicKey);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({ keys: [{ ...jwk, kid: "access-key", alg: "RS256", use: "sig" }] }),
      ),
    );
    const valid = await new SignJWT({
      email: " Admin@Example.com ",
      type: "app",
    })
      .setProtectedHeader({ alg: "RS256", kid: "access-key" })
      .setIssuer(TEAM_DOMAIN)
      .setAudience(AUDIENCE)
      .setSubject("access-user-1")
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(privateKey);
    const verifier = cloudflareAccessVerifier({ teamDomain: TEAM_DOMAIN, audience: AUDIENCE });

    await expect(
      verifier.verify(new Request("https://admin.example.com", {
        headers: { "Cf-Access-Jwt-Assertion": valid },
      })),
    ).resolves.toEqual({ email: "admin@example.com", subject: "access-user-1" });
    await expect(verifier.verify(new Request("https://admin.example.com"))).resolves.toBeNull();

    const wrongAudience = await new SignJWT({ email: "admin@example.com", type: "app" })
      .setProtectedHeader({ alg: "RS256", kid: "access-key" })
      .setIssuer(TEAM_DOMAIN)
      .setAudience("other-application")
      .setSubject("access-user-1")
      .setExpirationTime("5m")
      .sign(privateKey);
    await expect(
      verifier.verify(new Request("https://admin.example.com", {
        headers: { "Cf-Access-Jwt-Assertion": wrongAudience },
      })),
    ).resolves.toBeNull();

    const emptySubject = await new SignJWT({ email: "admin@example.com", type: "app" })
      .setProtectedHeader({ alg: "RS256", kid: "access-key" })
      .setIssuer(TEAM_DOMAIN)
      .setAudience(AUDIENCE)
      .setSubject("")
      .setExpirationTime("5m")
      .sign(privateKey);
    await expect(
      verifier.verify(new Request("https://admin.example.com", {
        headers: { "Cf-Access-Jwt-Assertion": emptySubject },
      })),
    ).resolves.toBeNull();
  });

  it("refuses unsafe team domains and missing audience configuration", () => {
    expect(() =>
      cloudflareAccessVerifier({ teamDomain: "https://attacker.example", audience: AUDIENCE }),
    ).toThrow("CF_ACCESS_TEAM_DOMAIN");
    expect(() => cloudflareAccessVerifier({ teamDomain: TEAM_DOMAIN, audience: "short" })).toThrow(
      "CF_ACCESS_AUD",
    );
  });
});
