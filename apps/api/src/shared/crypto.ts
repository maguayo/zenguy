import { PBKDF2_ITERATIONS } from "./constants";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function base64ToBytes(encoded: string): Uint8Array {
  const binary = atob(encoded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function bytesToBase64Url(bytes: Uint8Array): string {
  return bytesToBase64(bytes)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}

function base64UrlToBytes(encoded: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/u.test(encoded)) {
    throw new Error("Invalid base64url value");
  }
  const base64 = encoded.replaceAll("-", "+").replaceAll("_", "/");
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
  return base64ToBytes(padded);
}

function exactBuffer(bytes: Uint8Array): ArrayBuffer {
  return Uint8Array.from(bytes).buffer;
}

function bytesToHex(bytes: Uint8Array): string {
  return [...bytes]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function hexToBytes(encoded: string): Uint8Array {
  if (!/^[0-9a-f]+$/iu.test(encoded) || encoded.length % 2 !== 0) {
    throw new Error("Invalid hex value");
  }
  const bytes = new Uint8Array(encoded.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    const pair = encoded.slice(index * 2, index * 2 + 2);
    bytes[index] = Number.parseInt(pair, 16);
  }
  return bytes;
}

async function derivePasswordHash(
  password: string,
  salt: Uint8Array,
  iterations: number,
): Promise<Uint8Array> {
  const material = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: exactBuffer(salt),
      iterations,
    },
    material,
    256,
  );
  return new Uint8Array(bits);
}

export function timingSafeEqualBytes(
  left: Uint8Array,
  right: Uint8Array,
): boolean {
  if (left.byteLength !== right.byteLength) {
    return false;
  }
  let difference = 0;
  for (let index = 0; index < left.byteLength; index += 1) {
    difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }
  return difference === 0;
}

export async function timingSafeEqualText(
  left: string,
  right: string,
): Promise<boolean> {
  const [leftDigest, rightDigest] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(left)),
    crypto.subtle.digest("SHA-256", encoder.encode(right)),
  ]);
  return timingSafeEqualBytes(
    new Uint8Array(leftDigest),
    new Uint8Array(rightDigest),
  );
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await derivePasswordHash(password, salt, PBKDF2_ITERATIONS);
  return `pbkdf2$${PBKDF2_ITERATIONS}$${bytesToBase64(salt)}$${bytesToBase64(hash)}`;
}

export async function verifyPassword(
  password: string,
  stored: string,
): Promise<boolean> {
  try {
    const parts = stored.split("$");
    if (parts.length !== 4 || parts[0] !== "pbkdf2") {
      return false;
    }
    const iterations = Number(parts[1]);
    if (!Number.isSafeInteger(iterations) || iterations <= 0) {
      return false;
    }
    const saltPart = parts[2];
    const hashPart = parts[3];
    if (saltPart === undefined || hashPart === undefined) {
      return false;
    }
    const salt = base64ToBytes(saltPart);
    const expected = base64ToBytes(hashPart);
    const actual = await derivePasswordHash(password, salt, iterations);
    return timingSafeEqualBytes(actual, expected);
  } catch {
    return false;
  }
}

export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(input));
  return bytesToHex(new Uint8Array(digest));
}

export function randomToken(bytes = 32): string {
  if (!Number.isSafeInteger(bytes) || bytes <= 0) {
    throw new Error("Token byte length must be a positive integer");
  }
  return bytesToBase64Url(crypto.getRandomValues(new Uint8Array(bytes)));
}

export async function encryptSecret(
  plaintext: string,
  key: Uint8Array,
): Promise<string> {
  if (key.byteLength !== 32) {
    throw new Error("Encryption key must be 32 bytes");
  }
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    exactBuffer(key),
    { name: "AES-GCM" },
    false,
    ["encrypt"],
  );
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: exactBuffer(iv) },
    cryptoKey,
    encoder.encode(plaintext),
  );
  return `v1:${bytesToBase64(iv)}:${bytesToBase64(new Uint8Array(ciphertext))}`;
}

export async function decryptSecret(
  encoded: string,
  key: Uint8Array,
): Promise<string> {
  if (key.byteLength !== 32) {
    throw new Error("Encryption key must be 32 bytes");
  }
  const parts = encoded.split(":");
  if (parts.length !== 3 || parts[0] !== "v1") {
    throw new Error("Unsupported encrypted value format");
  }
  const ivPart = parts[1];
  const ciphertextPart = parts[2];
  if (ivPart === undefined || ciphertextPart === undefined) {
    throw new Error("Invalid encrypted value format");
  }
  const iv = base64ToBytes(ivPart);
  if (iv.byteLength !== 12) {
    throw new Error("Invalid encrypted value IV");
  }
  const ciphertext = base64ToBytes(ciphertextPart);
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    exactBuffer(key),
    { name: "AES-GCM" },
    false,
    ["decrypt"],
  );
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: exactBuffer(iv) },
    cryptoKey,
    exactBuffer(ciphertext),
  );
  return decoder.decode(plaintext);
}

export async function hmacSign(
  secret: string,
  payload: string,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(payload),
  );
  return bytesToBase64Url(new Uint8Array(signature));
}

export async function hmacVerify(
  secret: string,
  payload: string,
  signature: string,
): Promise<boolean> {
  try {
    const expected = base64UrlToBytes(await hmacSign(secret, payload));
    const actual = base64UrlToBytes(signature);
    return timingSafeEqualBytes(expected, actual);
  } catch {
    return false;
  }
}

export async function hmacSha256Hex(
  secret: string,
  payload: string,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(payload),
  );
  return bytesToHex(new Uint8Array(signature));
}

export async function hmacVerifyHex(
  secret: string,
  payload: string,
  signature: string,
): Promise<boolean> {
  try {
    const expected = hexToBytes(await hmacSha256Hex(secret, payload));
    const actual = hexToBytes(signature);
    return timingSafeEqualBytes(expected, actual);
  } catch {
    return false;
  }
}
