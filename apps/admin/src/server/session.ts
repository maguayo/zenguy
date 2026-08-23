import { SESSION_COOKIE } from "./constants";

const encoder = new TextEncoder();

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

export function newSessionToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return toBase64Url(bytes);
}

export async function sessionTokenHash(
  token: string,
  accessSubject: string,
): Promise<string> {
  if (accessSubject.length === 0 || accessSubject.length > 512) {
    throw new Error("Cloudflare Access subject is invalid");
  }
  // A JSON tuple avoids concatenation ambiguity and binds the opaque cookie to
  // the exact Access identity that created it, not only to a reusable email.
  const digest = await crypto.subtle.digest(
    "SHA-256",
    encoder.encode(
      JSON.stringify(["zenguy-admin-session", 1, accessSubject, token]),
    ),
  );
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function isWellFormedSessionToken(token: string): boolean {
  return /^[A-Za-z0-9_-]{43}$/u.test(token);
}

const COOKIE_ATTRIBUTES = "Path=/; HttpOnly; Secure; SameSite=Strict";

export function sessionCookie(token: string, maxAgeSeconds: number): string {
  return `${SESSION_COOKIE}=${token}; Max-Age=${maxAgeSeconds}; ${COOKIE_ATTRIBUTES}`;
}

export function clearSessionCookie(): string {
  return `${SESSION_COOKIE}=; Max-Age=0; ${COOKIE_ATTRIBUTES}`;
}

export function readCookie(header: string | undefined, name: string): string | null {
  if (header === undefined) return null;
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=") || null;
  }
  return null;
}
