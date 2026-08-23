import { SESSION_COOKIE } from "./constants";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

function fromBase64Url(encoded: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]+$/u.test(encoded)) return null;
  const base64 = encoded.replaceAll("-", "+").replaceAll("_", "/");
  try {
    const binary = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="));
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    return null;
  }
}

async function hmac(payload: string, secret: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(payload)));
}

function timingSafeEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let index = 0; index < left.length; index += 1) {
    diff |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }
  return diff === 0;
}

export interface SessionPayload {
  email: string;
  exp: number;
}

export async function signSession(payload: SessionPayload, secret: string): Promise<string> {
  const encoded = toBase64Url(encoder.encode(JSON.stringify(payload)));
  return `${encoded}.${toBase64Url(await hmac(encoded, secret))}`;
}

export async function verifySession(
  token: string,
  secret: string,
  now: number,
): Promise<{ email: string } | null> {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [encoded, signature] = parts as [string, string];
  const provided = fromBase64Url(signature);
  if (provided === null) return null;
  if (!timingSafeEqual(provided, await hmac(encoded, secret))) return null;
  const raw = fromBase64Url(encoded);
  if (raw === null) return null;
  let payload: unknown;
  try {
    payload = JSON.parse(decoder.decode(raw));
  } catch {
    return null;
  }
  if (typeof payload !== "object" || payload === null) return null;
  const { email, exp } = payload as Partial<SessionPayload>;
  if (typeof email !== "string" || typeof exp !== "number" || exp <= now) return null;
  return { email };
}

const COOKIE_ATTRIBUTES = "Path=/; HttpOnly; Secure; SameSite=Lax";

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
