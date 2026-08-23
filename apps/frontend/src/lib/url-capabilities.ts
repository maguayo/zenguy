const CAPABILITY_MEMORY_TTL_MS = 30 * 60 * 1_000;
const CAPABILITY_PATTERN = /^[A-Za-z0-9_-]{1,512}$/u;
const pathCapabilities = new Map<string, { expiresAt: number; token: string }>();

export function parseUrlCapability(value: unknown): string {
  if (typeof value !== "string") return "";
  const candidate = value.trim();
  return CAPABILITY_PATTERN.test(candidate) ? candidate : "";
}

export function parseUrlCapabilityFragment(fragment: string): string {
  const encoded = fragment.startsWith("#") ? fragment.slice(1) : fragment;
  const value = encoded.startsWith("token=") ? encoded.slice(6) : encoded;
  try {
    return parseUrlCapability(decodeURIComponent(value));
  } catch {
    return "";
  }
}

/** Build a same-origin replacement that omits a bearer query parameter. */
export function withoutQueryParameter(href: string, parameter: string): string {
  const url = new URL(href);
  url.searchParams.delete(parameter);
  const query = url.searchParams.toString();
  return `${url.pathname}${query ? `?${query}` : ""}${url.hash}`;
}

/** Build a same-origin replacement without either form of URL capability. */
export function withoutUrlCapability(href: string, parameter: string): string {
  const url = new URL(href);
  url.searchParams.delete(parameter);
  const query = url.searchParams.toString();
  return `${url.pathname}${query ? `?${query}` : ""}`;
}

/** Replace the current history entry without notifying the router or adding a new entry. */
export function redactCurrentQueryParameter(parameter: string): void {
  if (typeof window === "undefined") return;
  const current = new URL(window.location.href);
  if (!current.searchParams.has(parameter)) return;
  window.history.replaceState(
    window.history.state,
    "",
    withoutQueryParameter(current.href, parameter),
  );
}

/** Remove both the current fragment bearer and its legacy query equivalent. */
export function redactCurrentUrlCapability(parameter: string): void {
  if (typeof window === "undefined") return;
  const current = new URL(window.location.href);
  if (!current.searchParams.has(parameter) && current.hash === "") return;
  window.history.replaceState(
    window.history.state,
    "",
    withoutUrlCapability(current.href, parameter),
  );
}

export function redactCurrentPath(replacementPath: string): void {
  if (typeof window === "undefined") return;
  window.history.replaceState(window.history.state, "", replacementPath);
}

/** Keep a path bearer in this JS realm only while auth temporarily unmounts its page. */
export function rememberPathCapability(path: string, token: string, now = Date.now()): void {
  const capability = parseUrlCapability(token);
  if (!capability) {
    pathCapabilities.delete(path);
    return;
  }
  pathCapabilities.set(path, { expiresAt: now + CAPABILITY_MEMORY_TTL_MS, token: capability });
}

export function pathCapability(path: string, now = Date.now()): string {
  const capability = pathCapabilities.get(path);
  if (!capability) return "";
  if (capability.expiresAt <= now) {
    pathCapabilities.delete(path);
    return "";
  }
  return capability.token;
}

export function forgetPathCapability(path: string): void {
  pathCapabilities.delete(path);
}
