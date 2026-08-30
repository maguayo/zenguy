import { Hono } from "hono";
import {
  clearGoogleOAuthCookieHeader,
  clearRefreshCookieHeader,
  googleOAuthCookieHeader,
  GOOGLE_OAUTH_COOKIE,
  readGoogleOAuthCookie,
  readRefreshCookie,
  REFRESH_COOKIE,
  refreshCookieHeader,
} from "./cookies";

describe("refresh cookies", () => {
  it("formats development and production cookie headers exactly", () => {
    expect(REFRESH_COOKIE).toBe("zenguy_rt");
    expect(refreshCookieHeader("plain-token", 2_592_000, false)).toBe(
      "zenguy_rt=plain-token; Path=/api/auth; HttpOnly; SameSite=Lax; Max-Age=2592000",
    );
    expect(refreshCookieHeader("plain-token", 2_592_000, true)).toBe(
      "zenguy_rt=plain-token; Path=/api/auth; HttpOnly; SameSite=Lax; Max-Age=2592000; Secure",
    );
    expect(clearRefreshCookieHeader(false)).toBe(
      "zenguy_rt=; Path=/api/auth; HttpOnly; SameSite=Lax; Max-Age=0",
    );
    expect(clearRefreshCookieHeader(true)).toBe(
      "zenguy_rt=; Path=/api/auth; HttpOnly; SameSite=Lax; Max-Age=0; Secure",
    );
  });

  it("reads the refresh token from a Hono context", async () => {
    const app = new Hono();
    app.get("/", (context) =>
      context.json({ token: readRefreshCookie(context) }),
    );

    const present = await app.request("/", {
      headers: { Cookie: "other=x; zenguy_rt=plain-token" },
    });
    const missing = await app.request("/");

    await expect(present.json()).resolves.toEqual({ token: "plain-token" });
    await expect(missing.json()).resolves.toEqual({ token: null });
  });
});

describe("Google OAuth cookies", () => {
  it("is short-lived, scoped to the Google flow, and secure outside development", () => {
    expect(GOOGLE_OAUTH_COOKIE).toBe("zenguy_google_oauth");
    expect(googleOAuthCookieHeader("signed.value", 600, false)).toBe(
      "zenguy_google_oauth=signed.value; Path=/api/auth/google; HttpOnly; SameSite=Lax; Max-Age=600",
    );
    expect(googleOAuthCookieHeader("signed value", 600, true)).toBe(
      "zenguy_google_oauth=signed%20value; Path=/api/auth/google; HttpOnly; SameSite=Lax; Max-Age=600; Secure",
    );
    expect(clearGoogleOAuthCookieHeader(true)).toBe(
      "zenguy_google_oauth=; Path=/api/auth/google; HttpOnly; SameSite=Lax; Max-Age=0; Secure",
    );
  });

  it("reads the transient signed payload from a Hono context", async () => {
    const app = new Hono();
    app.get("/", (context) =>
      context.json({ value: readGoogleOAuthCookie(context) }),
    );

    const present = await app.request("/", {
      headers: { Cookie: "zenguy_google_oauth=signed%20value" },
    });
    const missing = await app.request("/");

    await expect(present.json()).resolves.toEqual({ value: "signed value" });
    await expect(missing.json()).resolves.toEqual({ value: null });
  });
});
