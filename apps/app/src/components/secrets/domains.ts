// Pure helpers ported from apps/frontend/src/components/DomainListInput.tsx.

const hostnamePattern =
  /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/u;

export const MAX_ALLOWED_DOMAINS = 20;

/** A hostname such as example.com, or a wildcard such as *.example.com. */
export function isAllowedDomain(value: string): boolean {
  const hostname = value.startsWith("*.") ? value.slice(2) : value;
  return hostnamePattern.test(hostname);
}

export interface AddDomainsResult {
  domains: string[];
  error: string | null;
}

/**
 * Parses comma-separated input into lowercase domains and merges it into the
 * current list without duplicates. Invalid or over-limit input leaves the
 * current list untouched and explains why.
 */
export function addDomains(
  current: string[],
  input: string,
  max = MAX_ALLOWED_DOMAINS,
): AddDomainsResult {
  const candidates = input
    .split(",")
    .map((domain) => domain.trim().toLowerCase())
    .filter(Boolean);
  if (candidates.length === 0) return { domains: current, error: null };
  const invalid = candidates.find((domain) => !isAllowedDomain(domain));
  if (invalid) {
    return {
      domains: current,
      error: `“${invalid}” must be a hostname or wildcard such as *.example.com.`,
    };
  }

  const unique = [...current];
  for (const candidate of candidates) {
    if (!unique.includes(candidate)) unique.push(candidate);
  }
  if (unique.length > max) {
    return { domains: current, error: `You can add up to ${max} allowed domains.` };
  }
  return { domains: unique, error: null };
}

export function removeDomain(current: string[], domain: string): string[] {
  return current.filter((item) => item !== domain);
}
