import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { clearToken, getToken, setToken } from "../lib/auth-token";
import { confirmTerminalLogout, isTerminalLogoutPending, supersedeSession } from "../lib/api";
import {
  activateSession,
  authReturnPath,
  forgotPassword,
  googleSignInUrl,
  login,
  logout,
  me,
  prepareGoogleSignInUrl,
  refresh,
  register,
  resendVerification,
  resetPassword,
  verifyEmail,
} from "./auth";
import type { User } from "./types";

const user: User = {
  createdAt: "2026-08-19T10:00:00.000Z",
  email: "maria@example.com",
  emailVerified: true,
  id: "usr_1",
  name: "María",
};

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify({ data }), {
    headers: { "Content-Type": "application/json" },
    status,
  });
}

describe("auth API", () => {
  beforeEach(() => {
    confirmTerminalLogout();
    supersedeSession();
    clearToken();
  });
  afterEach(() => {
    confirmTerminalLogout();
    supersedeSession();
    clearToken();
    vi.unstubAllGlobals();
  });

  it("returns token-free registration state without activating a principal", async () => {
    const pending = {
      registrationPending: true as const,
      email: user.email,
    };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(pending, 201));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      register("María", user.email, "Password123!", {
        acceptedPrivacy: true,
        acceptedTerms: true,
        marketingOptIn: false,
      }),
    ).resolves.toEqual(pending);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/auth/register");
    expect(getToken().accessToken).toBeNull();
  });

  it("does not activate email-verification sessions before principal teardown", async () => {
    const session = { accessToken: "verify-token", expiresIn: 1_800, user, verified: true };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(session));
    vi.stubGlobal("fetch", fetchMock);

    await expect(verifyEmail("token", "original password")).resolves.toEqual(session);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/auth/verify-email");
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      body: JSON.stringify({ password: "original password", token: "token" }),
    });
    expect(getToken().accessToken).toBeNull();
  });

  it("activates login sessions explicitly and stores refresh responses", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ accessToken: "login-token", expiresIn: 1_800, user }))
      .mockResolvedValueOnce(jsonResponse({ accessToken: "refresh-token", expiresIn: 1_800, user }));
    vi.stubGlobal("fetch", fetchMock);

    const session = await login(user.email, "Password123!");
    expect(getToken().accessToken).toBeNull();
    activateSession(session);
    expect(getToken().accessToken).toBe("login-token");
    await refresh();
    expect(getToken().accessToken).toBe("refresh-token");
  });

  it("builds Google sign-in URLs with only local continuation paths", async () => {
    expect(
      authReturnPath(
        "https://evil.example/path",
        "//evil.example",
        "/w/ws_1/overview?tab=runs#latest",
      ),
    ).toBe("/w/ws_1/overview?tab=runs#latest");
    expect(authReturnPath("/\\\\evil.example", "javascript:alert(1)")).toBe("/");
    expect(authReturnPath("/%2e%2e//evil.example/x")).toBe("/");
    expect(authReturnPath("/foo/.%2e//evil.example/x")).toBe("/");
    expect(authReturnPath("/search?q=foo%2Ebar")).toBe(
      "/search?q=foo%2Ebar",
    );
    expect(googleSignInUrl("/w/ws_1/overview?tab=runs")).toBe(
      "/api/auth/google/start?next=%2Fw%2Fws_1%2Foverview%3Ftab%3Druns",
    );
    await expect(prepareGoogleSignInUrl("//evil.example")).resolves.toBe(
      "/api/auth/google/start?next=%2F",
    );
  });

  it("clears the token even when logout fails", async () => {
    setToken("access", 1_800);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: { code: "INTERNAL", message: "Failed" } }), {
          status: 500,
        }),
      ),
    );

    await expect(logout()).rejects.toMatchObject({ code: "INTERNAL" });
    expect(getToken().accessToken).toBeNull();
    expect(isTerminalLogoutPending()).toBe(true);
  });

  it("never refreshes a surviving cookie after failed logout", async () => {
    setToken("access", 1_800);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { code: "INTERNAL", message: "Failed" } }), {
          status: 500,
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(logout()).rejects.toMatchObject({ code: "INTERNAL" });
    await expect(refresh()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(fetchMock.mock.calls.map(([path]) => path)).toEqual([
      "/api/auth/logout",
      "/api/auth/logout",
    ]);
    expect(isTerminalLogoutPending()).toBe(false);
    expect(getToken().accessToken).toBeNull();
  });

  it("unwraps me and exposes every public auth action", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ user }))
      .mockResolvedValueOnce(jsonResponse({ sent: true }))
      .mockResolvedValueOnce(jsonResponse({ sent: true }))
      .mockResolvedValueOnce(jsonResponse({ reset: true }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(me()).resolves.toEqual(user);
    await expect(resendVerification(user.email)).resolves.toEqual({ sent: true });
    await expect(forgotPassword(user.email)).resolves.toEqual({ sent: true });
    await expect(resetPassword("token", "Password123!")).resolves.toEqual({ reset: true });
  });
});
