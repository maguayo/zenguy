import { z } from "zod";
import {
  DEVICE_PROFILES,
  RUNNER_VERSION,
} from "../../shared/constants";
import { assertSafeExternalUrl } from "../../shared/ssrf";
import { ALLOWED_DOMAIN_PATTERN_REGEX } from "../secrets/rules";
import type { RunSnapshot } from "./types";

export const MAX_BROWSER_TEST_ALLOWED_DOMAINS = 20;
export const MAX_IRREVERSIBLE_ACTION_SCOPES = 20;

const allowedDomainSchema = z
  .string()
  .max(253)
  .refine((entry) => {
    const hostname = entry.startsWith("*.") ? entry.slice(2) : entry;
    return ALLOWED_DOMAIN_PATTERN_REGEX.test(hostname);
  }, "Must be a lowercase hostname or wildcard");

const writableDomainSchema = z
  .string()
  .max(253)
  .refine(
    (entry) => !entry.startsWith("*.") && ALLOWED_DOMAIN_PATTERN_REGEX.test(entry),
    "Must be an exact lowercase hostname",
  );

const exactActionPathSchema = z
  .string()
  .min(1)
  .max(2_048)
  .refine(
    (value) =>
      value.startsWith("/") &&
      !value.includes("#") &&
      !value.includes("\\") &&
      !/[\u0000-\u001f\u007f*]/u.test(value),
    "Must be an exact path (and optional query) beginning with /",
  );

const exactHttpsOriginSchema = z.string().max(300).refine((value) => {
  try {
    const parsed = new URL(value);
    return (
      parsed.protocol === "https:" &&
      parsed.username === "" &&
      parsed.password === "" &&
      parsed.pathname === "/" &&
      parsed.search === "" &&
      parsed.hash === "" &&
      parsed.hostname === parsed.hostname.toLowerCase() &&
      ALLOWED_DOMAIN_PATTERN_REGEX.test(parsed.hostname) &&
      parsed.origin === value
    );
  } catch {
    return false;
  }
}, "Must be a canonical exact HTTPS origin, including any non-default port");

const irreversibleDomTargetSchema = z
  .object({
    attribute: z.enum(["data-testid", "id", "name", "aria-label"]),
    value: z
      .string()
      .min(1)
      .max(120)
      .refine(
        (value) => !/[\u0000-\u001f\u007f|*]/u.test(value),
        "Target value contains an unsupported character",
      ),
    tag: z.enum(["BUTTON", "INPUT"]),
    type: z.literal("submit"),
    form: z
      .object({
        method: z.literal("POST"),
        origin: exactHttpsOriginSchema,
        path: exactActionPathSchema,
      })
      .strict(),
  })
  .strict();

export const irreversibleActionScopeSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("DOM"),
      action: z.literal("CLICK"),
      origin: exactHttpsOriginSchema,
      path: exactActionPathSchema,
      target: irreversibleDomTargetSchema,
      maxUses: z.number().int().min(1).max(3),
    })
    .strict(),
  z
    .object({
      kind: z.literal("HTTP"),
      method: z.enum(["POST", "PUT", "PATCH", "DELETE"]),
      origin: exactHttpsOriginSchema,
      path: exactActionPathSchema,
      maxUses: z.number().int().min(1).max(3),
    })
    .strict(),
]);

export const irreversibleActionRequestSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("DOM"),
      action: z.literal("CLICK"),
      origin: exactHttpsOriginSchema,
      path: exactActionPathSchema,
      target: irreversibleDomTargetSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("HTTP"),
      method: z.enum(["POST", "PUT", "PATCH", "DELETE"]),
      origin: exactHttpsOriginSchema,
      path: exactActionPathSchema,
    })
    .strict(),
]);

function safeExternalUrl(value: string): boolean {
  try {
    assertSafeExternalUrl(value);
    return true;
  } catch {
    return false;
  }
}

export const browserTestConfigBaseSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    allowedDomains: z
      .array(allowedDomainSchema)
      .max(MAX_BROWSER_TEST_ALLOWED_DOMAINS)
      .default([])
      .transform((domains) => [...new Set(domains)]),
    writableDomains: z
      .array(writableDomainSchema)
      .max(MAX_BROWSER_TEST_ALLOWED_DOMAINS)
      .default([])
      .transform((domains) => [...new Set(domains)]),
    testDataAttested: z.boolean().default(false),
    irreversibleActionScopes: z
      .array(irreversibleActionScopeSchema)
      .max(MAX_IRREVERSIBLE_ACTION_SCOPES)
      .default([]),
    // Compatibility-only input for old clients/transfer files. It can no
    // longer grant a capability; true is rejected and snapshots omit it.
    allowReversibleWrites: z.literal(false).optional(),
    startUrl: z
      .string()
      .refine(safeExternalUrl, { message: "URL is not allowed" }),
    instructions: z.string().min(1).max(10_000),
    device: z.enum(["DESKTOP", "MOBILE"]),
    intervalHours: z.number().int().min(1).max(24),
    maxRetries: z.number().int().min(0).max(3),
    notifyOnRecovery: z.boolean(),
    channelIds: z.array(z.string()).max(10),
  })
  .strict();

