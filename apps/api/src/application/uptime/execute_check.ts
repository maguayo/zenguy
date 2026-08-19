import type { MonitorConfig } from "../../domain/uptime/rules";
import {
  extractPlaceholders,
  substitutePlaceholders,
} from "../../domain/secrets/rules";
import type { ResolvedSecrets } from "../../domain/secrets/types";
import type { MonitorMethod } from "../../domain/uptime/types";
import { getJsonPath } from "../../shared/jsonpath";
import {
  MAX_REDIRECTS,
  UPTIME_BODY_CAP,
  UPTIME_EXCERPT_MAX,
} from "../../shared/constants";
import type { Clock } from "../../shared/clock";
import { isAppError } from "../../shared/errors";
import { Redactor, sanitizeUrl } from "../../shared/redact";
import { assertSafeExternalUrl } from "../../shared/ssrf";
import type { ResolveSecrets } from "../secrets/resolve_secrets";
import { buildRedactor } from "../secrets/resolve_secrets";

export type FailureReason =
  | "TIMEOUT"
  | "CONNECTION_ERROR"
  | "UNEXPECTED_STATUS"
  | "BODY_MISMATCH"
  | "JSON_INVALID"
  | "JSON_PATH_MISSING"
  | "TOO_MANY_REDIRECTS"
  | "UNSAFE_REDIRECT"
  | "RESPONSE_TOO_LARGE"
  | "BLOCKED_URL"
  | "SECRET_DOMAIN_NOT_ALLOWED"
  | "UNKNOWN_SECRET";

export interface CheckCondition {
  type: string;
  passed: boolean;
  detail: string;
}

export interface CheckOutcome {
  status: "PASSED" | "FAILED";
  httpStatus: number | null;
  responseTimeMs: number;
  failureReason: FailureReason | null;
  responseExcerpt: string | null;
  conditions: CheckCondition[];
}

export type UptimeFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export interface ExecuteCheckDependencies {
  fetchFn: UptimeFetch;
  clock: Clock;
  resolveSecrets: Pick<ResolveSecrets, "execute">;
}

type RequestMethod = MonitorMethod | "GET";

interface CappedBody {
  text: string;
  tooLarge: boolean;
}

function elapsed(clock: Clock, startedAt: number): number {
  return Math.max(0, clock.now() - startedAt);
}

function failed(input: {
  reason: FailureReason;
  detail: string;
  clock: Clock;
  startedAt: number;
  httpStatus?: number | null;
  responseExcerpt?: string | null;
  conditions?: CheckCondition[];
}): CheckOutcome {
  return {
    status: "FAILED",
    httpStatus: input.httpStatus ?? null,
    responseTimeMs: elapsed(input.clock, input.startedAt),
    failureReason: input.reason,
    responseExcerpt: input.responseExcerpt ?? null,
    conditions: input.conditions ?? [
      { type: "request", passed: false, detail: input.detail },
    ],
  };
}

function hostOf(raw: string): string {
  try {
    return new URL(raw).hostname;
  } catch {
    return "";
  }
}

function substitutionFailure(reason: string): FailureReason {
  return reason.startsWith("Unknown secret")
    ? "UNKNOWN_SECRET"
    : "SECRET_DOMAIN_NOT_ALLOWED";
}

function substitute(
  text: string,
  secrets: ResolvedSecrets,
  monitorHost: string,
): { ok: true; value: string } | { ok: false; reason: string } {
  const result = substitutePlaceholders(text, secrets, monitorHost);
  return result.ok
    ? { ok: true, value: result.text }
    : { ok: false, reason: result.reason };
}

function isRedirect(status: number): boolean {
  return [301, 302, 303, 307, 308].includes(status);
}

function isTimeout(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === "AbortError" ||
      error.name === "TimeoutError" ||
      /timed?\s*out/iu.test(error.message))
  );
}

async function readBodyCapped(response: Response): Promise<CappedBody> {
  if (response.body === null) return { text: "", tooLarge: false };
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const result = await reader.read();
    if (result.done) break;
    const chunk = result.value;
    const remaining = UPTIME_BODY_CAP - total;
    if (chunk.byteLength > remaining) {
      if (remaining > 0) chunks.push(chunk.subarray(0, remaining));
      await reader.cancel().catch(() => undefined);
      const bytes = new Uint8Array(UPTIME_BODY_CAP);
      let offset = 0;
      for (const value of chunks) {
        bytes.set(value, offset);
        offset += value.byteLength;
      }
      return { text: new TextDecoder().decode(bytes), tooLarge: true };
    }
    chunks.push(chunk);
    total += chunk.byteLength;
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { text: new TextDecoder().decode(bytes), tooLarge: false };
}

