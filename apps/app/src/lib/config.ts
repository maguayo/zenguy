const DEV_DEFAULT_ORIGIN = "http://127.0.0.1:8787";
const PRODUCTION_DEFAULT_ORIGIN = "https://api.zenguy.com";

/**
 * Resolves the API origin for this build.
 *
 * Release builds must talk to an https origin: a misconfigured build must fail
 * loudly at startup rather than silently send credentials in cleartext.
 */
export function resolveApiOrigin(raw: string | undefined, isDev: boolean): string {
  const trimmed = (raw ?? "").trim().replace(/\/+$/u, "");
  const origin = trimmed || (isDev ? DEV_DEFAULT_ORIGIN : PRODUCTION_DEFAULT_ORIGIN);
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    throw new Error(`EXPO_PUBLIC_API_ORIGIN is not a valid URL: ${origin}`);
  }
  if (parsed.pathname !== "/" || parsed.search || parsed.hash) {
    throw new Error("EXPO_PUBLIC_API_ORIGIN must be an origin without a path");
  }
  const localhost =
    parsed.hostname === "localhost" ||
    parsed.hostname === "127.0.0.1" ||
    parsed.hostname.startsWith("192.168.") ||
    parsed.hostname.startsWith("10.");
  if (parsed.protocol !== "https:" && !(isDev && localhost)) {
    throw new Error("EXPO_PUBLIC_API_ORIGIN must use https outside local development");
  }
  return parsed.origin;
}

export const API_ORIGIN = resolveApiOrigin(process.env.EXPO_PUBLIC_API_ORIGIN, __DEV__);
