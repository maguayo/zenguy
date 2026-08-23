import { z } from "zod";

import type {
  BrowserTest,
  BrowserTestInput,
  Channel,
  IrreversibleActionScope,
} from "@/api/types";

export const stagingCredentialsCopy =
  "Use staging or test credentials only. Never use personal accounts, real cards, or credentials with destructive permissions.";
export const timeoutHelpCopy =
  "Each attempt can run for up to 5 minutes. If it takes longer, it ends with a Timeout status and may be retried according to your settings.";
export const tokenNoteCopy =
  "Tests are designed for a nominal maximum of 200,000 tokens. If a test is very large, split it into smaller tests.";
export const instructionsHint =
  "Write what to do and what must be true, in plain language. Reference secrets like {{SHOP_PASSWORD}}.";
export const retriesHint = "Retries run in a fresh browser and don't consume runs.";
export const validationNote =
  "You can leave this page while it runs; the run continues server-side. Saving never requires a successful test run.";
export const irreversibleApprovalCopy =
  "I attest that every credential and record used by these actions is staging/test-only. Each run still requires a separate human confirmation.";

const actionScopeSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("DOM"),
    action: z.literal("CLICK"),
    origin: z.string().url().startsWith("https://"),
    path: z.string().startsWith("/"),
    target: z.object({
      attribute: z.enum(["data-testid", "id", "name", "aria-label"]),
      value: z.string().min(1).max(120),
      tag: z.enum(["BUTTON", "INPUT"]),
      type: z.literal("submit"),
      form: z.object({
        method: z.literal("POST"),
        origin: z.string().url().startsWith("https://"),
        path: z.string().startsWith("/"),
      }),
    }),
    maxUses: z.number().int().min(1).max(3),
  }),
  z.object({
    kind: z.literal("HTTP"),
    method: z.enum(["POST", "PUT", "PATCH", "DELETE"]),
    origin: z.string().url().startsWith("https://"),
    path: z.string().startsWith("/"),
    maxUses: z.number().int().min(1).max(3),
  }),
]);

const actionScopesSchema = z
  .array(actionScopeSchema)
  .max(20)
  .superRefine((scopes, context) => {
    const locators = new Set<string>();
    scopes.forEach((scope, index) => {
      if (scope.kind !== "DOM") return;
      const linked = scopes.some(
        (candidate) =>
          candidate.kind === "HTTP" &&
          candidate.method === scope.target.form.method &&
          candidate.origin === scope.target.form.origin &&
          candidate.path === scope.target.form.path &&
          candidate.maxUses >= scope.maxUses,
      );
      const locator = JSON.stringify({
        origin: scope.origin,
        path: scope.path,
        attribute: scope.target.attribute,
        value: scope.target.value,
      });
      if (!linked || locators.has(locator)) {
        context.addIssue({
          code: "custom",
          path: [index, "target"],
          message:
            "DOM targets must be unique and link to an equal-or-larger HTTP POST scope.",
        });
      }
      locators.add(locator);
    });
  });

export function parseActionScopesJson(value: string): IrreversibleActionScope[] {
  return actionScopesSchema.parse(JSON.parse(value));
}

