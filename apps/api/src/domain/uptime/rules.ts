import { z } from "zod";
import { UPTIME_FREQUENCIES_SECONDS } from "../../shared/constants";
import { assertSafeExternalUrl } from "../../shared/ssrf";

function safeExternalUrl(value: string): boolean {
  try {
    assertSafeExternalUrl(value);
    return true;
  } catch {
    return false;
  }
}

export const monitorHeaderSchema = z
  .object({
    key: z.string().regex(/^[A-Za-z0-9-]{1,64}$/u),
    value: z.string().max(2_048),
  })
  .strict();

const frequencySchema = z.number().int().refine(
  (value) =>
    UPTIME_FREQUENCIES_SECONDS.includes(
      value as (typeof UPTIME_FREQUENCIES_SECONDS)[number],
    ),
  { message: "Unsupported uptime frequency" },
);

export const monitorConfigSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    url: z.string().refine(safeExternalUrl, { message: "URL is not allowed" }),
    method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"]),
    headers: z.array(monitorHeaderSchema).max(20).optional(),
    body: z.string().max(16_384).optional(),
    expectedStatus: z.number().int().min(100).max(599).default(200),
    bodyCondition: z
      .enum(["CONTAINS", "NOT_CONTAINS", "EQUALS", "JSON_PATH_EQUALS"])
      .optional(),
    bodyExpectedValue: z.string().max(2_048).optional(),
    bodyConditionPath: z
      .string()
      .max(256)
      .regex(/^\$?\.?[A-Za-z0-9_.\[\]]+$/u)
      .optional(),
    frequencySeconds: frequencySchema,
    timeoutSeconds: z.number().int().min(1).max(30).default(10),
    maxRetries: z.number().int().min(0).max(3),
    notifyOnRecovery: z.boolean().default(true),
    channelIds: z.array(z.string()).max(10),
  })
  .strict()
  .superRefine((config, context) => {
    if (
      (config.method === "GET" || config.method === "HEAD") &&
      config.body !== undefined
    ) {
      context.addIssue({
        code: "custom",
        path: ["body"],
        message: `Body is not allowed for ${config.method}`,
      });
    }
    if (
      config.bodyCondition !== undefined &&
      config.bodyExpectedValue === undefined
    ) {
      context.addIssue({
        code: "custom",
        path: ["bodyExpectedValue"],
        message: "Required when bodyCondition is set",
      });
    }
    if (
      config.bodyCondition === undefined &&
      config.bodyExpectedValue !== undefined
    ) {
      context.addIssue({
        code: "custom",
        path: ["bodyExpectedValue"],
        message: "Requires bodyCondition",
      });
    }
    if (
      config.bodyCondition === "JSON_PATH_EQUALS" &&
      config.bodyConditionPath === undefined
    ) {
      context.addIssue({
        code: "custom",
        path: ["bodyConditionPath"],
        message: "Required for JSON_PATH_EQUALS",
      });
    }
    if (
      config.bodyCondition !== "JSON_PATH_EQUALS" &&
      config.bodyConditionPath !== undefined
    ) {
      context.addIssue({
        code: "custom",
        path: ["bodyConditionPath"],
        message: "Only allowed for JSON_PATH_EQUALS",
      });
    }
  });

export type MonitorConfig = z.infer<typeof monitorConfigSchema>;
