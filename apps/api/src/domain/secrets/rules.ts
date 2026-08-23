import { validation } from "../../shared/errors";
import type { ResolvedSecrets } from "./types";

export const SECRET_KEY_REGEX = /^[A-Z][A-Z0-9_]{1,63}$/;

export const ALLOWED_DOMAIN_PATTERN_REGEX =
  /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

export function validateAllowedDomains(domains: string[]): void {
  if (domains.length < 1 || domains.length > 20) {
    throw validation([
      {
        field: "allowedDomains",
        message: "Provide between 1 and 20 allowed domains",
      },
    ]);
  }
  for (const entry of domains) {
    const hostname = entry.startsWith("*.") ? entry.slice(2) : entry;
    if (!ALLOWED_DOMAIN_PATTERN_REGEX.test(hostname)) {
      throw validation([
        {
          field: "allowedDomains",
          message: "Each allowed domain must be a lowercase hostname or wildcard",
        },
      ]);
    }
  }
}

export function isDomainAllowed(host: string, allowed: string[]): boolean {
  const normalizedHost = host.toLowerCase();
  return allowed.some((entry) => {
    const normalized = entry.toLowerCase();
    if (!normalized.startsWith("*.")) {
      return normalizedHost === normalized;
    }
    const base = normalized.slice(2);
    return (
      normalizedHost === base || normalizedHost.endsWith(`.${base}`)
    );
  });
}

export function extractPlaceholders(text: string): string[] {
  const keys = new Set<string>();
  for (const match of text.matchAll(/\{\{([A-Z][A-Z0-9_]{1,63})\}\}/gu)) {
    const key = match[1];
    if (key !== undefined) keys.add(key);
  }
  return [...keys];
}

export type SubstitutionResult =
  | { ok: true; text: string }
  | { ok: false; reason: string };

export function substitutePlaceholders(
  text: string,
  secrets: ResolvedSecrets,
  currentHost: string,
): SubstitutionResult {
  for (const key of extractPlaceholders(text)) {
    const secret = secrets.get(key);
    if (secret === undefined) {
      return { ok: false, reason: `Unknown secret {{${key}}}` };
    }
    if (!isDomainAllowed(currentHost, secret.allowedDomains)) {
      return {
        ok: false,
        reason: `Secret {{${key}}} is not allowed on domain ${currentHost}`,
      };
    }
  }
  return {
    ok: true,
    text: text.replace(
      /\{\{([A-Z][A-Z0-9_]{1,63})\}\}/gu,
      (_placeholder, key: string) => secrets.get(key)?.value ?? "",
    ),
  };
}
