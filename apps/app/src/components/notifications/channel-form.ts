import { z } from "zod";

import type { CreateChannelInput, UpdateChannelInput } from "@/api/channels";
import type { Channel, ChannelConfigInput, ChannelType } from "@/api/types";
import { ApiError } from "@/lib/api";
import { apiErrorMessage } from "@/lib/errors";

export interface ChannelTypeOption {
  label: string;
  paid?: boolean;
  type: ChannelType;
}

export const channelTypeOptions: ChannelTypeOption[] = [
  { label: "Email", type: "EMAIL" },
  { label: "SMS", paid: true, type: "SMS" },
  { label: "WhatsApp", paid: true, type: "WHATSAPP" },
  { label: "Phone call", paid: true, type: "CALL" },
  { label: "Slack", type: "SLACK" },
  { label: "Discord", type: "DISCORD" },
];

export function isPaidChannelType(type: ChannelType | null): boolean {
  return type === "SMS" || type === "CALL" || type === "WHATSAPP";
}

export function isPhoneChannelType(type: ChannelType | null): boolean {
  return isPaidChannelType(type);
}

export function isWebhookChannelType(type: ChannelType | null): boolean {
  return type === "SLACK" || type === "DISCORD";
}

export const smsConsentCopy =
  "I confirm that this recipient explicitly agreed to receive recurring operational SMS alerts from Zenguy. Frequency varies. Message and data rates may apply. Reply STOP to opt out or HELP for help. See the Terms and Privacy Policy.";

export function phoneHint(type: ChannelType | null): string {
  return type === "WHATSAPP"
    ? "E.164 format, with country code. The number must have WhatsApp and accept messages from your Twilio sender."
    : "E.164 format, with country code.";
}

export function webhookHint(type: ChannelType | null): string {
  return type === "SLACK"
    ? "Create an incoming webhook in your Slack workspace and paste the URL. Treat it like a password."
    : "Create a webhook in your Discord server and paste the URL. Treat it like a password.";
}

const baseSchema = z.object({
  emails: z.array(z.email("Enter a valid email address.")).max(10),
  name: z
    .string()
    .trim()
    .min(1, "Name is required.")
    .max(80, "Name must be 80 characters or fewer."),
  phoneNumber: z.string(),
  smsConsent: z.boolean(),
  type: z.enum(["EMAIL", "SMS", "WHATSAPP", "CALL", "SLACK", "DISCORD"]),
  webhookUrl: z.string(),
});

export type ChannelFormValues = z.infer<typeof baseSchema>;
export type ChannelFormField = Exclude<keyof ChannelFormValues, "type">;

export function channelFormSchema(editing = false) {
  return baseSchema.superRefine((values, context) => {
    if (values.type === "EMAIL" && values.emails.length === 0) {
      context.addIssue({
        code: "custom",
        message: "Add at least one email address.",
        path: ["emails"],
      });
    }

    if (
      (values.type === "SMS" || values.type === "WHATSAPP" || values.type === "CALL") &&
      !/^\+[1-9]\d{6,14}$/u.test(values.phoneNumber.trim())
    ) {
      context.addIssue({
        code: "custom",
        message: "Enter a phone number in E.164 format.",
        path: ["phoneNumber"],
      });
    }

    if (values.type === "SMS" && !values.smsConsent) {
      context.addIssue({
        code: "custom",
        message: "Confirm the recipient's SMS consent.",
        path: ["smsConsent"],
      });
    }

    if (values.type === "SLACK" || values.type === "DISCORD") {
      const url = values.webhookUrl.trim();
      if (editing && !url) return;
      const prefix =
        values.type === "SLACK"
          ? "https://hooks.slack.com/"
          : "https://discord.com/api/webhooks/";
      if (!z.url().safeParse(url).success || !url.startsWith(prefix)) {
        context.addIssue({
          code: "custom",
          message: `Webhook URL must start with ${prefix}`,
          path: ["webhookUrl"],
        });
      }
    }
  });
}

const blankValues: ChannelFormValues = {
  emails: [],
  name: "",
  phoneNumber: "",
  smsConsent: false,
  type: "EMAIL",
  webhookUrl: "",
};

export function channelFormDefaults(channel?: Channel): ChannelFormValues {
  if (!channel) return { ...blankValues, emails: [] };
  return {
    emails: channel.configPreview.emails ?? [],
    name: channel.name,
    phoneNumber: channel.configPreview.phoneNumber ?? "",
    smsConsent: channel.type === "SMS",
    type: channel.type,
    webhookUrl: "",
  };
}

export function channelConfigFromValues(values: ChannelFormValues): ChannelConfigInput {
  switch (values.type) {
    case "EMAIL":
      return { emails: values.emails };
    case "SMS": {
      if (!values.smsConsent) throw new Error("SMS consent is required");
      return { consent: true, phoneNumber: values.phoneNumber.trim() };
    }
    case "WHATSAPP":
    case "CALL":
      return { phoneNumber: values.phoneNumber.trim() };
    case "SLACK":
    case "DISCORD":
      return { webhookUrl: values.webhookUrl.trim() };
  }
}

export function createChannelInput(values: ChannelFormValues): CreateChannelInput {
  return {
    config: channelConfigFromValues(values),
    name: values.name.trim(),
    type: values.type,
  };
}

export function updateChannelInput(values: ChannelFormValues): UpdateChannelInput {
  const input: UpdateChannelInput = { name: values.name.trim() };
  const writeOnlyWebhook = values.type === "SLACK" || values.type === "DISCORD";
  if (!writeOnlyWebhook || values.webhookUrl.trim()) {
    input.config = channelConfigFromValues(values);
  }
  return input;
}

const fieldAliases: Record<string, ChannelFormField> = {
  consent: "smsConsent",
  emails: "emails",
  name: "name",
  phoneNumber: "phoneNumber",
  smsConsent: "smsConsent",
  webhookUrl: "webhookUrl",
};

/** Maps an API validation path (`config.emails.0`, `name`, …) onto a form field. */
export function channelFormField(path: string): ChannelFormField | null {
  const head = path.split(".").find((segment) => segment && segment !== "config");
  return head ? (fieldAliases[head] ?? null) : null;
}

export interface ChannelFormErrors {
  fields: Partial<Record<ChannelFormField, string>>;
  /** Shown as the form-level error: anything that isn't a field, e.g. a rejected paid `type`. */
  root: string | null;
}

export function channelFormErrors(error: unknown): ChannelFormErrors {
  const fields: Partial<Record<ChannelFormField, string>> = {};
  if (
    !(error instanceof ApiError) ||
    error.code !== "VALIDATION_ERROR" ||
    !error.details ||
    error.details.length === 0
  ) {
    return { fields, root: apiErrorMessage(error) };
  }

  let root: string | null = null;
  for (const detail of error.details) {
    const field = channelFormField(detail.field);
    if (field) fields[field] ??= detail.message;
    else root ??= detail.message;
  }
  if (root === null && Object.keys(fields).length === 0) root = apiErrorMessage(error);
  return { fields, root };
}
