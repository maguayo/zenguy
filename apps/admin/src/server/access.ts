import { createRemoteJWKSet, jwtVerify } from "jose";

export interface AccessIdentity {
  email: string;
  subject: string;
}

export interface AccessVerifier {
  verify(request: Request): Promise<AccessIdentity | null>;
}

function validTeamDomain(raw: string): URL {
  const url = new URL(raw);
  if (
    url.protocol !== "https:" ||
    url.username !== "" ||
    url.password !== "" ||
    url.port !== "" ||
    url.pathname !== "/" ||
    url.search !== "" ||
    url.hash !== "" ||
    !url.hostname.endsWith(".cloudflareaccess.com")
  ) {
    throw new Error("CF_ACCESS_TEAM_DOMAIN must be an HTTPS cloudflareaccess.com origin");
  }
  return url;
}

/** Verifies Access signatures, issuer, audience and lifetime via rotating JWKS. */
export function cloudflareAccessVerifier(input: {
  teamDomain: string;
  audience: string;
}): AccessVerifier {
  const teamDomain = validTeamDomain(input.teamDomain).origin;
  if (input.audience.trim().length < 16) {
    throw new Error("CF_ACCESS_AUD must contain the Access application audience tag");
  }
  const jwks = createRemoteJWKSet(new URL(`${teamDomain}/cdn-cgi/access/certs`));

  return {
    async verify(request) {
      const token = request.headers.get("Cf-Access-Jwt-Assertion");
      if (token === null) return null;
      try {
        const { payload } = await jwtVerify(token, jwks, {
          algorithms: ["RS256"],
          issuer: teamDomain,
          audience: input.audience,
        });
        if (
          payload.type !== "app" ||
          typeof payload.email !== "string" ||
          payload.email.trim().length === 0 ||
          typeof payload.sub !== "string" ||
          payload.sub.length === 0 ||
          payload.sub.length > 512
        ) {
          return null;
        }
        return { email: payload.email.trim().toLowerCase(), subject: payload.sub };
      } catch {
        return null;
      }
    },
  };
}
