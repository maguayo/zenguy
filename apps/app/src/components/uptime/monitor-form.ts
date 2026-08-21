import { z } from "zod";

import type {
  BodyCondition,
  Channel,
  Monitor,
  MonitorInput,
  MonitorMethod,
} from "@/api/types";

// Ported from apps/frontend/src/pages/uptime/MonitorFormPage.tsx: schema,
// option lists, copy and the form <-> API mappers. Pure so it is testable
// without rendering the screen.

export const monitorMethods = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"] as const;
export const bodyConditions = ["CONTAINS", "NOT_CONTAINS", "EQUALS", "JSON_PATH_EQUALS"] as const;
export const allowedFrequencies = [300, 600, 900, 1_800, 3_600, 10_800, 21_600, 43_200, 86_400] as const;

export const monitorFormSchema = z
  .object({
    body: z.string().max(16_384, "Body must be 16,384 characters or fewer."),
    bodyCondition: z.enum(bodyConditions).nullable(),
    bodyConditionPath: z.string().max(256, "JSON path must be 256 characters or fewer."),
    bodyExpectedValue: z.string().max(2_048, "Value must be 2,048 characters or fewer."),
    channelIds: z.array(z.string()).max(10),
    expectedStatus: z.number().int().min(100).max(599),
    frequencySeconds: z
      .number()
      .int()
      .refine((value) => allowedFrequencies.includes(value as (typeof allowedFrequencies)[number]), {
        message: "Choose a supported frequency.",
      }),
    headers: z
      .array(
        z.object({
          key: z
            .string()
            .trim()
            .min(1, "Header name is required.")
            .max(64)
            .regex(/^[A-Za-z0-9-]+$/u, "Use letters, numbers, and hyphens only."),
          value: z.string().max(2_048),
        }),
      )
      .max(20),
    maxRetries: z.number().int().min(0).max(3),
    method: z.enum(monitorMethods),
    name: z
      .string()
      .trim()
      .min(1, "Name is required.")
      .max(120, "Name must be 120 characters or fewer."),
    notifyOnRecovery: z.boolean(),
    timeoutSeconds: z.number().int().min(1).max(30),
    url: z
      .string()
      .url("Enter a valid URL.")
      .refine((value) => /^https?:\/\//iu.test(value), "URL must start with http:// or https://."),
  })
  .superRefine((values, context) => {
    if ((values.method === "GET" || values.method === "HEAD") && values.body.trim()) {
      context.addIssue({
        code: "custom",
        message: `Body is not allowed for ${values.method}.`,
        path: ["body"],
      });
    }
    if (values.bodyCondition !== null && !values.bodyExpectedValue.trim()) {
      context.addIssue({
        code: "custom",
        message: "Value is required when a body condition is set.",
        path: ["bodyExpectedValue"],
      });
    }
    if (values.bodyCondition === null && values.bodyExpectedValue.trim()) {
      context.addIssue({
        code: "custom",
        message: "Choose a body condition before entering a value.",
        path: ["bodyExpectedValue"],
      });
    }
    if (values.bodyCondition === "JSON_PATH_EQUALS" && !values.bodyConditionPath.trim()) {
      context.addIssue({
        code: "custom",
        message: "JSON path is required for JSON path equals.",
        path: ["bodyConditionPath"],
      });
    }
    if (values.bodyCondition !== "JSON_PATH_EQUALS" && values.bodyConditionPath.trim()) {
      context.addIssue({
        code: "custom",
        message: "JSON path is only available for JSON path equals.",
        path: ["bodyConditionPath"],
      });
    }
  });

export type MonitorFormValues = z.infer<typeof monitorFormSchema>;

export interface FormOption<V extends string | number> {
  label: string;
  value: V;
}

export const frequencyOptions = [
  { label: "Every 5 min", value: 300 },
  { label: "Every 10 min", value: 600 },
  { label: "Every 15 min", value: 900 },
  { label: "Every 30 min", value: 1_800 },
  { label: "Every 1 hour", value: 3_600 },
  { label: "Every 3 hours", value: 10_800 },
  { label: "Every 6 hours", value: 21_600 },
  { label: "Every 12 hours", value: 43_200 },
  { label: "Every 24 hours", value: 86_400 },
] as const;

export const testRequestNote =
  "Runs the request once from Zenguy. Nothing is saved and no runs are consumed.";
export const uptimeCostNote = "Uptime checks and retries never consume browser test runs.";
/** Shown in place of the header editor when the API masked them for this role. */
export const headersMaskedNote = "Masked for your role";

export function monitorRetryOptionLabel(retries: number): string {
  if (retries === 0) return "0 retries — no retries";
  const delays = ["immediately", "after 1 min", "after 2 min"].slice(0, retries);
  return `${retries} ${retries === 1 ? "retry" : "retries"} — ${delays.join(", ")}`;
}

export const methodOptions: FormOption<MonitorMethod>[] = monitorMethods.map((value) => ({
  label: value,
  value,
}));

/** `""` stands for "None" so the select can hold a nullable condition. */
export const bodyConditionOptions: FormOption<BodyCondition | "">[] = [
  { label: "None", value: "" },
  { label: "Body contains", value: "CONTAINS" },
  { label: "Body does not contain", value: "NOT_CONTAINS" },
  { label: "Body equals", value: "EQUALS" },
  { label: "JSON path equals", value: "JSON_PATH_EQUALS" },
];

export const retryOptions: FormOption<number>[] = [0, 1, 2, 3].map((retries) => ({
  label: monitorRetryOptionLabel(retries),
  value: retries,
}));

export const monitorFormDefaults: MonitorFormValues = {
  body: "",
  bodyCondition: null,
  bodyConditionPath: "",
  bodyExpectedValue: "",
  channelIds: [],
  expectedStatus: 200,
  frequencySeconds: 300,
  headers: [],
  maxRetries: 1,
  method: "GET",
  name: "",
  notifyOnRecovery: true,
  timeoutSeconds: 10,
  url: "",
};

/** API validation details only map onto fields the form actually has. */
export function isMonitorFormField(field: string): field is keyof MonitorFormValues {
  return Object.prototype.hasOwnProperty.call(monitorFormDefaults, field);
}

export function supportsBody(method: MonitorMethod): boolean {
  return method !== "GET" && method !== "HEAD";
}

export function monitorToFormValues(monitor: Monitor): MonitorFormValues {
  return {
    body: monitor.body ?? "",
    bodyCondition: monitor.bodyCondition ?? null,
    bodyConditionPath: monitor.bodyConditionPath ?? "",
    bodyExpectedValue: monitor.bodyExpectedValue ?? "",
    channelIds: monitor.channelIds,
    expectedStatus: monitor.expectedStatus,
    frequencySeconds: monitor.frequencySeconds,
    headers: monitor.headers ?? [],
    maxRetries: monitor.maxRetries,
    method: monitor.method,
    name: monitor.name,
    notifyOnRecovery: monitor.notifyOnRecovery,
    timeoutSeconds: monitor.timeoutSeconds,
    url: monitor.url,
  };
}

export function toMonitorInput(
  values: MonitorFormValues,
  options: { headersMasked?: boolean } = {},
): MonitorInput {
  const bodyAllowed = supportsBody(values.method);
  return {
    ...(bodyAllowed && values.body.length > 0 ? { body: values.body } : {}),
    bodyCondition: values.bodyCondition,
    bodyConditionPath:
      values.bodyCondition === "JSON_PATH_EQUALS" ? values.bodyConditionPath.trim() : null,
    bodyExpectedValue: values.bodyCondition === null ? null : values.bodyExpectedValue,
    channelIds: values.channelIds,
    expectedStatus: values.expectedStatus,
    frequencySeconds: values.frequencySeconds as MonitorInput["frequencySeconds"],
    // Masked headers were never shown, so they are left out and the API keeps
    // the stored ones instead of overwriting them with an empty list.
    ...(options.headersMasked ? {} : { headers: values.headers }),
    maxRetries: values.maxRetries,
    method: values.method,
    name: values.name.trim(),
    notifyOnRecovery: values.notifyOnRecovery,
    timeoutSeconds: values.timeoutSeconds,
    url: values.url,
  };
}

/** Channels preselected for a new monitor (ported from the web ChannelPicker). */
export function defaultChannelIds(channels: Channel[]): string[] {
  return channels
    .filter((channel) => channel.enabled && channel.isDefault)
    .map((channel) => channel.id);
}

/** Mirrors `valueAsNumber`: an empty or non-numeric entry becomes NaN. */
export function parseNumberInput(text: string): number {
  const trimmed = text.trim();
  return trimmed === "" ? Number.NaN : Number(trimmed);
}
