import type { RunnerAttemptReference } from "../domain/browser_tests/runner_protocol";
import type { RunnerWorkerMode } from "../domain/runners/types";
import type { Clock } from "../shared/clock";
import { hmacSign, hmacVerify } from "../shared/crypto";

const CAPABILITY_VERSION = 2;
const CAPABILITY_TTL_MS = 6 * 60_000;

interface CapabilityClaims extends RunnerAttemptReference {
  v: typeof CAPABILITY_VERSION;
  workerId: string;
  workerMode: RunnerWorkerMode;
  exp: number;
  jti: string;
}

function encode(value: unknown): string {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/gu, "-").replace(/\//gu, "_").replace(/=+$/gu, "");
}

function decode(value: string): unknown {
  const padded = value.replace(/-/gu, "+").replace(/_/gu, "/").padEnd(
    Math.ceil(value.length / 4) * 4,
    "=",
  );
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes));
}

function claimsMatch(
  value: unknown,
  reference: RunnerAttemptReference,
  workerId: string,
  now: number,
): value is CapabilityClaims {
  if (value === null || typeof value !== "object") return false;
  const claims = value as Partial<CapabilityClaims>;
  return (
    claims.v === CAPABILITY_VERSION &&
    claims.workerId === workerId &&
    (claims.workerMode === "local" ||
      claims.workerMode === "fallback" ||
      claims.workerMode === "cf") &&
    claims.runId === reference.runId &&
    claims.attemptId === reference.attemptId &&
    claims.attemptIndex === reference.attemptIndex &&
    claims.executionGeneration === reference.executionGeneration &&
    claims.deliveryId === reference.deliveryId &&
    typeof claims.exp === "number" &&
    Number.isSafeInteger(claims.exp) &&
    claims.exp >= now &&
    claims.exp <= now + CAPABILITY_TTL_MS &&
    typeof claims.jti === "string" &&
    /^[0-9a-f-]{36}$/u.test(claims.jti)
  );
}

export async function issueRunnerCapability(
  secret: string,
  reference: RunnerAttemptReference,
  workerId: string,
  workerMode: RunnerWorkerMode,
  clock: Clock,
): Promise<string> {
  const claims: CapabilityClaims = {
    v: CAPABILITY_VERSION,
    ...reference,
    workerId,
    workerMode,
    exp: clock.now() + CAPABILITY_TTL_MS,
    jti: crypto.randomUUID(),
  };
  const payload = encode(claims);
  return `${payload}.${await hmacSign(secret, payload)}`;
}

export async function verifyRunnerCapability(
  token: string,
  secret: string,
  reference: RunnerAttemptReference,
  workerId: string,
  clock: Clock,
): Promise<RunnerWorkerMode | null> {
  const parts = token.split(".");
  const payload = parts[0];
  const signature = parts[1];
  if (parts.length !== 2 || payload === undefined || signature === undefined) {
    return null;
  }
  if (!(await hmacVerify(secret, payload, signature))) return null;
  try {
    const claims = decode(payload);
    return claimsMatch(claims, reference, workerId, clock.now())
      ? claims.workerMode
      : null;
  } catch {
    return null;
  }
}
