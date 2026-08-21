import { z } from "zod";

import type { BrowserTest, Channel } from "@/api/types";

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

export const testFormSchema = z.object({
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