export const testFormSchema = z.object({
  allowedDomains: z
    .array(z.string())
    .max(20, "Use at most 20 additional domains.")
    .superRefine((domains, context) => {
      const domainPattern = /^(?:\*\.)?[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/u;
      if (domains.some((domain) => !domainPattern.test(domain))) {
        context.addIssue({
          code: "custom",
          message: "Use lowercase hostnames such as checkout.example.com or *.example.com.",
        });
      }
    }),
  writableDomains: z
    .array(z.string())
    .max(20, "Use at most 20 writable domains.")
    .superRefine((domains, context) => {
      const exactDomainPattern = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/u;
      if (domains.some((domain) => !exactDomainPattern.test(domain))) {
        context.addIssue({
          code: "custom",
          message: "Use exact lowercase hostnames; writable wildcards are not allowed.",
        });
      }
    }),
  testDataAttested: z.boolean(),
  irreversibleActionScopesJson: z.string().superRefine((value, context) => {
    try {
      parseActionScopesJson(value);
    } catch {
      context.addIssue({
        code: "custom",
        message: "Enter a valid JSON array of at most 20 exact action scopes.",
      });
    }
  }),
  channelIds: z.array(z.string()),
  device: z.enum(["DESKTOP", "MOBILE"]),
  instructions: z.string().trim().min(1, "Instructions are required."),
  intervalHours: z.number().int().min(1).max(24),
  maxRetries: z.number().int().min(0).max(3),
  name: z
    .string()
    .trim()
    .min(1, "Name is required.")
    .max(120, "Name must be 120 characters or fewer."),
  notifyOnRecovery: z.boolean(),
  startUrl: z
    .string()
    .url("Enter a valid URL.")
    .refine((value) => /^https?:\/\//iu.test(value), "URL must start with http:// or https://."),
}).superRefine((config, context) => {
  let startHost: string | null = null;
  try {
    startHost = new URL(config.startUrl).hostname.toLowerCase();
  } catch {
    // startUrl owns its validation message.
  }
  config.writableDomains.forEach((writable, index) => {
    const allowed =
      writable === startHost ||
      config.allowedDomains.some((domain) =>
        domain.startsWith("*.")
          ? writable.endsWith(`.${domain.slice(2)}`)
          : writable === domain,
      );
    if (!allowed) {
      context.addIssue({
        code: "custom",
        path: ["writableDomains", index],
        message: "Writable host must also be the starting or an allowed domain.",
      });
    }
  });
  let scopes: IrreversibleActionScope[] = [];
  try {
    scopes = parseActionScopesJson(config.irreversibleActionScopesJson);
  } catch {
    return;
  }
  if (scopes.length > 0 && !config.testDataAttested) {
    context.addIssue({
      code: "custom",
      path: ["testDataAttested"],
      message: "Staging/test data attestation is required for action scopes.",
    });
  }
});

export type TestFormValues = z.infer<typeof testFormSchema>;

export const intervalOptions = Array.from({ length: 24 }, (_, index) => index + 1);

export function intervalOptionLabel(hours: number): string {
  return `Every ${hours} ${hours === 1 ? "hour" : "hours"}`;
}

export const retryOptions = [0, 1, 2, 3];

export function retryOptionLabel(retries: number): string {
  if (retries === 0) return "0 retries — no retries";
  const delays = ["immediately", "after 1 min", "after 2 min"].slice(0, retries);
  return `${retries} ${retries === 1 ? "retry" : "retries"} — ${delays.join(", ")}`;
}

export const testFormDefaults: TestFormValues = {
  allowedDomains: [],
  writableDomains: [],
  testDataAttested: false,
  irreversibleActionScopesJson: "[]",
  channelIds: [],
  device: "DESKTOP",
  instructions: "",
  intervalHours: 24,
  maxRetries: 1,
  name: "",
  notifyOnRecovery: true,
  startUrl: "",
};

/** Whether an API validation detail points at a form field (so it can be shown inline). */
export function isTestFormField(field: string): field is keyof TestFormValues {
  return Object.prototype.hasOwnProperty.call(testFormDefaults, field);
}

/** Channels preselected for a new test. */
export function defaultChannelIds(channels: Channel[]): string[] {
  return channels
    .filter((channel) => channel.enabled && channel.isDefault)
    .map((channel) => channel.id);
}

export function testFormValues(test: BrowserTest): TestFormValues {
  return {
    allowedDomains: test.allowedDomains ?? [],
    writableDomains: test.writableDomains ?? [],
    testDataAttested: test.testDataAttested ?? false,
    irreversibleActionScopesJson: JSON.stringify(
      test.irreversibleActionScopes ?? [],
      null,
      2,
    ),
    channelIds: test.channelIds,
    device: test.device,
    instructions: test.instructions,
    intervalHours: test.intervalHours,
    maxRetries: test.maxRetries,
    name: test.name,
    notifyOnRecovery: test.notifyOnRecovery,
    startUrl: test.startUrl,
  };
}

export function browserTestInput(values: TestFormValues): BrowserTestInput {
  const { irreversibleActionScopesJson, ...config } = values;
  return {
    ...config,
    irreversibleActionScopes: parseActionScopesJson(
      irreversibleActionScopesJson,
    ),
  };
}
