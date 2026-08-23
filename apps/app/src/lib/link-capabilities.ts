import { parseLinkToken } from "./links";

export type LinkCapabilityKind = "grant" | "invitation" | "password-reset" | "verification";

const CAPABILITY_TTL_MS = 30 * 60 * 1_000;
const capabilities = new Map<
  LinkCapabilityKind,
  { expiresAt: number; token: string }
>();

/**
 * Retain a bearer only in this JS process while authentication temporarily
 * unmounts its clean continuation route. Invalid input also clears an older
 * value so a malformed link cannot accidentally reuse a previous capability.
 */
export function captureLinkCapability(
  kind: LinkCapabilityKind,
  value: unknown,
  now = Date.now(),
): string | null {
  const token = parseLinkToken(value);
  if (!token) {
    capabilities.delete(kind);
    return null;
  }
  capabilities.set(kind, { expiresAt: now + CAPABILITY_TTL_MS, token });
  return token;
}

export function linkCapability(
  kind: LinkCapabilityKind,
  now = Date.now(),
): string | null {
  const capability = capabilities.get(kind);
  if (!capability) return null;
  if (capability.expiresAt <= now) {
    capabilities.delete(kind);
    return null;
  }
  return capability.token;
}

export function forgetLinkCapability(kind: LinkCapabilityKind): void {
  capabilities.delete(kind);
}
