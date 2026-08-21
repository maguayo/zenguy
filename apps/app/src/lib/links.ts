const TOKEN_PATTERN = /^[A-Za-z0-9_-]{1,512}$/u;

/**
 * Tokens arrive through deep links (zenguy://…, universal links) and user
 * paste. Only the expected alphabet is accepted so a crafted link can never
 * smuggle anything else into an API call.
 */
export function parseLinkToken(value: unknown): string | null {
  const candidate = Array.isArray(value) ? value[0] : value;
  if (typeof candidate !== "string") return null;
  const trimmed = candidate.trim();
  return TOKEN_PATTERN.test(trimmed) ? trimmed : null;
}

export function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export function workspaceHref(workspaceId: string, sub = "overview"): string {
  return `/w/${encodeURIComponent(workspaceId)}/${sub}`;
}

/**
 * `next` parameters only ever point back into the app: absolute URLs and
 * protocol-relative paths are rejected so sign-in can't be turned into an
 * open redirect.
 */
export function safeNextPath(value: unknown): string | null {
  const candidate = firstParam(value as string | string[] | undefined);
  if (typeof candidate !== "string") return null;
  if (!candidate.startsWith("/") || candidate.startsWith("//")) return null;
  if (candidate.length > 512 || /[\s\\]/u.test(candidate)) return null;
  return candidate;
}