export const browserTestConfigSchema = browserTestConfigBaseSchema
  .superRefine((config, context) => {
    let startHost: string | null = null;
    try {
      startHost = new URL(config.startUrl).hostname.toLowerCase();
    } catch {
      // startUrl already reports its own validation issue.
    }
    for (const [index, writable] of config.writableDomains.entries()) {
      const authorized =
        writable === startHost ||
        config.allowedDomains.some((allowed) => {
          if (allowed.startsWith("*.")) {
            const suffix = allowed.slice(2);
            return writable.endsWith(`.${suffix}`) && writable !== suffix;
          }
          return writable === allowed;
        });
      if (!authorized) {
        context.addIssue({
          code: "custom",
          path: ["writableDomains", index],
          message:
            "Writable host must be the starting host or an explicitly allowed domain",
        });
      }
    }
    if (config.irreversibleActionScopes.length > 0 && !config.testDataAttested) {
      context.addIssue({
        code: "custom",
        path: ["testDataAttested"],
        message:
          "Explicitly attest that all credentials and data are staging/test-only",
      });
    }
    const seenScopes = new Set<string>();
    const seenDomLocators = new Set<string>();
    config.irreversibleActionScopes.forEach((scope, index) => {
      let scopeHost: string;
      try {
        scopeHost = new URL(scope.origin).hostname;
      } catch {
        return;
      }
      const authorized =
        scopeHost === startHost ||
        config.allowedDomains.some((allowed) => {
          if (allowed.startsWith("*.")) {
            const suffix = allowed.slice(2);
            return scopeHost.endsWith(`.${suffix}`) && scopeHost !== suffix;
          }
          return scopeHost === allowed;
        });
      if (!authorized) {
        context.addIssue({
          code: "custom",
          path: ["irreversibleActionScopes", index, "origin"],
          message: "Action origin host must be the starting or an allowed domain",
        });
      }
      if (scope.kind === "DOM" && !config.writableDomains.includes(scopeHost)) {
        context.addIssue({
          code: "custom",
          path: ["irreversibleActionScopes", index, "origin"],
          message: "DOM action origin host must also be an exact writable domain",
        });
      }
      if (scope.kind === "DOM") {
        const linkedHttpScope = config.irreversibleActionScopes.find(
          (candidate) =>
            candidate.kind === "HTTP" &&
            candidate.method === scope.target.form.method &&
            candidate.origin === scope.target.form.origin &&
            candidate.path === scope.target.form.path &&
            candidate.maxUses >= scope.maxUses,
        );
        if (linkedHttpScope === undefined) {
          context.addIssue({
            code: "custom",
            path: ["irreversibleActionScopes", index, "target", "form"],
            message:
              "DOM submit target must link to an equal-or-larger exact HTTP POST scope",
          });
        }
        const locatorKey = JSON.stringify({
          origin: scope.origin,
          path: scope.path,
          attribute: scope.target.attribute,
          value: scope.target.value,
        });
        if (seenDomLocators.has(locatorKey)) {
          context.addIssue({
            code: "custom",
            path: ["irreversibleActionScopes", index, "target"],
            message: "DOM locator must identify exactly one configured action",
          });
        }
        seenDomLocators.add(locatorKey);
      }
      const key = JSON.stringify({ ...scope, maxUses: undefined });
      if (seenScopes.has(key)) {
        context.addIssue({
          code: "custom",
          path: ["irreversibleActionScopes", index],
          message: "Duplicate action scope; increase maxUses on the first scope",
        });
      }
      seenScopes.add(key);
    });
  });

// PATCH input is intentionally structural only. UpdateBrowserTest merges it
// with the stored row and then applies browserTestConfigSchema so cross-field
// writable-domain scope cannot be bypassed by a partial update.
export const browserTestConfigUpdateSchema = browserTestConfigBaseSchema.partial();

export type BrowserTestConfig = z.infer<typeof browserTestConfigSchema>;

export function buildSnapshot(
  config: BrowserTestConfig,
  cfgLlmModel: string,
): RunSnapshot {
  const profile = DEVICE_PROFILES[config.device];
  return {
    name: config.name,
    allowedDomains: [...config.allowedDomains],
    writableDomains: [...config.writableDomains],
    startUrl: config.startUrl,
    instructions: config.instructions,
    device: config.device,
    intervalHours: config.intervalHours,
    maxRetries: config.maxRetries,
    notifyOnRecovery: config.notifyOnRecovery,
    channelIds: [...config.channelIds],
    viewport: { width: profile.width, height: profile.height },
    modelName: cfgLlmModel,
    runnerVersion: RUNNER_VERSION,
  };
}

export function computeNextRunAt(
  now: number,
  intervalHours: number,
): number {
  return now + intervalHours * 3_600_000;
}
