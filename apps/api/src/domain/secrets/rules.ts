import { validation } from "../../shared/errors";

export const SECRET_KEY_REGEX = /^[A-Z][A-Z0-9_]{1,63}$/;

const HOSTNAME_REGEX =
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
    if (!HOSTNAME_REGEX.test(hostname)) {
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
