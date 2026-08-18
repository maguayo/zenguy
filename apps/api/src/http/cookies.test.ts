import { Hono } from "hono";
import {
  clearRefreshCookieHeader,
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