const EMBEDDED_URL = /https?:\/\/[^\s<>"')\]]+/giu;

function responseExcerpt(text: string, redactor: Redactor): string {
  const redacted = redactor.redact(text);
  const sanitized = redacted.replace(EMBEDDED_URL, (url) => sanitizeUrl(url));
  return sanitized.slice(0, UPTIME_EXCERPT_MAX);
}

function bodyCondition(
  config: MonitorConfig,
  body: string,
  redactor: Redactor,
): { condition: CheckCondition; failureReason: FailureReason | null } {
  const expected = config.bodyExpectedValue ?? "";
  switch (config.bodyCondition) {
    case "CONTAINS": {
      const passed = body.includes(expected);
      return {
        condition: {
          type: "body_contains",
          passed,
          detail: redactor.redact(
            passed
              ? "body contains the expected value"
              : "body does not contain the expected value",
          ),
        },
        failureReason: passed ? null : "BODY_MISMATCH",
      };
    }
    case "NOT_CONTAINS": {
      const passed = !body.includes(expected);
      return {
        condition: {
          type: "body_not_contains",
          passed,
          detail: redactor.redact(
            passed
              ? "body omits the forbidden value"
              : "body contains the forbidden value",
          ),
        },
        failureReason: passed ? null : "BODY_MISMATCH",
      };
    }
    case "EQUALS": {
      const passed = body.trim() === expected;
      return {
        condition: {
          type: "body_equals",
          passed,
          detail: passed
            ? "trimmed body equals the expected value"
            : "trimmed body does not equal the expected value",
        },
        failureReason: passed ? null : "BODY_MISMATCH",
      };
    }
    case "JSON_PATH_EQUALS": {
      let parsed: unknown;
      try {
        parsed = JSON.parse(body);
      } catch {
        return {
          condition: {
            type: "json_path_equals",
            passed: false,
            detail: "response body is not valid JSON",
          },
          failureReason: "JSON_INVALID",
        };
      }
      const result = getJsonPath(parsed, config.bodyConditionPath ?? "");
      if (!result.found) {
        return {
          condition: {
            type: "json_path_equals",
            passed: false,
            detail: "configured JSON path was not found",
          },
          failureReason: "JSON_PATH_MISSING",
        };
      }
      const actual =
        result.value !== null && typeof result.value === "object"
          ? JSON.stringify(result.value)
          : String(result.value);
      const passed = actual === expected;
      return {
        condition: {
          type: "json_path_equals",
          passed,
          detail: passed
            ? "JSON path value equals the expected value"
            : "JSON path value does not equal the expected value",
        },
        failureReason: passed ? null : "BODY_MISMATCH",
      };
    }
    case undefined:
      throw new Error("Body condition is not configured");
  }
}

export async function executeCheck(
  dependencies: ExecuteCheckDependencies,
  monitorConfig: MonitorConfig,
  workspaceId: string,
): Promise<CheckOutcome> {
  const startedAt = dependencies.clock.now();
  const monitorHost = hostOf(monitorConfig.url);
  const referencedKeys = extractPlaceholders(
    [
      monitorConfig.url,
      monitorConfig.body ?? "",
      ...(monitorConfig.headers ?? []).map((header) => header.value),
    ].join("\n"),
  );
  const secrets = await dependencies.resolveSecrets.execute({
    workspaceId,
    referencedKeys,
  });
  const redactor = buildRedactor(secrets);
  const urlResult = substitute(monitorConfig.url, secrets, monitorHost);
  if (!urlResult.ok) {
    return failed({
      reason: substitutionFailure(urlResult.reason),
      detail: urlResult.reason,
      clock: dependencies.clock,
      startedAt,
    });
  }
  const headers = new Headers();
  for (const header of monitorConfig.headers ?? []) {
    const result = substitute(header.value, secrets, monitorHost);
    if (!result.ok) {
      return failed({
        reason: substitutionFailure(result.reason),
        detail: result.reason,
        clock: dependencies.clock,
        startedAt,
      });
    }
    headers.append(header.key, result.value);
  }
  const bodyResult = substitute(monitorConfig.body ?? "", secrets, monitorHost);
  if (!bodyResult.ok) {
    return failed({
      reason: substitutionFailure(bodyResult.reason),
      detail: bodyResult.reason,
      clock: dependencies.clock,
      startedAt,
    });
  }

  let currentUrl: URL;
  try {
    currentUrl = assertSafeExternalUrl(urlResult.value);
  } catch (error) {
    if (!isAppError(error)) throw error;
    return failed({
      reason: "BLOCKED_URL",
      detail: "Request URL is blocked",
      clock: dependencies.clock,
      startedAt,
    });
  }
  const originalHost = currentUrl.hostname;
  let currentHeaders = headers;
  let currentBody = monitorConfig.body === undefined ? undefined : bodyResult.value;
  let method: RequestMethod = monitorConfig.method;
  let redirectCount = 0;
  const signal = AbortSignal.timeout(monitorConfig.timeoutSeconds * 1_000);
  let response: Response;

  while (true) {
    const requestInit: RequestInit = {
      method,
      headers: currentHeaders,
      redirect: "manual",
      signal,
      ...(currentBody === undefined ? {} : { body: currentBody }),
    };
    try {
      response = await dependencies.fetchFn(currentUrl, requestInit);
    } catch (error) {
      if (isTimeout(error)) {
        return failed({
          reason: "TIMEOUT",
          detail: "Request timed out",
          clock: dependencies.clock,
          startedAt,
        });
      }
      // Workers cannot reliably distinguish DNS, TCP, and TLS failures.
      if (error instanceof TypeError) {
        return failed({
          reason: "CONNECTION_ERROR",
          detail: "Connection failed",
          clock: dependencies.clock,
          startedAt,
        });
      }
      throw error;
    }
    if (!isRedirect(response.status)) break;
    const location = response.headers.get("Location");
    if (location === null) break;
    if (redirectCount >= MAX_REDIRECTS) {
      await response.body?.cancel().catch(() => undefined);
      return failed({
        reason: "TOO_MANY_REDIRECTS",
        detail: `More than ${MAX_REDIRECTS} redirects`,
        clock: dependencies.clock,
        startedAt,
        httpStatus: response.status,
      });
    }
    let nextUrl: URL;
    try {
      nextUrl = assertSafeExternalUrl(new URL(location, currentUrl).href);
    } catch (error) {
      if (!isAppError(error) && !(error instanceof TypeError)) throw error;
      await response.body?.cancel().catch(() => undefined);
      return failed({
        reason: "UNSAFE_REDIRECT",
        detail: "Redirect target is blocked",
        clock: dependencies.clock,
        startedAt,
        httpStatus: response.status,
      });
    }
    redirectCount += 1;
    if (nextUrl.hostname !== originalHost) {
      currentHeaders = new Headers();
      currentBody = undefined;
    }
    if ([301, 302, 303].includes(response.status)) {
      method = "GET";
      currentBody = undefined;
    }
    await response.body?.cancel().catch(() => undefined);
    currentUrl = nextUrl;
  }

  const conditions: CheckCondition[] = [];
  const statusPassed = response.status === monitorConfig.expectedStatus;
  conditions.push({
    type: "status",
    passed: statusPassed,
    detail: `expected ${monitorConfig.expectedStatus}, got ${response.status}`,
  });
  let bodyText: string | null = null;
  let bodyFailure: FailureReason | null = null;
  if (monitorConfig.bodyCondition !== undefined) {
    let capped: CappedBody;
    try {
      capped = await readBodyCapped(response);
    } catch (error) {
      if (isTimeout(error)) {
        return failed({
          reason: "TIMEOUT",
          detail: "Response body timed out",
          clock: dependencies.clock,
          startedAt,
          httpStatus: response.status,
          conditions,
        });
      }
      if (error instanceof TypeError) {
        return failed({
          reason: "CONNECTION_ERROR",
          detail: "Connection failed while reading response",
          clock: dependencies.clock,
          startedAt,
          httpStatus: response.status,
          conditions,
        });
      }
      throw error;
    }
    bodyText = capped.text;
    if (capped.tooLarge) {
      conditions.push({
        type: "body_size",
        passed: false,
        detail: `response body exceeds ${UPTIME_BODY_CAP} bytes`,
      });
      return failed({
        reason: "RESPONSE_TOO_LARGE",
        detail: "Response body is too large",
        clock: dependencies.clock,
        startedAt,
        httpStatus: response.status,
        responseExcerpt: responseExcerpt(bodyText, redactor),
        conditions,
      });
    }
    const evaluated = bodyCondition(monitorConfig, bodyText, redactor);
    conditions.push(evaluated.condition);
    bodyFailure = evaluated.failureReason;
  }

  const failureReason: FailureReason | null = !statusPassed
    ? "UNEXPECTED_STATUS"
    : bodyFailure;
  if (failureReason !== null) {
    return failed({
      reason: failureReason,
      detail: conditions.find((condition) => !condition.passed)?.detail ?? "Check failed",
      clock: dependencies.clock,
      startedAt,
      httpStatus: response.status,
      responseExcerpt:
        bodyText === null ? null : responseExcerpt(bodyText, redactor),
      conditions,
    });
  }
  return {
    status: "PASSED",
    httpStatus: response.status,
    responseTimeMs: elapsed(dependencies.clock, startedAt),
    failureReason: null,
    responseExcerpt: null,
    conditions,
  };
}
