interface Replacement {
  value: string;
  placeholder: string;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function encodedValue(value: string): string | null {
  try {
    return encodeURIComponent(value);
  } catch {
    return null;
  }
}

function formEncodedValue(value: string): string {
  return new URLSearchParams([["value", value]])
    .toString()
    .slice("value=".length);
}

export class Redactor {
  private readonly replacements: Replacement[];
  private readonly pattern: RegExp | null;
  private readonly placeholders = new Map<string, string>();

  constructor(secrets: { key: string; value: string }[]) {
    const replacements: Replacement[] = [];
    for (const secret of secrets) {
      if (secret.value.length === 0) {
        continue;
      }
      const placeholder = `{{${secret.key}}}`;
      replacements.push({ value: secret.value, placeholder });
      const encoded = encodedValue(secret.value);
      if (encoded !== null && encoded !== secret.value && encoded.length > 0) {
        replacements.push({ value: encoded, placeholder });
      }
      const formEncoded = formEncodedValue(secret.value);
      if (formEncoded !== secret.value && formEncoded.length > 0) {
        replacements.push({ value: formEncoded, placeholder });
      }
    }
    replacements.sort((left, right) => right.value.length - left.value.length);
    this.replacements = replacements.filter((replacement) => {
      if (this.placeholders.has(replacement.value)) {
        return false;
      }
      this.placeholders.set(replacement.value, replacement.placeholder);
      return true;
    });
    this.pattern =
      this.replacements.length === 0
        ? null
        : new RegExp(
            this.replacements.map(({ value }) => escapeRegExp(value)).join("|"),
            "gu",
          );
  }

  redact(text: string | null | undefined): string {
    const input = text ?? "";
    if (this.pattern === null) {
      return input;
    }
    return input.replace(this.pattern, (match) => this.placeholders.get(match) ?? "***");
  }

  redactDeep<T>(object: T): T {
    return this.redactValue(object) as T;
  }

  private redactValue(value: unknown): unknown {
    if (typeof value === "string") {
      return this.redact(value);
    }
    if (Array.isArray(value)) {
      return value.map((item) => this.redactValue(item));
    }
    if (value !== null && typeof value === "object") {
      const prototype = Object.getPrototypeOf(value);
      if (prototype !== Object.prototype && prototype !== null) {
        return value;
      }
      return Object.fromEntries(
        Object.entries(value).map(([key, item]) => [key, this.redactValue(item)]),
      );
    }
    return value;
  }
}

export function sanitizeUrl(raw: string): string {
  try {
    const url = new URL(raw);
    // Paths and apparently harmless query values routinely carry magic links,
    // signed object keys and high-entropy capabilities. Persist only the
    // origin; callers that need request diagnostics store separately bounded,
    // explicitly allowlisted fields.
    return url.origin;
  } catch {
    return "<invalid-url>";
  }
}

export function sanitizeHeaders(
  headers: Record<string, string>,
): Record<string, string> {
  const sanitized: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    const lower = name.toLowerCase();
    if (lower === "cookie" || lower === "set-cookie") {
      continue;
    }
    sanitized[name] =
      lower === "authorization" ||
      lower === "x-api-key" ||
      lower === "proxy-authorization"
        ? "***"
        : value;
  }
  return sanitized;
}

export type AuditMetadataValue =
  | string
  | number
  | boolean
  | null
  | string[];

const SENSITIVE_METADATA_NAME =
  /pass|token|secret|authorization|cookie|credential|private|config|header|body|content|(?:api|encryption|signing)[_-]?key/iu;

export function sanitizeAuditMetadata(
  metadata: Record<string, AuditMetadataValue>,
): Record<string, AuditMetadataValue> {
  return Object.fromEntries(
    Object.entries(metadata).map(([name, value]) => [
      name,
      SENSITIVE_METADATA_NAME.test(name) ? "***" : value,
    ]),
  );
}

export function truncate(value: string, max: number): string {
  if (max <= 0) {
    return "";
  }
  if (value.length <= max) {
    return value;
  }
  return max === 1 ? "…" : `${value.slice(0, max - 1)}…`;
}
