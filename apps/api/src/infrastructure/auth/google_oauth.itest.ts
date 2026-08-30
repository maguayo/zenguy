import { decodeJwt } from "jose";
import { GoogleOAuthProvider } from "./google_oauth";

const CONFIG = {
  clientId: "google-client-id.apps.googleusercontent.com",
  clientSecret: "test-google-client-secret",
  stateSecret: "test-google-state-secret".padEnd(32, "-"),
};
const REDIRECT_URI = "https://app.zenguy.com/api/auth/google/callback";

describe("Google OAuth RequestInit on the Workers runtime", () => {
  it("uses a workerd-supported manual redirect and rejects a 3xx without following it", async () => {
    const seen: Request[] = [];
    const oauth = new GoogleOAuthProvider(CONFIG, {
      fetchFn: async (input, init) => {
        // Workerd validates RequestInit here exactly as it would before an
        // outbound fetch. In particular, it rejects redirect: "error".
        seen.push(new Request(input, init));
        return new Response(null, {
          status: 302,
          headers: { location: "https://evil.example/steal" },
        });
      },
    });
    const authorization = await oauth.createAuthorization({
      redirectUri: REDIRECT_URI,
      next: "/",
    });
    const returnedState = new URL(authorization.authorizationUrl).searchParams.get(
      "state",
    );
    if (returnedState === null) throw new Error("Missing OAuth state");

    await expect(
      oauth.completeAuthorization({
        code: "valid-authorization-code",
        redirectUri: REDIRECT_URI,
        returnedState,
        stateCookie: authorization.stateCookie,
      }),
    ).rejects.toMatchObject({
      name: "GoogleOAuthError",
      code: "token_exchange_failed",
      diagnostic: "token_exchange_rejected",
    });

    expect(seen).toHaveLength(1);
    const request = seen[0]!;
    expect(request.redirect).toBe("manual");
    expect(request.url).toBe("https://oauth2.googleapis.com/token");
    expect(request.method).toBe("POST");
    const body = new URLSearchParams(
      new TextDecoder().decode(await request.arrayBuffer()),
    );
    expect(body.get("client_id")).toBe(CONFIG.clientId);
    expect(body.get("client_secret")).toBe(CONFIG.clientSecret);
    expect(body.get("code_verifier")).toBe(
      decodeJwt(authorization.stateCookie).verifier,
    );
    expect(body.get("redirect_uri")).toBe(REDIRECT_URI);
  });
});
