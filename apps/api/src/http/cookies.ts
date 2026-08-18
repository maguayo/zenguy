import type { Context } from "hono";
import { getCookie } from "hono/cookie";

export const REFRESH_COOKIE = "zenguy_rt";

export function refreshCookieHeader(
  token: string,
  maxAgeSeconds: number,
  secure: boolean,
): string {
  return `${REFRESH_COOKIE}=${token}; Path=/api/auth; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}${secure ? "; Secure" : ""}`;
}

export function clearRefreshCookieHeader(secure: boolean): string {
  return refreshCookieHeader("", 0, secure);
}

export function readRefreshCookie(context: Context): string | null {
  return getCookie(context, REFRESH_COOKIE) ?? null;
}
