import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ApiError } from "../api";
import { LoginForm, loginErrorMessage } from "./LoginPage";

describe("login form", () => {
  it("renders the credentials form with the failure message", () => {
    const html = renderToStaticMarkup(
      <LoginForm error="Invalid credentials" pending={false} onSubmit={() => {}} />,
    );
    expect(html).toContain("Invalid credentials");
    expect(html).toContain('type="email"');
    expect(html).toContain('type="password"');
    expect(html).toContain("Sign in");
  });

  it("shows progress while the request is in flight", () => {
    const html = renderToStaticMarkup(
      <LoginForm error={null} pending onSubmit={() => {}} />,
    );
    expect(html).toContain("Signing in…");
    expect(html).toContain("disabled");
  });

  it("maps API failures to operator-facing copy", () => {
    expect(loginErrorMessage(new ApiError(401, "UNAUTHORIZED", "Nope"))).toBe("Invalid credentials");
    expect(loginErrorMessage(new ApiError(429, "RATE_LIMITED", "Nope"))).toBe(
      "Too many attempts, try again later",
    );
    expect(loginErrorMessage(new ApiError(503, "SERVICE_UNAVAILABLE", "Nope"))).toBe(
      "Production API is not reachable",
    );
    expect(loginErrorMessage(new Error("Network down"))).toBe("Network down");
  });
});
