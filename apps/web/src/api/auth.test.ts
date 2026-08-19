import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { clearToken, getToken, setToken } from "../lib/auth-token";
import {
  forgotPassword,
  login,
  logout,
  me,
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
  beforeEach(() => clearToken());
  afterEach(() => {
    clearToken();
    vi.unstubAllGlobals();
  });

  it("registers and returns the user", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ user }, 201));
    vi.stubGlobal("fetch", fetchMock);

    await expect(register("María", user.email, "Password123!")).resolves.toEqual(user);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/auth/register");
  });

  it("stores access tokens after login and refresh", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ accessToken: "login-token", expiresIn: 1_800, user }))
      .mockResolvedValueOnce(jsonResponse({ accessToken: "refresh-token", expiresIn: 1_800, user }));
    vi.stubGlobal("fetch", fetchMock);

    await login(user.email, "Password123!");
    expect(getToken().accessToken).toBe("login-token");
    await refresh();
    expect(getToken().accessToken).toBe("refresh-token");
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
  });

  it("unwraps me and exposes every public auth action", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ user }))
      .mockResolvedValueOnce(jsonResponse({ verified: true }))
      .mockResolvedValueOnce(jsonResponse({ sent: true }))
      .mockResolvedValueOnce(jsonResponse({ sent: true }))
      .mockResolvedValueOnce(jsonResponse({ reset: true }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(me()).resolves.toEqual(user);
    await expect(verifyEmail("token")).resolves.toEqual({ verified: true });
    await expect(resendVerification(user.email)).resolves.toEqual({ sent: true });
    await expect(forgotPassword(user.email)).resolves.toEqual({ sent: true });
    await expect(resetPassword("token", "Password123!")).resolves.toEqual({ reset: true });
  });
});
